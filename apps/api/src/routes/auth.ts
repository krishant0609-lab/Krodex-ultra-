/**
 * KRODEX API — dev auth routes.
 *
 *   POST /auth/dev-token
 *
 * Mints a short-lived HS256 JWT signed with AUTH_JWT_SECRET. The
 * `sub` claim is the KRODEX public.users UUID. The endpoint is
 * for local development and integration testing; in production
 * Supabase access tokens replace it. The route is mounted
 * regardless of `NODE_ENV` so tests can reach it, but the handler
 * always logs the mint so accidental production use is loud.
 */

import type { FastifyInstance } from 'fastify';
import { signDevJwt } from '../auth/dev-jwt';
import { parseBody } from '../validation/parse';
import { MintDevTokenBody } from '../validation/schemas';
import { ok } from './_helpers';

export interface DevTokenResponse {
  token: string;
  expires_at: string;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/auth/dev-token', async (req, reply) => {
    const body = parseBody(MintDevTokenBody, req.body);
    const env = app.krodexEnv;
    const ttl = body.ttl_seconds ?? 3600;
    const token = signDevJwt(env.authJwtSecret, body.user_id, {
      ttlSeconds: ttl,
      ...(body.email ? { meta: { email: body.email } } : {}),
    });
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    req.log.warn(
      { sub: body.user_id, ttl, hasEmail: Boolean(body.email) },
      'krodex.api.dev_token_minted',
    );
    return ok<DevTokenResponse>(reply, { token, expires_at: expiresAt });
  });
}
