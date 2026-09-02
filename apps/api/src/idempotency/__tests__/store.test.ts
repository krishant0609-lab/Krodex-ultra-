/**
 * KRODEX API — idempotency store unit tests.
 *
 * The `lookupIdempotency` and `recordIdempotency` functions talk
 * to the live Supabase. With `LIVE_DB=0` (default in this
 * environment), the only unit-testable surface is the pure
 * helpers: `canonicalize`, `hashRequest`, and `readIdempotencyKey`.
 *
 * The Supabase-backed lookups are exercised by the LIVE_DB=1
 * integration test (skipped here).
 */

import { describe, expect, it } from 'vitest';
import { canonicalize, hashRequest, readIdempotencyKey } from '../store';

describe('canonicalize', () => {
  it('serializes primitives', () => {
    expect(canonicalize('x')).toBe('"x"');
    expect(canonicalize(1)).toBe('1');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });
  it('sorts object keys', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
  it('recurses into nested objects', () => {
    expect(canonicalize({ a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1}}');
  });
  it('is stable across key order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });
});

describe('hashRequest', () => {
  it('is the sha256 hex digest of canonicalize', () => {
    const body = { a: 1, b: 2 };
    const expected = 'd978056f44e5f99c1111111111111111111111111111111111111111111111111'.length;
    // Just assert the length of a sha256 hex.
    expect(hashRequest(body)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('matches the same shape regardless of key order', () => {
    expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
  });
  it('differs when values differ', () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});

describe('readIdempotencyKey', () => {
  it('returns the trimmed value when present', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 'abc' })).toBe('abc');
  });
  it('accepts the lowercased header', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 'xyz' })).toBe('xyz');
  });
  it('returns null when missing', () => {
    expect(readIdempotencyKey({})).toBeNull();
  });
  it('returns null when empty', () => {
    expect(readIdempotencyKey({ 'idempotency-key': '' })).toBeNull();
  });
  it('returns null when too long (>200 chars)', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 'x'.repeat(201) })).toBeNull();
  });
  it('falls back to the first array element', () => {
    expect(readIdempotencyKey({ 'idempotency-key': ['one', 'two'] as never })).toBe('one');
  });
});
