/**
 * KRODEX API — dev JWT auth.
 *
 * Phase 2 ships a development JWT (HS256, signed with
 * AUTH_JWT_SECRET) for API testing. In production the Supabase
 * access token would replace it; the verification contract stays
 * the same (HS256, sub claim, exp).
 *
 * Never use this in production. The dev flag and the literal
 * "dev-only-not-secure-replace-me-please-please" secret default
 * make accidental production use loud.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../errors';

const DEFAULT_TTL_SECONDS = 3600;
const ALG = 'HS256';
const HEADER = { alg: ALG, typ: 'JWT' };

export interface DevJwtClaims {
  /** Subject = KRODEX user UUID. */
  sub: string;
  /** Issued-at epoch seconds. */
  iat: number;
  /** Expiry epoch seconds. */
  exp: number;
  /** Free-form metadata (email, roles). Never trusted on read. */
  meta?: Readonly<Record<string, unknown>>;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/** Mint a dev JWT. The caller decides the subject and metadata. */
export function signDevJwt(
  secret: string,
  sub: string,
  options: { ttlSeconds?: number; meta?: Readonly<Record<string, unknown>> } = {},
): string {
  if (!secret || secret.length < 16) {
    throw new Error('signDevJwt: secret must be at least 16 characters');
  }
  const now = Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const claims: DevJwtClaims = {
    sub,
    iat: now,
    exp: now + ttl,
    ...(options.meta ? { meta: options.meta } : {}),
  };
  const headerPart = base64url(JSON.stringify(HEADER));
  const bodyPart = base64url(JSON.stringify(claims));
  const signingInput = `${headerPart}.${bodyPart}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(sig)}`;
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a dev JWT and return the claims. Throws UnauthorizedError
 * on any failure. The function does NOT swallow errors so the
 * Fastify preHandler can map them to a 401 envelope.
 */
export function verifyDevJwt(secret: string, token: string): DevJwtClaims {
  if (!token || token.split('.').length !== 3) {
    throw new UnauthorizedError('malformed token');
  }
  const parts = token.split('.');
  const headerPart = parts[0]!;
  const bodyPart = parts[1]!;
  const sigPart = parts[2]!;
  const signingInput = `${headerPart}.${bodyPart}`;

  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const received = base64urlDecode(sigPart);
  if (!constantTimeEqual(expected, received)) {
    throw new UnauthorizedError('invalid signature');
  }

  let claims: DevJwtClaims;
  try {
    claims = JSON.parse(base64urlDecode(bodyPart).toString('utf8')) as DevJwtClaims;
  } catch {
    throw new UnauthorizedError('malformed claims');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new UnauthorizedError('missing sub claim');
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    throw new UnauthorizedError('token expired');
  }
  return claims;
}

/** Extract a bearer token from an `Authorization: Bearer <token>` header. */
export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? (m[1] ?? null) : null;
}
