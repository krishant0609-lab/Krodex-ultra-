/**
 * KRODEX — shared API namespace.
 *
 * Re-exports the response envelope, cursor pagination, and the
 * error-code taxonomy. Apps/api builds the runtime helpers (zod
 * schemas, the Fastify error handler, the idempotency store) on
 * top of these types. Apps/web consumes them for the client.
 */

export * from './envelope';
export * from './error-codes';
export * from './pagination';
export * from './ai';
