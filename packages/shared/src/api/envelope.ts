/**
 * KRODEX — shared API envelope types.
 *
 * Every response the KRODEX API returns is wrapped in a
 * `ApiEnvelope<T>` so the client can rely on a single shape
 * (success, data, error, requestId, timestamp). The HTTP status
 * still carries the primary signal — the envelope is for
 * machine-parseable contracts.
 *
 * Defined in @krodex/shared so both apps/api and apps/web see the
 * exact same shape.
 */

import type { ApiErrorCode } from './error-codes';

/** Successful response. */
export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  /** Echoed from the `X-Request-Id` header (or a generated one). */
  requestId: string;
  /** Server timestamp at response write (ISO 8601). */
  timestamp: string;
  /** Optional pagination block (only on list endpoints). */
  page?: never;
  /** Optional Idempotency-Key replay marker. */
  idempotencyReplay?: boolean;
}

/** Failed response. */
export interface ApiErrorEnvelope {
  success: false;
  data?: never;
  error: {
    /** Stable machine-readable code; see ./error-codes.ts. */
    code: ApiErrorCode;
    /** Human-readable message (safe to log; may be shown to user). */
    message: string;
    /** Optional field-level details for VALIDATION_ERROR. */
    fields?: ReadonlyArray<{
      path: string;
      message: string;
    }>;
    /** Free-form debug context. Never include secrets. */
    context?: Readonly<Record<string, unknown>>;
  };
  requestId: string;
  timestamp: string;
  page?: never;
  idempotencyReplay?: never;
}

/** Any envelope the API returns. */
export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;
