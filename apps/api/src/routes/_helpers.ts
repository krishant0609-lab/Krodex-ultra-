/**
 * KRODEX API — route helpers.
 *
 * Thin shims that make per-resource route files short and
 * uniform. Re-exports the server-level helpers and adds small
 * envelope wrappers.
 */

export { requireAuth } from '../server-decorations';

import type { FastifyReply } from 'fastify';
import type {
  ApiSuccessEnvelope,
  CursorPage,
} from '@krodex/shared';

export function ok<T>(reply: FastifyReply, data: T, status = 200): ApiSuccessEnvelope<T> {
  const requestId = (reply.request.id as string) ?? 'unknown';
  const env: ApiSuccessEnvelope<T> = {
    success: true,
    data,
    requestId,
    timestamp: new Date().toISOString(),
  };
  reply.code(status).send(env);
  return env;
}

export function okPage<T>(
  reply: FastifyReply,
  page: CursorPage<T>,
  status = 200,
): ApiSuccessEnvelope<CursorPage<T>> {
  return ok(reply, page, status);
}

/**
 * Common wrapper: every authenticated route declares
 * `preHandler: app.authPreHandler`. Some routes also want
 * idempotency; this helper exposes `idempotent()`.
 */
export { withIdempotency } from '../idempotency';
export type { WithIdempotencyInput, WithIdempotencyResult } from '../idempotency';
