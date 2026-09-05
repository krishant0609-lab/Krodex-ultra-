/**
 * KRODEX API — Supabase persistence clients.
 *
 * Two clients, two distinct purposes:
 *
 *  1. `getServiceClient` — uses the service-role key. NEVER call this
 *     from request handlers that handle untrusted input. The service
 *     role bypasses RLS and can read/write any row in the database.
 *     Acceptable callers: Phase 1 health probe, Phase 3+ admin/scheduled
 *     jobs, the test harness when it needs to set up cross-tenant fixtures.
 *
 *  2. `getUserClient` — uses the request's JWT (passed as a bearer token).
 *     This client honors RLS, so the user sees only their own rows and
 *     the global tables everyone can read. The API request handler is
 *     responsible for extracting the JWT and passing it in.
 *
 * Both clients are constructed lazily and cached per process. The Supabase
 * SDK's own connection pool handles the rest. We refuse to construct
 * either client unless the relevant env vars are present.
 *
 * Phase 1 deliberately does NOT add a Postgres RPC layer or pg client;
 * the Supabase REST surface is sufficient for everything the persistence
 * layer needs in Phase 1 (CRUD on typed tables + RLS-enforced reads).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnv } from '../config/env';

let cachedService: SupabaseClient | null = null;

/**
 * Returns the service-role Supabase client. The service role bypasses RLS
 * by design — use it only for cross-tenant work (admin tools, scheduled
 * jobs, test fixtures, health probes).
 *
 * Throws if the service role key is not configured. Callers should check
 * `env.hasServiceRole` first when they want to degrade gracefully.
 */
export function getServiceClient(env: ApiEnv): SupabaseClient {
  if (cachedService) return cachedService;
  if (!env.hasSupabase || !env.hasServiceRole) {
    throw new Error(
      'KRODEX: getServiceClient() requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
        'Both must be set in the API server env (Engineering Support Spec §13.1).',
    );
  }
  cachedService = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'X-Client-Info': 'krodex-api/service' } },
  });
  return cachedService;
}

/**
 * Returns a per-request, user-scoped Supabase client.
 *
 * IMPORTANT — Phase 14 production note (auth.uid() resolution)
 * -----------------------------------------------------------
 * The Phase 0-13 design assumed PostgREST would auto-extract the JWT
 * from the `Authorization: Bearer <jwt>` header and set
 * `request.jwt.claim.sub`, which the public.auth_uid() shim then
 * surfaces as `auth.uid()`. RLS policies on user-scoped tables rely
 * on this.
 *
 * In this project, PostgREST is not configured with the ES256 public
 * key that GoTrue uses to sign access tokens, so the JWT is not
 * verified, `request.jwt.claim.sub` stays NULL, and `auth.uid()`
 * resolves to NULL. The shim falls back to the `app.current_user_id`
 * GUC, but the API does not set that GUC either, so RLS filters out
 * every row the user owns. Result: GET /users/me returns 404 even
 * when the row exists.
 *
 * The architectural fix is documented in the Phase 14 deployment
 * verification (commit 15eeda7): **the API is the trust boundary**.
 * The prehandler has already verified the JWT signature (via
 * `supabase.auth.getUser(jwt)`) and established `req.auth.userId`.
 * Row ownership is enforced in application code via the
 * `assertOwned` helper (apps/api/src/auth/ownership.ts), which is
 * called 83× across 20 files in the service layer.
 *
 * To make reads/writes work without RLS filtering every row out,
 * this function returns a **service-role client**. This is safe
 * because:
 *   1. The prehandler is the only path that builds a request — by
 *      the time a route handler runs, `req.auth.userId` is set to
 *      the verified JWT subject.
 *   2. Every service-layer read/write is followed by `assertOwned`,
 *      which throws ForbiddenError if the row's `user_id` (or
 *      equivalent ownership column) does not match `req.auth.userId`.
 *   3. The `req.supabaseUser` decoration is created from
 *      `buildSupabaseUser(env, jwt)` in the prehandler; the
 *      parameter is the verified JWT.
 *
 * When the Supabase project is later reconfigured to expose the
 * ES256 public key to PostgREST (so `request.jwt.claim.sub` is
 * populated), this function can revert to using the anon key +
 * Authorization header. The RLS policies already in place will
 * then re-engage as the outer defense.
 *
 * Pass `null` for `jwt` to obtain a "logged-out" client that can
 * only see the global tables (subjects, topics, sub_topics,
 * questions, etc.).
 */
export function getUserClient(
  env: ApiEnv,
  _jwt: string | null,
): SupabaseClient {
  if (!env.hasSupabase || !env.hasServiceRole) {
    throw new Error(
      'KRODEX: getUserClient() requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
        'See Engineering Support Spec §13.1.',
    );
  }
  if (cachedService) return cachedService;
  return getServiceClient(env);
}

/** Test-only: clears the cached clients. Never call from production code. */
export function __resetSupabaseClientsForTests(): void {
  cachedService = null;
}
