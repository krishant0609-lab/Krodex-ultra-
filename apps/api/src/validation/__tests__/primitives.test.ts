/**
 * KRODEX API — primitives + cursor encoding.
 */

import { describe, expect, it } from 'vitest';
import {
  Uuid,
  IsoDate,
  IsoTimestamp,
  nonEmptyString,
  optionalString,
  CursorPagination,
  encodeCursor,
  decodeCursor,
} from '../primitives';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('Uuid', () => {
  it('accepts a uuid', () => {
    expect(Uuid.safeParse(UUID).success).toBe(true);
  });
  it('rejects a non-uuid', () => {
    expect(Uuid.safeParse('abc').success).toBe(false);
  });
});

describe('IsoDate / IsoTimestamp', () => {
  it('IsoDate accepts YYYY-MM-DD', () => {
    expect(IsoDate.safeParse('2026-09-02').success).toBe(true);
  });
  it('IsoDate rejects other shapes', () => {
    expect(IsoDate.safeParse('2026-9-2').success).toBe(false);
    expect(IsoDate.safeParse('2026/09/02').success).toBe(false);
  });
  it('IsoTimestamp accepts Z', () => {
    expect(IsoTimestamp.safeParse('2026-09-02T00:00:00.000Z').success).toBe(true);
  });
  it('IsoTimestamp rejects naive date', () => {
    expect(IsoTimestamp.safeParse('2026-09-02').success).toBe(false);
  });
});

describe('nonEmptyString / optionalString', () => {
  it('nonEmptyString rejects empty after trim', () => {
    expect(nonEmptyString(10).safeParse('   ').success).toBe(false);
  });
  it('nonEmptyString enforces max', () => {
    expect(nonEmptyString(3).safeParse('abcd').success).toBe(false);
  });
  it('optionalString accepts undefined', () => {
    expect(optionalString(5).safeParse(undefined).success).toBe(true);
  });
  it('optionalString enforces max when present', () => {
    expect(optionalString(3).safeParse('abcd').success).toBe(false);
  });
});

describe('CursorPagination', () => {
  it('applies DEFAULT_PAGE_SIZE when limit omitted', () => {
    const r = CursorPagination.parse({});
    expect(r.limit).toBe(25);
  });
  it('rejects limit above MAX_PAGE_SIZE', () => {
    const r = CursorPagination.safeParse({ limit: 9999 });
    expect(r.success).toBe(false);
  });
  it('rejects limit < 1', () => {
    const r = CursorPagination.safeParse({ limit: 0 });
    expect(r.success).toBe(false);
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips after = string', () => {
    const token = encodeCursor({ after: UUID });
    const out = decodeCursor(token);
    expect(out).toEqual({ after: UUID });
  });
  it('round-trips dir=asc', () => {
    const token = encodeCursor({ after: UUID, dir: 'asc' });
    const out = decodeCursor(token);
    expect(out).toEqual({ after: UUID, dir: 'asc' });
  });
  it('returns null for garbage input', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });
  it('returns null when after is missing', () => {
    expect(decodeCursor(Buffer.from('{"dir":"asc"}', 'utf8').toString('base64'))).toBeNull();
  });
  it('returns null for invalid dir', () => {
    const bad = Buffer.from('{"after":"x","dir":"sideways"}', 'utf8')
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(decodeCursor(bad)).toBeNull();
  });
});
