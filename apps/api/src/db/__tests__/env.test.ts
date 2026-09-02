/**
 * Unit tests for the env loader. Always runs — no DB required.
 *
 * Each test starts from a known-clean process.env so we can exercise
 * defaults, parsing, and the hasSupabase/hasServiceRole derivation
 * without leaking state between cases.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Wipe every var we read so the test fully controls inputs.
  for (const k of Object.keys(process.env)) delete process.env[k];
});

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('loadEnv — defaults', () => {
  it('returns sane defaults when nothing is set', () => {
    const env = loadEnv();
    expect(env.nodeEnv).toBe('development');
    expect(env.logLevel).toBe('info');
    expect(env.apiPort).toBe(3001);
    expect(env.apiHost).toBe('127.0.0.1');
    expect(env.webOrigin).toBe('http://localhost:3000');
    expect(env.hasSupabase).toBe(false);
    expect(env.hasServiceRole).toBe(false);
    expect(env.featureFlags.planner).toBe(false);
    expect(env.featureFlags.tests).toBe(false);
    expect(env.featureFlags.capture).toBe(false);
    expect(env.corsAllowedOrigins).toEqual(['http://localhost:3000']);
  });

  it('treats NODE_ENV values case-insensitively and falls back to development', () => {
    process.env.NODE_ENV = 'TEST';
    expect(loadEnv().nodeEnv).toBe('test');
    process.env.NODE_ENV = 'Production';
    expect(loadEnv().nodeEnv).toBe('production');
    process.env.NODE_ENV = 'weird';
    expect(loadEnv().nodeEnv).toBe('development');
  });

  it('derives hasSupabase / hasServiceRole from the URL and service key', () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    let env = loadEnv();
    expect(env.hasSupabase).toBe(true);
    expect(env.hasServiceRole).toBe(false);

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    env = loadEnv();
    expect(env.hasServiceRole).toBe(true);

    // Whitespace counts as "not set"
    process.env.SUPABASE_URL = '   ';
    env = loadEnv();
    expect(env.hasSupabase).toBe(false);
  });
});

describe('loadEnv — numeric parsing', () => {
  it('parses positive integers and falls back on garbage', () => {
    process.env.API_PORT = '4500';
    process.env.AUTH_JWT_TTL_SECONDS = '7200';
    process.env.STORAGE_SIGNED_URL_TTL_SECONDS = '300';
    process.env.RATE_LIMIT_AI_PER_MIN = '0'; // 0 should fall back (positive only)
    const env = loadEnv();
    expect(env.apiPort).toBe(4500);
    expect(env.authJwtTtlSeconds).toBe(7200);
    expect(env.storageSignedUrlTtlSeconds).toBe(300);
    expect(env.rateLimitAiPerMin).toBe(20);
  });

  it('ignores non-numeric values and falls back to defaults', () => {
    process.env.API_PORT = 'abc';
    process.env.AUTH_REFRESH_TTL_SECONDS = '   ';
    const env = loadEnv();
    expect(env.apiPort).toBe(3001);
    expect(env.authRefreshTtlSeconds).toBe(2_592_000);
  });
});

describe('loadEnv — feature flag parsing', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['on', true],
    ['0', false],
    ['false', false],
    ['', false],
  ])('parses %s as %s', (raw, expected) => {
    process.env.FEATURE_PLANNER_ENABLED = raw;
    expect(loadEnv().featureFlags.planner).toBe(expected);
  });
});

describe('loadEnv — CORS origin parsing', () => {
  it('splits comma-separated origins, trimming whitespace', () => {
    process.env.CORS_ALLOWED_ORIGINS = 'http://a.test , http://b.test,http://c.test';
    const env = loadEnv();
    expect(env.corsAllowedOrigins).toEqual([
      'http://a.test',
      'http://b.test',
      'http://c.test',
    ]);
  });

  it('falls back to the default origin when nothing is parseable', () => {
    process.env.CORS_ALLOWED_ORIGINS = '   ,  ,';
    expect(loadEnv().corsAllowedOrigins).toEqual(['http://localhost:3000']);
  });
});

describe('loadEnv — storage defaults', () => {
  it('uses the documented bucket names when env is empty', () => {
    const env = loadEnv();
    expect(env.storageBucketErrorCaptures).toBe('error-captures');
    expect(env.storageBucketQuestionSnapshots).toBe('question-snapshots');
  });
});

describe('loadEnv — immutability', () => {
  it('returns a frozen object so callers cannot mutate the cached config', () => {
    const env = loadEnv();
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      // @ts-expect-error — runtime check, not a type hole
      env.apiPort = 9999;
    }).toThrow();
  });
});
