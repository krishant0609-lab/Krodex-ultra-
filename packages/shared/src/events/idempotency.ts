/**
 * KRODEX — event idempotency and eventId helpers.
 *
 * Per PHASE3_PLAN.md §4.3, eventId and idempotencyKey are both
 * derived as sha256 hex strings. The exact formula is locked here
 * so the producer (outbox-writer, RPCs, services) and the
 * consumer (worker) agree.
 *
 * eventId is the canonical identifier for the event.
 * idempotencyKey is what the uq_event_outbox_idem index dedups on.
 *
 * The formulas differ slightly:
 *   eventId        = sha256(event_type|aggregate_type|aggregate_id|version)
 *   idempotencyKey = sha256(event_type|aggregate_type|aggregate_id|version)  for non-HTTP emitters
 *                  = <http request Idempotency-Key>                          for HTTP-mutating routes
 *
 * The worker-emitted notification.created event uses
 *   eventId        = sha256('notification.created'|'notification'|<id>|1)
 *   idempotencyKey = sha256(source_event_id|handler_name)
 *
 * so different handlers can process the same upstream event
 * without colliding on the dedup index.
 */

import { createHash } from 'node:crypto';

export interface EventIdInput {
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
}

/** sha256 hex of the canonical input. Lowercase. */
function sha256Hex(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Canonical eventId for an event. 64-char lowercase hex. */
export function computeEventId(input: EventIdInput): string {
  return sha256Hex([
    input.event_type,
    input.aggregate_type,
    input.aggregate_id,
    String(input.aggregate_version),
  ]);
}

/**
 * Compute the outbox idempotency key for a non-HTTP emitter
 * (i.e. an RPC, a service-layer mutation, or a scheduled job).
 * The HTTP-emitter form takes the request's Idempotency-Key
 * header verbatim and is the route's responsibility.
 */
export function computeIdempotencyKeyForEvent(input: EventIdInput): string {
  return sha256Hex([
    input.event_type,
    input.aggregate_type,
    input.aggregate_id,
    String(input.aggregate_version),
  ]);
}

/**
 * Compute the idempotency key for a worker-emitted event whose
 * logical identity is "this handler processed this upstream
 * event". Distinct handlers get distinct keys, so the same
 * upstream event can fan out.
 */
export function computeWorkerIdempotencyKey(
  sourceEventId: string,
  handlerName: string,
): string {
  return sha256Hex([sourceEventId, handlerName]);
}
