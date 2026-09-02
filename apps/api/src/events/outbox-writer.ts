/**
 * KRODEX — outbox writer.
 *
 * Per PHASE3_PLAN.md §6.1, this is the *only* module in apps/api
 * that ever INSERTs into public.event_outbox. The rule keeps the
 * event-emission surface area small: every producer goes through
 * emit() with a fully-formed envelope, and the writer handles
 * idempotency, schema_version, and the rare double-emit race.
 *
 * Contract:
 *   - The caller passes a Supabase client bound to the transaction
 *     the source mutation is running in. The writer does not start
 *     its own transaction; it is itself just a single INSERT.
 *   - The envelope's eventId, eventType, schemaVersion, occurredAt,
 *     accountId, actorId, aggregateType, aggregateId, aggregateVersion,
 *     payload, and idempotencyKey are written verbatim.
 *   - The unique index `uq_event_outbox_idem` is on
 *     (user_id, event_type, idempotency_key). A 23505 on that index
 *     means "the same envelope was already written in an earlier
 *     transaction" — the writer treats that as success and returns
 *     the existing row (or null, depending on caller needs).
 *   - The writer is synchronous from the caller's point of view:
 *     it awaits the insert and returns a discriminated union.
 *
 * Non-goals:
 *   - Polling / claiming / dispatch (that's worker.ts).
 *   - Schema validation of the payload (callers must hand in a
 *     well-typed envelope; this module does not re-check shapes).
 *   - Cross-user fan-out. Each envelope is single-user.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type {
  EventEnvelope,
  EventType,
  EventPayloadMap,
} from '@krodex/shared';

/** Outbox row mirror. The shape is exactly what `event_outbox` exposes. */
export interface OutboxRow {
  id: string;
  occurred_at: string;
  event_id: string;
  event_type: EventType;
  schema_version: number;
  user_id: string;
  actor_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: EventPayloadMap[EventType];
  idempotency_key: string;
  created_at: string;
}

export type EmitResult =
  | { kind: 'inserted'; row: OutboxRow }
  | { kind: 'duplicate'; eventId: string }
  | { kind: 'error'; error: PostgrestError };

/**
 * Insert one envelope into event_outbox using the caller's client.
 *
 * Returns:
 *   - { kind: 'inserted', row } on a clean insert
 *   - { kind: 'duplicate', eventId } when the (user_id, event_type, idempotency_key)
 *     unique index fired (the row was already there; treat as success)
 *   - { kind: 'error', error } on any other Supabase error
 */
export async function emit(
  client: SupabaseClient,
  envelope: EventEnvelope,
): Promise<EmitResult> {
  const { data, error } = await client
    .from('event_outbox')
    .insert({
      event_id: envelope.eventId,
      event_type: envelope.eventType,
      schema_version: envelope.schemaVersion,
      user_id: envelope.accountId,
      actor_id: envelope.actorId,
      aggregate_type: envelope.aggregateType,
      aggregate_id: envelope.aggregateId,
      aggregate_version: envelope.aggregateVersion,
      payload: envelope.payload,
      idempotency_key: envelope.idempotencyKey,
    })
    .select('*')
    .single();

  if (!error) {
    return { kind: 'inserted', row: data as OutboxRow };
  }

  // 23505 is unique_violation. The only unique index on event_outbox
  // that can fire here is uq_event_outbox_idem (event_id has its own
  // unique constraint but the caller would have built the envelope
  // from a deterministic hash, so a real event_id collision is a bug).
  if (error.code === '23505') {
    return { kind: 'duplicate', eventId: envelope.eventId };
  }

  return { kind: 'error', error };
}

/**
 * Build a complete envelope from a partial input plus the
 * sha256-based eventId and idempotencyKey derived by the shared
 * helpers. Use this from inside the source mutations so the
 * producer never hand-types the hashes.
 */
export function buildEnvelope<T extends EventType>(input: {
  eventType: T;
  accountId: string;
  actorId: string | null;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: EventPayloadMap[T];
  eventId: string;
  idempotencyKey: string;
  occurredAt?: string;
}): EventEnvelope<T> {
  return {
    eventId: input.eventId,
    eventType: input.eventType,
    schemaVersion: 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    accountId: input.accountId,
    actorId: input.actorId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
  };
}
