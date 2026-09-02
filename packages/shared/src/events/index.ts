/**
 * KRODEX — public surface of the shared event module.
 *
 * The domain-event contract, idempotency helpers, and the
 * analytics-dimensions catalog are intentionally re-exported
 * from one barrel so callers never reach into the sub-modules.
 */

export * from './envelope';
export * from './idempotency';
export * from './dimensions';
