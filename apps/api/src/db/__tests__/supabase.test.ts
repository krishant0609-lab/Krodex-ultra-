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

describe('getUserClient — guard behavior', () => {
  it('throws when SUPABASE_URL is missing', () => {
    process.env.SUPABASE_ANON_KEY = 'k';
    const env = loadEnv();
    expect(() => getUserClient(env, null)).toThrow(/SUPABASE_URL/);
  });

  it('throws when the anon key is missing', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    const env = loadEnv();
    expect(() => getUserClient(env, null)).toThrow(/ANON_KEY/);
  });

  it('constructs a logged-out client when only URL + anon key are present', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_ANON_KEY = 'anon-test-key';
    const env = loadEnv();
    const client = getUserClient(env, null);
    expect(client).toBeDefined();
  });

  it('constructs a JWT-bearing client when a token is passed', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_ANON_KEY = 'anon-test-key';
    const env = loadEnv();
    const client = getUserClient(env, 'fake-jwt-token');
    expect(client).toBeDefined();
  });
});
