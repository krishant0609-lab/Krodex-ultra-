/**
 * KRODEX API — auth pre-handler.
 *
 * Fastify preHandler that:
 *   1. Pulls a bearer JWT from the `Authorization` header.
 *   2. Verifies it with the dev JWT secret.
 *   3. Resolves the `public.users` row that owns the JWT's `sub`
 *      claim. (Phase 2 stores `auth_user_id` equal to the JWT sub
 *      in the dev flow.)
 *   4. Decorates the request with `userId` and `userEmail` for the
 *      route handler.
 *
 * On any failure the preHandler throws an `UnauthorizedError` so
 * the Fastify error handler turns it into the documented envelope.
 *
 * The Supabase user client (`getUserClient`) is constructed lazily
 * from the resolved user so RLS continues to enforce per-user
 * scoping on every query.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from '../config/env';
import { getUserClient } from '../db/supabase';
import { extractBearer, verifyDevJwt } from './dev-jwt';
import { UnauthorizedError } from '../errors';

/**
 * Build a Fastify preHandler that:
 *   - Verifies the bearer JWT.
 *   - Resolves the owning public.users row (so we can refuse a
 *     well-signed JWT whose subject has no KRODEX account).
 *   - Constructs a per-request Supabase user client.
 *   - Decorates `request.auth` and `request.supabaseUser`.
 */
export function buildAuthPreHandler(env: ApiEnv) {
  if (!env.hasSupabase) {
    // The preHandler still wires up, but it rejects every request
    // because there is no database to verify against. The dev/test
    // env that boots with no SUPABASE_URL should fail loud.
    return async function authPreHandlerNoDb(): Promise<void> {
      throw new UnauthorizedError('persistence layer not configured');
    };
  }
  return async function authPreHandler(
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const header = req.headers['authorization'];
    const token = extractBearer(typeof header === 'string' ? header : header?.[0]);
    if (!token) {
      throw new UnauthorizedError('missing bearer token');
    }
    const claims = verifyDevJwt(env.authJwtSecret, token);

    // Look up the public.users row. We use the service client here
    // (gated to this single read) because the RLS policy is
    // "user owns the row" — the anon-key call would fail. This is
    // a server-internal trust boundary: the user is identified by
    // the JWT signature, not by what they sent in the body.
    const { getServiceClient } = await import('../db/supabase');
    const service = getServiceClient(env);
    const { data, error } = await service
      .from('users')
      .select('id, email')
      .eq('auth_user_id', claims.sub)
      .maybeSingle();
    if (error) {
      throw new UnauthorizedError('user lookup failed');
    }
    if (!data) {
      throw new UnauthorizedError('user not found');
    }
    req.auth = { userId: data.id as string, userEmail: data.email as string, jwt: token };
    req.supabaseUser = getUserClient(env, token);
  };
}

/** Convenience: install the preHandler as a route-level Fastify hook. */
export function installAuthPreHandler(app: FastifyInstance, env: ApiEnv): void {
  const pre = buildAuthPreHandler(env);
  app.decorate('authPreHandler', pre);
}
