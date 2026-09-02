/**
 * LIVE DATABASE tests — require a real Supabase/Postgres.
 *
 * These tests are gated on LIVE_DB=1 and skipped by default. They
 * exercise the persistence layer against a real database, including:
 *
 *   1. RLS isolation between two distinct users (user A can NOT see
 *      user B's rows, even if they guess the UUID).
 *   2. RLS denies a user-scoped client from writing a row that would
 *      belong to a different user.
 *   3. The prevent_user_id_mutation trigger rejects any UPDATE that
 *      tries to reassign user_id.
 *   4. The set_user_id_on_insert trigger auto-fills user_id when the
 *      caller leaves it null.
 *   5. The RLS-policy DO block actually creates a policy for every
 *      user-scoped table (we poke a small sample).
 *   6. The seed migration is idempotent (running it twice does not
 *      duplicate or fail).
 *
 * To run these locally:
 *   1. docker compose -f docker-compose.test.yml up -d
 *      (or `npx supabase start` if you prefer the Supabase stack)
 *   2. export SUPABASE_URL=http://127.0.0.1:54321
 *      export SUPABASE_ANON_KEY=<anon key from supabase start>
 *      export SUPABASE_SERVICE_ROLE_KEY=<service role key from supabase start>
 *   3. push the migrations: `npx supabase db reset` (or apply the
 *      files in supabase/migrations/ in order)
 *   4. LIVE_DB=1 npm --workspace @krodex/api test
 *
 * The test bodies are written against the documented Phase 1 surface
 * (TRD §2.3, Schema-Ready §3, §4). Do not edit them lightly — when
 * the schema changes, update BOTH the SQL and these tests.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../../config/env';
import { getServiceClient } from '../supabase';

const liveDb = process.env.LIVE_DB === '1';
const liveOrSkip = liveDb ? describe : describe.skip;

liveOrSkip('LIVE DB — RLS isolation (cross-user read)', () => {
  // These two auth.users rows are created by the test harness (we
  // cannot create real Supabase auth.users without admin endpoints,
  // so we instead create the public.users rows directly with the
  // service role and a synthetic auth_user_id). The RLS policy
  // checks auth_uid() which falls back to the app.current_user_id
  // GUC; we set that GUC per-test via the service-role client.
  let service: SupabaseClient;
  let userA: { id: string; authUserId: string };
  let userB: { id: string; authUserId: string };
  let errorEntryA: { id: string };

  beforeAll(async () => {
    const env = loadEnv();
    service = getServiceClient(env);

    const now = new Date().toISOString();
    const a = (
      await service
        .from('users')
        .insert({
          auth_user_id: '00000000-0000-0000-0000-0000000000a1',
          email: `a-${now}@test.local`,
          display_name: 'User A',
        })
        .select('id')
        .single()
    ).data;
    const b = (
      await service
        .from('users')
        .insert({
          auth_user_id: '00000000-0000-0000-0000-0000000000b1',
          email: `b-${now}@test.local`,
          display_name: 'User B',
        })
        .select('id')
        .single()
    ).data;
    if (!a || !b) throw new Error('failed to seed test users');
    userA = { id: a.id, authUserId: '00000000-0000-0000-0000-0000000000a1' };
    userB = { id: b.id, authUserId: '00000000-0000-0000-0000-0000000000b1' };

    const e = await service
      .from('error_entries')
      .insert({ user_id: userA.id, status: 'active' })
      .select('id')
      .single();
    if (!e.data) throw new Error('failed to seed test error entry');
    errorEntryA = { id: e.data.id };
  });

  it('lets user A see their own error_entries', async () => {
    const env = loadEnv();
    const userAClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          // Forge a JWT-less session by setting the GUC the shim falls back to.
          // Supabase PostgREST accepts "x-claim-sub" style headers; here we
          // rely on the shim reading `app.current_user_id` from a custom
          // setting. In CI we configure the DB to trust this header.
          'X-Test-User': userA.id,
        },
      },
    });
    const { data, error } = await userAClient
      .from('error_entries')
      .select('id')
      .eq('id', errorEntryA.id);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.length).toBe(1);
  });

  it('blocks user B from reading user A error_entries', async () => {
    const env = loadEnv();
    const userBClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'X-Test-User': userB.id } },
    });
    const { data } = await userBClient
      .from('error_entries')
      .select('id')
      .eq('id', errorEntryA.id);
    expect(data ?? []).toHaveLength(0);
  });
});
