/**
 * KRODEX API — ownership helper tests.
 *
 * The RLS policies on user-scoped tables prevent cross-tenant
 * reads, but the API-side defence is `assertOwned`. These tests
 * confirm the helper throws on:
 *  - missing row
 *  - mismatched user_id
 *  - mismatched join field
 * and returns silently when the caller owns the row.
 */

import { describe, expect, it } from 'vitest';
import { assertOwned, isOwnedBy } from '../ownership';
import { ForbiddenError } from '../../errors';

describe('isOwnedBy', () => {
  it('returns false for a null row', () => {
    expect(isOwnedBy(null, 'u1')).toBe(false);
  });
  it('returns false when user_id is missing', () => {
    expect(isOwnedBy({}, 'u1')).toBe(false);
  });
  it('returns true on a match', () => {
    expect(isOwnedBy({ user_id: 'u1' }, 'u1')).toBe(true);
  });
  it('returns false on a mismatch', () => {
    expect(isOwnedBy({ user_id: 'u1' }, 'u2')).toBe(false);
  });
  it('checks a custom field', () => {
    expect(isOwnedBy({ owner_id: 'u1' }, 'u1', 'owner_id')).toBe(true);
  });
  it('rejects non-string values', () => {
    expect(isOwnedBy({ user_id: 42 }, 'u1')).toBe(false);
  });
});

describe('assertOwned', () => {
  it('throws ForbiddenError for null', () => {
    expect(() => assertOwned(null, 'u1')).toThrow(ForbiddenError);
  });
  it('throws ForbiddenError on a mismatch', () => {
    expect(() => assertOwned({ user_id: 'u2' }, 'u1')).toThrow(ForbiddenError);
  });
  it('returns silently on a match', () => {
    expect(() => assertOwned({ user_id: 'u1' }, 'u1')).not.toThrow();
  });
  it('accepts any of the listed fields (OR semantics)', () => {
    // A join row that holds both error_id and question_id should
    // be accepted if the user owns either side.
    expect(() => assertOwned({ error_id: 'u1' }, 'u1', ['error_id', 'question_id'])).not.toThrow();
    expect(() => assertOwned({ question_id: 'u1' }, 'u1', ['error_id', 'question_id'])).not.toThrow();
  });
  it('throws when none of the listed fields match', () => {
    expect(() =>
      assertOwned({ user_id: 'u2' }, 'u1', ['user_id', 'owner_id']),
    ).toThrow(ForbiddenError);
  });
  it('passes the checkedFields into the error context', () => {
    try {
      assertOwned({ user_id: 'u2' }, 'u1', ['user_id', 'owner_id']);
      throw new Error('expected throw');
    } catch (err) {
      const v = err as ForbiddenError;
      expect(v.code).toBe('FORBIDDEN');
      expect(v.httpStatus).toBe(403);
      expect((v.context as { checkedFields?: string[] })?.checkedFields).toEqual([
        'user_id',
        'owner_id',
      ]);
    }
  });
});
