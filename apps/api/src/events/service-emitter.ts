/**
 * KRODEX — service-layer event emitter.
 *
 * Per PHASE3_PLAN.md §4.2 + §6.2, every service-layer mutation
 * that introduces a domain-meaningful state change emits exactly
 * one event into event_outbox. This module is the *only* surface
 * the service layer is allowed to use to do that: it wraps
 * `outbox-writer.emit` with the producer-side eventId /
 * idempotencyKey formula and the (accountId, actorId) plumbing.
 *
 * The emission happens *after* the source mutation has
 * committed. The full at-the-same-transaction guarantee the TRD
 * prefers is not achievable from the service layer without a
 * wrapping RPC, so per §4.2 §[DEFAULT] we accept the weaker
 * "post-commit" guarantee: if the source mutation succeeded
 * but the emit fails, the user's primary state is intact and
 * only the downstream projections (notifications, evidence)
 * miss out. We log and continue; we never roll back a successful
 * mutation because a projection failed.
 *
 * No event is ever written to event_outbox from outside this
 * module + the SQL RPCs. The centralization is the audit point.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  type EventEnvelope,
  type EventPayloadMap,
  type EventType,
} from '@krodex/shared';

import { buildEnvelope, emit, type EmitResult } from './outbox-writer';

export interface ServiceEmitOptions<T extends EventType> {
  client: SupabaseClient;
  /** Owning user (matches event_outbox.user_id NOT NULL). */
  userId: string;
  /** Acting user (request principal). Null = system / worker. */
  actorId: string | null;
  eventType: T;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion?: number;
  payload: EventPayloadMap[T];
  /** When the event happened. Defaults to now(). */
  occurredAt?: string;
}

/**
 * Build the envelope for a service-layer event and call emit().
 *
 * Returns the EmitResult so the caller can decide what to do
 * with success / duplicate / error. Standard service-layer usage
 * is to log on error and otherwise discard.
 */
export async function serviceEmit<T extends EventType>(
  opts: ServiceEmitOptions<T>,
): Promise<EmitResult> {
  const envelope = buildEnvelope({
    eventType: opts.eventType,
    accountId: opts.userId,
    actorId: opts.actorId,
    aggregateType: opts.aggregateType,
    aggregateId: opts.aggregateId,
    aggregateVersion: opts.aggregateVersion ?? 1,
    eventId: computeEventId({
      event_type: opts.eventType,
      aggregate_type: opts.aggregateType,
      aggregate_id: opts.aggregateId,
      aggregate_version: opts.aggregateVersion ?? 1,
    }),
    idempotencyKey: computeIdempotencyKeyForEvent({
      event_type: opts.eventType,
      aggregate_type: opts.aggregateType,
      aggregate_id: opts.aggregateId,
      aggregate_version: opts.aggregateVersion ?? 1,
    }),
    payload: opts.payload,
    occurredAt: opts.occurredAt,
  });
  return emit(opts.client, envelope);
}
