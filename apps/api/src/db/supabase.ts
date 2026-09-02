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
let cachedAnonUrl: string | null = null;
let cachedAnonKey: string | null = null;

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
 * Returns a per-request, user-scoped Supabase client. The client honors
 * RLS: every query runs as `auth.uid() = <jwt sub>`, so a user only sees
 * rows they own (plus the global tables). The client is NOT cached — each
 * request gets a fresh one keyed on its bearer token.
 *
 * Pass `null` for `jwt` to obtain a "logged-out" client that can only see
 * the global tables (subjects, topics, sub_topics, questions, etc.).
 */
export function getUserClient(
  env: ApiEnv,
  jwt: string | null,
): SupabaseClient {
  if (!env.hasSupabase || !env.supabaseAnonKey) {
    throw new Error(
      'KRODEX: getUserClient() requires SUPABASE_URL and SUPABASE_ANON_KEY. ' +
        'See Engineering Support Spec §13.1.',
    );
  }
  if (cachedAnonUrl !== env.supabaseUrl || cachedAnonKey !== env.supabaseAnonKey) {
    cachedAnonUrl = env.supabaseUrl;
    cachedAnonKey = env.supabaseAnonKey;
  }
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: jwt
        ? { Authorization: `Bearer ${jwt}`, 'X-Client-Info': 'krodex-api/user' }
        : { 'X-Client-Info': 'krodex-api/user-anon' },
    },
  });
}

/** Test-only: clears the cached clients. Never call from production code. */
export function __resetSupabaseClientsForTests(): void {
  cachedService = null;
  cachedAnonUrl = null;
  cachedAnonKey = null;
}
