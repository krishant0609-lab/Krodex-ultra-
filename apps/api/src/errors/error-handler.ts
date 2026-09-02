/**
 * KRODEX API — Fastify error handler.
 *
 * Centralizes the conversion of an `Error` thrown by a route
 * handler or preHandler into the documented `ApiEnvelope` shape.
 *
 * Behaviour:
 *   - `AppError` subclasses -> their code/httpStatus, message,
 *     optional fields, and context.
 *   - Fastify `FastifyError` with a 4xx status -> mapped to the
 *     closest ApiErrorCode.
 *   - zod `ZodError` -> VALIDATION_ERROR with field details.
 *   - Anything else -> INTERNAL / 500. The original message is
 *     logged but not returned to the client.
 *
 * Both the envelope shape and the HTTP status are produced by a
 * single `resolveError` pass so the outer handler doesn't have to
 * second-guess which status goes with which error class (e.g. a
 * plain ZodError that recurses into a ValidationError should still
 * emit 400, not 500).
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorEnvelope } from '@krodex/shared';
import { AppError, isAppError, ValidationError } from './app-error';
import { KRODEX_VERSION } from '@krodex/shared';

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = (req.id as string) ?? 'unknown';
    const timestamp = new Date().toISOString();
    const { envelope, status } = resolveError(err, requestId, timestamp);

    // Always log the original error for ops. Never let this block
    // the response.
    if (envelope.error.code === 'INTERNAL') {
      req.log.error({ err, requestId, krodex: KRODEX_VERSION }, 'krodex.api.unhandled');
    } else {
      req.log.warn(
        {
          err: { name: err.name, code: envelope.error.code, status },
          requestId,
        },
        'krodex.api.handled_error',
      );
    }

    reply.code(status).send(envelope);
  });
}

interface Resolved {
  envelope: ApiErrorEnvelope;
  status: number;
}

function resolveError(
  err: FastifyError | Error,
  requestId: string,
  timestamp: string,
): Resolved {
  if (isAppError(err)) {
    return {
      envelope: {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields ? { fields: err.fields.map((f) => ({ path: f.path, message: f.message })) } : {}),
          ...(err.context ? { context: err.context } : {}),
        },
        requestId,
        timestamp,
      },
      status: err.httpStatus,
    };
  }

  if (err instanceof ZodError) {
    const validationErr = new ValidationError('request body failed validation', {
      fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return resolveError(validationErr, requestId, timestamp);
  }

  const fastifyErr = err as FastifyError;
  const status = Number(fastifyErr.statusCode);
  if (Number.isFinite(status) && status >= 400 && status < 500) {
    // Map well-known Fastify errors to the closest KRODEX code.
    if (status === 400) {
      return resolveError(new ValidationError(fastifyErr.message || 'bad request'), requestId, timestamp);
    }
    if (status === 401) {
      return resolveError(
        new AppError('UNAUTHORIZED', fastifyErr.message || 'unauthorized'),
        requestId,
        timestamp,
      );
    }
    if (status === 403) {
      return resolveError(
        new AppError('FORBIDDEN', fastifyErr.message || 'forbidden'),
        requestId,
        timestamp,
      );
    }
    if (status === 404) {
      return resolveError(
        new AppError('NOT_FOUND', fastifyErr.message || 'not found'),
        requestId,
        timestamp,
      );
    }
    if (status === 409) {
      return resolveError(
        new AppError('CONFLICT', fastifyErr.message || 'conflict'),
        requestId,
        timestamp,
      );
    }
  }

  // Unknown error: 500 / INTERNAL. Hide the message.
  return {
    envelope: {
      success: false,
      error: {
        code: 'INTERNAL',
        message: 'internal error',
      },
      requestId,
      timestamp,
    },
    status: 500,
  };
}
