/**
 * Tests for the two Supabase client factories.
 *
 * The factory behavior (throw-when-not-configured) is always
 * exercised. The actual client construction is gated on the
 * presence of SUPABASE_URL / keys, and the live round-trip is
 * gated on LIVE_DB=1.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetSupabaseClientsForTests,
  getServiceClient,
  getUserClient,
} from '../supabase';
import { loadEnv } from '../../config/env';

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

describe('getServiceClient — guard behavior', () => {
  it('throws when SUPABASE_URL is missing', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const env = loadEnv();
    expect(() => getServiceClient(env)).toThrow(/SUPABASE_URL/);
  });

  it('throws when the service role key is missing', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    const env = loadEnv();
    expect(() => getServiceClient(env)).toThrow(/SERVICE_ROLE_KEY/);
  });

  it('constructs a client when both URL and key are present', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const env = loadEnv();
    const client = getServiceClient(env);
    expect(client).toBeDefined();
    // Second call returns the cached instance.
    expect(getServiceClient(env)).toBe(client);
  });
});

describe('getUserClient — guard behavior (Phase 14)', () => {
  // Phase 14: getUserClient returns the service-role client (see
  // apps/api/src/db/supabase.ts note). The trust boundary is the
  // API's auth prehandler + the assertOwned helper in the service
  // layer, not PostgREST RLS. This is because the production
  // Supabase project does not expose the ES256 public key to
  // PostgREST, so request.jwt.claim.sub stays NULL and the
  // auth_uid() shim falls back to a GUC that the API does not
  // set — RLS would filter every row out.

  it('throws when SUPABASE_URL is missing', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const env = loadEnv();
    expect(() => getUserClient(env, null)).toThrow(/SUPABASE_URL/);
  });

  it('throws when the service role key is missing', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    const env = loadEnv();
    expect(() => getUserClient(env, null)).toThrow(/SERVICE_ROLE_KEY/);
  });

  it('constructs a logged-out client when URL + service-role key are present', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const env = loadEnv();
    const client = getUserClient(env, null);
    expect(client).toBeDefined();
  });

  it('constructs a client when a JWT is passed (JWT is currently ignored)', () => {
    // The JWT is accepted for the contract but the function
    // returns the cached service-role client regardless. The
    // prehandler has already verified the JWT signature; row
    // ownership is enforced via assertOwned at the service
    // layer.
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const env = loadEnv();
    const client = getUserClient(env, 'fake-jwt-token');
    expect(client).toBeDefined();
  });

  it('returns the same instance across calls (cached service client)', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const env = loadEnv();
    const a = getUserClient(env, null);
    const b = getUserClient(env, 'another-jwt');
    expect(a).toBe(b);
  });
});
