/**
 * KRODEX API — dev-jwt unit tests.
 *
 * Verifies the full token lifecycle:
 *  - mint a JWT
 *  - verify the JWT returns the same claims
 *  - reject tampered tokens
 *  - reject expired tokens
 *  - reject malformed / missing-sub tokens
 *  - extract a bearer header correctly
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signDevJwt, verifyDevJwt, extractBearer, type DevJwtClaims } from '../dev-jwt';
import { UnauthorizedError } from '../../errors';

const SECRET = 'unit-test-secret-with-enough-entropy-1234567890';
const SUB = '11111111-1111-4111-8111-111111111111';

describe('signDevJwt', () => {
  it('mints a 3-part token', () => {
    const tok = signDevJwt(SECRET, SUB);
    expect(tok.split('.')).toHaveLength(3);
  });

  it('rejects a short secret', () => {
    expect(() => signDevJwt('short', SUB)).toThrow(/secret must be at least 16 characters/);
  });

  it('encodes the sub claim', () => {
    const tok = signDevJwt(SECRET, SUB, { meta: { email: 'a@b.co' } });
    const claims = verifyDevJwt(SECRET, tok);
    expect(claims.sub).toBe(SUB);
    expect(claims.meta?.email).toBe('a@b.co');
  });
});

describe('verifyDevJwt', () => {
  it('round-trips claims', () => {
    const tok = signDevJwt(SECRET, SUB, { ttlSeconds: 60 });
    const claims = verifyDevJwt(SECRET, tok);
    expect(claims.sub).toBe(SUB);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('throws on a tampered signature', () => {
    const tok = signDevJwt(SECRET, SUB);
    const parts = tok.split('.');
    const tampered = `${parts[0]}.${parts[1]}.AAAA`;
    expect(() => verifyDevJwt(SECRET, tampered)).toThrow(UnauthorizedError);
  });

  it('throws on a tampered body', () => {
    const tok = signDevJwt(SECRET, SUB);
    const parts = tok.split('.');
    // re-encode a forged body and keep the original signature
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker', iat: 0, exp: 9999999999 }))
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const tampered = `${parts[0]}.${forged}.${parts[2]}`;
    expect(() => verifyDevJwt(SECRET, tampered)).toThrow(UnauthorizedError);
  });

  it('throws on a token with the wrong number of parts', () => {
    expect(() => verifyDevJwt(SECRET, 'a.b')).toThrow(UnauthorizedError);
    expect(() => verifyDevJwt(SECRET, '')).toThrow(UnauthorizedError);
  });

  it('throws on a token with a missing sub', () => {
    // Build a token with a missing sub directly.
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const body = Buffer.from(JSON.stringify({ iat: 0, exp: 9_999_999_999 }))
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest()
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const tok = `${header}.${body}.${sig}`;
    expect(() => verifyDevJwt(SECRET, tok)).toThrow(UnauthorizedError);
  });

  it('throws on an expired token', () => {
    // Mint a token whose exp is in the past.
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const body = Buffer.from(JSON.stringify({ sub: SUB, iat: now - 100, exp: now - 50 }))
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest()
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(() => verifyDevJwt(SECRET, `${header}.${body}.${sig}`)).toThrow(UnauthorizedError);
  });
});

describe('extractBearer', () => {
  it('returns null on missing', () => {
    expect(extractBearer(undefined)).toBeNull();
  });
  it('returns null on wrong scheme', () => {
    expect(extractBearer('Basic abc')).toBeNull();
  });
  it('returns the token', () => {
    expect(extractBearer('Bearer xyz')).toBe('xyz');
  });
  it('is case-insensitive on the scheme', () => {
    expect(extractBearer('bearer xyz')).toBe('xyz');
  });
});
