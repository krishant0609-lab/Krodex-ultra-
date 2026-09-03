/**
 * KRODEX API — typed application errors.
 *
 * Every error that leaves the API is either a known `AppError` (a
 * subclass with a stable `code` and `httpStatus`) or an `Error`
 * that the Fastify error handler maps to `INTERNAL / 500`. The
 * API never returns raw `Error.message` to the client for an
 * `AppError` we did not author.
 *
 * Why a class hierarchy: services throw the most specific subclass
 * they can; the Fastify error handler turns it into the correct
 * envelope without the routes ever constructing a response body
 * themselves.
 */

import type { ApiErrorCode } from '@krodex/shared';

const HTTP_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  IDEMPOTENCY_REPLAY: 200,
  IDEMPOTENCY_KEY_REUSED: 409,
  DEPENDENCY_UNAVAILABLE: 503,
  AI_OUTPUT_INVALID: 422,
  EVIDENCE_CAPTURE_FAILED: 422,
  INTERNAL: 500,
};

export interface AppErrorField {
  path: string;
  message: string;
}

export interface AppErrorOptions {
  /** Free-form debug context. Never include secrets. */
  context?: Readonly<Record<string, unknown>>;
  /** Field-level validation details. */
  fields?: readonly AppErrorField[];
  /** Optional cause for tracing. */
  cause?: unknown;
}

export class AppError extends Error {
  public readonly code: ApiErrorCode;
  public readonly httpStatus: number;
  public readonly context: Readonly<Record<string, unknown>> | undefined;
  public readonly fields: readonly AppErrorField[] | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = HTTP_BY_CODE[code];
    this.context = options.context;
    this.fields = options.fields;
    if (options.cause !== undefined) {
      // Node 18+ supports `cause` on Error; assign to keep stacks
      // linked for debugging without leaking to clients.
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('VALIDATION_ERROR', message, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'authentication required', options: AppErrorOptions = {}) {
    super('UNAUTHORIZED', message, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'forbidden', options: AppErrorOptions = {}) {
    super('FORBIDDEN', message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'not found', options: AppErrorOptions = {}) {
    super('NOT_FOUND', message, options);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('CONFLICT', message, options);
  }
}

export class InvalidStateError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('INVALID_STATE', message, options);
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('IDEMPOTENCY_KEY_REUSED', message, options);
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('DEPENDENCY_UNAVAILABLE', message, options);
  }
}

export class AiOutputInvalidError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('AI_OUTPUT_INVALID', message, options);
  }
}

export class InternalError extends AppError {
  constructor(message = 'internal error', options: AppErrorOptions = {}) {
    super('INTERNAL', message, options);
  }
}

/** Type guard. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
