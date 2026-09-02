/**
 * KRODEX — error code taxonomy.
 *
 * Stable, machine-readable error codes. The API envelope's
 * `error.code` is always one of these values. HTTP status still
 * carries the primary signal; the code is for branching.
 *
 * Adding a new code: append here, add to ApiErrorCode union, and
 * update apps/api/src/errors/app-error.ts so the Fastify error
 * handler maps it to the right HTTP status.
 */

/** Every error code the API can return to the client. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'IDEMPOTENCY_REPLAY'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'AI_OUTPUT_INVALID'
  | 'EVIDENCE_CAPTURE_FAILED'
  | 'INTERNAL';

export const API_ERROR_CODES: readonly ApiErrorCode[] = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_STATE',
  'IDEMPOTENCY_REPLAY',
  'IDEMPOTENCY_KEY_REUSED',
  'DEPENDENCY_UNAVAILABLE',
  'AI_OUTPUT_INVALID',
  'EVIDENCE_CAPTURE_FAILED',
  'INTERNAL',
] as const;
