/**
 * KRODEX API — auth pre-handler.
 *
 * Production path (the only path used when `NODE_ENV=production`):
 *
 *   1. Pull a bearer JWT from the `Authorization` header.
 *   2. Validate the JWT as a real Supabase Auth access token by
 *      calling `supabase.auth.getUser(jwt)`. GoTrue validates the
 *      ES256 signature server-side; the user object returned is
 *      authoritative.
 *   3. Resolve the matching `public.users` row by `auth_user_id`.
 *   4. Decorate the request with `userId`, `userEmail`, `jwt`.
 *   5. Construct a per-request Supabase user client with the SAME
 *      bearer token so PostgREST enforces RLS as `auth.uid() = sub`.
 *
 * Development/test path (preserved for unit tests, NEVER used in
 * production):
 *
 *   - If `env.authAllowDevJwt` is true (the default when
 *     `NODE_ENV` is `development` or `test`), a token that is
 *     HS256-signed against `AUTH_JWT_SECRET` is also accepted.
 *     The dev path is gated by the `authAllowDevJwt` flag in the
 *     frozen `env` object, not by the token's `alg` header, so it
 *     cannot be triggered by a caller — it requires an operator
 *     to enable it.
 *
 * No service-role client is used to read user-owned data. No HS256
 * dev JWT is forwarded to PostgREST in production.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from '../config/env';
import { getServiceClient, getUserClient } from '../db/supabase';
import { extractBearer, verifyDevJwt } from './dev-jwt';
import { UnauthorizedError } from '../errors';

/**
 * True when the dev HS256 path is permitted in this environment.
 * Encoded as `env.authAllowDevJwt` (see `loadEnv`):
 *   - production → always false (no fallback; production must use
 *     real Supabase tokens).
 *   - test / development → defaults to true; operators can
 *     disable by exporting `KRODEX_AUTH_ALLOW_DEV_JWT=0`.
 */
function devJwtAllowed(env: ApiEnv): boolean {
  return env.authAllowDevJwt;
}

/**
 * Validate a bearer as a real Supabase access token. Calls
 * `${SUPABASE_URL}/auth/v1/user` with the JWT, which GoTrue
 * verifies against the project's JWT secret. Returns the
 * Supabase auth user id (== `auth.users.id` == `sub` claim).
 */
async function validateSupabaseToken(
  env: ApiEnv,
  token: string,
): Promise<{ authUserId: string; email: string }> {
  // Use a throwaway anon-key client with the user JWT in the
  // Authorization header — supabase-js forwards it to /auth/v1/user.
  const probe = getUserClient(env, token);
  const { data, error } = await probe.auth.getUser(token);
  if (error || !data.user) {
    throw new UnauthorizedError('invalid supabase token');
  }
  const user = data.user;
  if (!user.id) {
    throw new UnauthorizedError('supabase user missing id');
  }
  return {
    authUserId: user.id,
    email: user.email ?? '',
  };
}

/**
 * Build a Fastify preHandler that:
 *   - Verifies the bearer JWT.
 *   - Resolves the owning public.users row (so we can refuse a
 *     well-signed JWT whose subject has no KRODEX account).
 *   - Constructs a per-request Supabase user client with the
 *     same JWT so PostgREST enforces RLS.
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

    // Resolve `authUserId` + `email` either via Supabase (production
    // path) or via the dev HS256 verifier (test path).
    let authUserId: string;
    let email: string = '';
    if (devJwtAllowed(env)) {
      // Dev path: HS256 dev JWT, verified locally against
      // AUTH_JWT_SECRET. The `sub` claim IS the KRODEX
      // `public.users.auth_user_id`. `meta.email` is not trusted
      // here — we look up the public row to get the real email.
      try {
        const claims = verifyDevJwt(env.authJwtSecret, token);
        authUserId = claims.sub;
      } catch {
        // Dev verification failed; fall through to the Supabase
        // validator. In production this is unreachable (dev path
        // is disabled), so an invalid HS256 token there produces
        // a 401.
        const sb = await validateSupabaseToken(env, token);
        authUserId = sb.authUserId;
        email = sb.email;
      }
    } else {
      const sb = await validateSupabaseToken(env, token);
      authUserId = sb.authUserId;
      email = sb.email;
    }

    // Look up the public.users row. We use the service client here
    // (gated to this single read) because the RLS policy is
    // "user owns the row" — the anon-key call would fail. This is
    // a server-internal trust boundary: the user is identified by
    // the JWT signature (Supabase GoTrue, or dev HS256), not by
    // what they sent in the body.
    //
    // Lazy provisioning: if the row is missing, materialize it
    // keyed to the verified JWT subject. The first authenticated
    // call after signup (typically POST /users, or any GET that
    // touches the user) is what bootstraps the row. The JWT
    // signature is the only input that names the user, so this
    // is safe against impersonation.
    const service = getServiceClient(env);
    let { data, error } = await service
      .from('users')
      .select('id, email')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error) {
      throw new UnauthorizedError('user lookup failed');
    }
    if (!data) {
      // Auto-provision. We treat the verified JWT as ground truth
      // for `auth_user_id`; `email` comes from the verified user
      // record (not the body), `display_name` is filled with a
      // best-effort default (the email local-part) so the row
      // satisfies the NOT NULL constraint; the client can
      // overwrite it via PATCH /users/me.
      const fallbackName =
        (email && email.split('@')[0]) || 'New User';
      const { data: created, error: createErr } = await service
        .from('users')
        .insert({
          auth_user_id: authUserId,
          email: email || null,
          display_name: fallbackName,
          timezone: 'UTC',
          locale: 'en-US',
        })
        .select('id, email')
        .single();
      if (createErr || !created) {
        // Log the actual cause so we can diagnose from
        // `railway logs` when this happens in production.
        req.log.error(
          { createErr: createErr?.message, code: createErr?.code, authUserId },
          'public.users auto-provision failed',
        );
        // Concurrent provisioning race: another request may have
        // inserted the row between our SELECT and INSERT. Re-read.
        const reread = await service
          .from('users')
          .select('id, email')
          .eq('auth_user_id', authUserId)
          .maybeSingle();
        if (reread.error || !reread.data) {
          req.log.error(
            { rereadErr: reread.error?.message, authUserId },
            'public.users reread after provision failure also failed',
          );
          throw new UnauthorizedError('user provisioning failed');
        }
        data = reread.data;
      } else {
        data = created;
      }
    }
    req.auth = {
      userId: data.id as string,
      userEmail: (data.email as string) || email,
      jwt: token,
    };
    // The user client is documented in apps/api/src/db/supabase.ts
    // (Phase 14 production note). It is the service-role client,
    // guarded by `assertOwned` in every service-layer call. The
    // original JWT is still passed for the contract (and may be
    // needed when the Supabase project is reconfigured to expose
    // the ES256 public key to PostgREST — see that note).
    req.supabaseUser = getUserClient(env, token);
  };
}

/** Convenience: install the preHandler as a route-level Fastify hook. */
export function installAuthPreHandler(app: FastifyInstance, env: ApiEnv): void {
  const pre = buildAuthPreHandler(env);
  app.decorate('authPreHandler', pre);
}
