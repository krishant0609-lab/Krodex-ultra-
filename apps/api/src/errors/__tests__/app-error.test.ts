/**
 * KRODEX API — AppError class hierarchy.
 *
 * Confirms every documented code maps to the right HTTP status
 * and that the subclasses carry the correct code.
 */

import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  DependencyUnavailableError,
  ForbiddenError,
  InternalError,
  InvalidStateError,
  IdempotencyKeyReusedError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  isAppError,
} from '../app-error';

const cases: Array<[string, AppError, number]> = [
  ['VALIDATION_ERROR', new ValidationError('x'), 400],
  ['UNAUTHORIZED', new UnauthorizedError(), 401],
  ['FORBIDDEN', new ForbiddenError(), 403],
  ['NOT_FOUND', new NotFoundError(), 404],
  ['CONFLICT', new ConflictError('dup'), 409],
  ['INVALID_STATE', new InvalidStateError('bad'), 409],
  ['IDEMPOTENCY_KEY_REUSED', new IdempotencyKeyReusedError('dup'), 409],
  ['DEPENDENCY_UNAVAILABLE', new DependencyUnavailableError('down'), 503],
  ['INTERNAL', new InternalError(), 500],
];

describe('AppError subclasses', () => {
  for (const [label, err, status] of cases) {
    it(`${label} -> ${status}`, () => {
      expect(err.code).toBe(label);
      expect(err.httpStatus).toBe(status);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
    });
  }
});

describe('options: context / fields / cause', () => {
  it('stores fields for the envelope', () => {
    const err = new ValidationError('bad', { fields: [{ path: 'a', message: 'x' }] });
    expect(err.fields?.[0]?.path).toBe('a');
  });
  it('stores context', () => {
    const err = new ConflictError('dup', { context: { key: 'v' } });
    expect(err.context).toEqual({ key: 'v' });
  });
  it('stores cause', () => {
    const cause = new Error('orig');
    const err = new InternalError('wrap', { cause });
    expect((err as { cause?: unknown }).cause).toBe(cause);
  });
});

describe('isAppError', () => {
  it('returns true on AppError', () => {
    expect(isAppError(new ValidationError('x'))).toBe(true);
  });
  it('returns false on plain Error', () => {
    expect(isAppError(new Error('x'))).toBe(false);
  });
  it('returns false on non-error', () => {
    expect(isAppError('x')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
