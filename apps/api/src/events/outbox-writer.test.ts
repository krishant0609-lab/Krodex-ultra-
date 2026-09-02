/**
 * KRODEX — outbox-writer unit tests.
 *
 * Verifies the three emission outcomes documented in §6.1:
 *   1. clean insert returns the new row
 *   2. duplicate on the (user_id, event_type, idempotency_key) unique
 *      index returns { kind: 'duplicate' } — this is the contract
 *      the rest of the system relies on for "already emitted, fine"
 *   3. other PostgREST errors are surfaced as { kind: 'error' }
 *
 * Also exercises buildEnvelope() for the well-known shape invariants.
 */

import { describe, expect, it } from 'vitest';

import {
  computeEventId,
  computeIdempotencyKeyForEvent,
} from '@krodex/shared';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import { buildEnvelope, emit } from './outbox-writer';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const USER_B = '00000000-0000-0000-0000-00000000000b';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function makeEnvelope(overrides: Partial<{
  accountId: string;
  eventType: 'attempt.submitted';
  aggregateId: string;
  aggregateVersion: number;
}> = {}) {
  const eventType = overrides.eventType ?? 'attempt.submitted';
  const aggregateId = overrides.aggregateId ?? 'attempt-1';
  const aggregateVersion = overrides.aggregateVersion ?? 1;
  const eventId = computeEventId({
    event_type: eventType,
    aggregate_type: 'attempt',
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: eventType,
    aggregate_type: 'attempt',
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
  });
  return buildEnvelope({
    eventType,
    accountId: overrides.accountId ?? USER_A,
    actorId: overrides.accountId ?? USER_A,
    aggregateType: 'attempt',
    aggregateId,
    aggregateVersion,
    eventId,
    idempotencyKey,
    payload: {
      test_id: '00000000-0000-0000-0000-000000000001',
      attempt_id: aggregateId,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: [],
    },
  });
}

describe('outbox-writer.emit', () => {
  it('inserts a new row and returns the OutboxRow', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    const env = makeEnvelope();
    const result = await emit(client, env);

    expect(result.kind).toBe('inserted');
    if (result.kind !== 'inserted') throw new Error('narrow');
    expect(result.row.event_id).toBe(env.eventId);
    expect(result.row.event_type).toBe('attempt.submitted');
    expect(result.row.user_id).toBe(USER_A);
    expect(result.row.aggregate_type).toBe('attempt');
    expect(result.row.aggregate_id).toBe('attempt-1');
    expect(result.row.aggregate_version).toBe(1);
    expect(result.row.payload).toEqual(env.payload);
    expect(result.row.idempotency_key).toBe(env.idempotencyKey);
  });

  it('returns duplicate when the (user_id, event_type, idempotency_key) unique fires', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    const env = makeEnvelope();
    const first = await emit(client, env);
    expect(first.kind).toBe('inserted');

    const second = await emit(client, env);
    expect(second.kind).toBe('duplicate');
    if (second.kind !== 'duplicate') throw new Error('narrow');
    expect(second.eventId).toBe(env.eventId);

    // Table should still have only one row.
    const rows = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(rows).toHaveLength(1);
  });

  it('treats two envelopes with different idempotency keys as separate rows', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    const e1 = makeEnvelope({ aggregateId: 'attempt-1' });
    const e2 = makeEnvelope({ aggregateId: 'attempt-2' });

    const r1 = await emit(client, e1);
    const r2 = await emit(client, e2);
    expect(r1.kind).toBe('inserted');
    expect(r2.kind).toBe('inserted');
  });

  it('treats the same idempotency key from a different user as a separate row', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    const e1 = makeEnvelope({ accountId: USER_A });
    const e2 = makeEnvelope({ accountId: USER_B });

    const r1 = await emit(client, e1);
    const r2 = await emit(client, e2);
    expect(r1.kind).toBe('inserted');
    expect(r2.kind).toBe('inserted');
  });

  it('surfaces non-unique errors as { kind: error }', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      errorOn: 'permission denied for table event_outbox',
    });

    const result = await emit(client, makeEnvelope());
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('narrow');
    expect(result.error.message).toContain('permission denied');
  });
});

describe('outbox-writer.buildEnvelope', () => {
  it('stamps schemaVersion=1 and a default occurredAt when none is given', () => {
    const env = makeEnvelope();
    expect(env.schemaVersion).toBe(1);
    expect(typeof env.occurredAt).toBe('string');
    // ISO-8601 with the Z timezone designator.
    expect(env.occurredAt).toMatch(/T.+Z$/);
  });

  it('honors a caller-supplied occurredAt', () => {
    const ts = '2026-09-02T12:00:00.000Z';
    const env = buildEnvelope({
      eventType: 'attempt.submitted',
      accountId: USER_A,
      actorId: USER_A,
      aggregateType: 'attempt',
      aggregateId: 'attempt-1',
      aggregateVersion: 1,
      eventId: 'e1',
      idempotencyKey: 'k1',
      occurredAt: ts,
      payload: {
        test_id: 't',
        attempt_id: 'attempt-1',
        correct_count: 0,
        incorrect_count: 0,
        partial_count: 0,
        skipped_count: 0,
        accuracy: '0',
        duration_ms: null,
        incorrect_question_ids: [],
      },
    });
    expect(env.occurredAt).toBe(ts);
  });
});
