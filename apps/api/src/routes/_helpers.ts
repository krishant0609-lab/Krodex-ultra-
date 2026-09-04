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

/**
 * Phase 15: short private cache for global, read-only tree routes
 * (subjects / topics / sub-topics / questions / question options).
 * The tree is the same for every authenticated user; a 60-second
 * window lets the in-app client amortize the warmup cost without
 * exposing the data to a shared cache. The envelope's
 * `requestId` + `timestamp` keep the response non-replayable across
 * users; the cache is `private` so intermediaries do not share it.
 */
export function setPrivateCache(reply: FastifyReply, maxAgeSeconds: number): void {
  reply.header('Cache-Control', `private, max-age=${maxAgeSeconds}`);
}

/**
 * Phase 15: explicit no-store for per-user dynamic routes
 * (notifications, progress, errors, attempt history, dashboard
 * rollups). The data is shaped by the auth.userId; we do not
 * want a stale value replayed even within the same browser
 * session.
 */
export function setNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
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
