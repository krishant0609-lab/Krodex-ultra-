/**
 * Tests for the database health probe.
 *
 * The "unconfigured" path always runs (no live DB required). The
 * "ok" path requires a reachable Supabase and is gated on LIVE_DB=1.
 *
 * The live test bodies are written out so they can run unchanged
 * once a Supabase/Postgres instance is available — see the
 * `it.skip(...)` blocks below.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dbHealth, type DbHealthSnapshot } from '../health';
import { loadEnv } from '../../config/env';
import { __resetSupabaseClientsForTests } from '../supabase';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  __resetSupabaseClientsForTests();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
  __resetSupabaseClientsForTests();
});

const liveDb = process.env.LIVE_DB === '1';
const liveOrSkip = liveDb ? it : it.skip;

describe('dbHealth — unconfigured (always runs)', () => {
  it('returns unconfigured when SUPABASE_URL is empty', async () => {
    const env = loadEnv();
    const snap: DbHealthSnapshot = await dbHealth(env);
    expect(snap.status).toBe('unconfigured');
    expect(snap.configured).toBe(false);
    expect(snap.hasServiceRole).toBe(false);
    expect(snap.latencyMs).toBeNull();
    expect(snap.message).toMatch(/SUPABASE_URL/);
  });

  it('returns degraded when SUPABASE_URL is set but the service key is missing', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    const env = loadEnv();
    const snap = await dbHealth(env);
    expect(snap.status).toBe('degraded');
    expect(snap.configured).toBe(true);
    expect(snap.hasServiceRole).toBe(false);
    expect(snap.message).toMatch(/SERVICE_ROLE_KEY/);
  });
});

describe('dbHealth — live probe (skipped without LIVE_DB=1)', () => {
  liveOrSkip('reports ok against a reachable Supabase', async () => {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'service-role-test-key';
    const env = loadEnv();
    const snap = await dbHealth(env);
    expect(snap.status).toBe('ok');
    expect(snap.configured).toBe(true);
    expect(snap.hasServiceRole).toBe(true);
    expect(typeof snap.latencyMs).toBe('number');
    expect(snap.latencyMs).toBeGreaterThanOrEqual(0);
  });

  liveOrSkip('reports unreachable when the URL does not resolve', async () => {
    // 127.0.0.1:1 is a port that should be closed in any sane environment.
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const env = loadEnv();
    const snap = await dbHealth(env);
    expect(snap.status).toBe('unreachable');
    expect(snap.error).toBeDefined();
  });
});
