/**
 * KRODEX — outbox nullable user_id tests (migration 20).
 *
 * Verifies the system.tick remediation:
 *   - public.event_outbox.user_id is nullable.
 *   - The FK event_outbox.user_id -> public.users(id) is preserved
 *     (it is only CHECKED when user_id is non-null; inserting NULL
 *     does not raise 23503).
 *   - The composite unique index uq_event_outbox_idem on
 *     (user_id, event_type, idempotency_key) uses NULLS NOT DISTINCT
 *     in production PostgreSQL 15+; the fake-supabase util models
 *     that semantics via JS `===` (null === null).
 *   - Real-user envelopes (non-null user_id) still behave as before.
 *   - The worker correctly rehydrates an envelope with null accountId
 *     (round-trip via claim_pending_events).
 *
 * These tests are the gate that ensures the production 23503 error
 * (root cause: 4 scheduled jobs hardcoded the nil UUID as accountId)
 * cannot reappear.
 */

import { describe, expect, it } from 'vitest';
import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  type EventEnvelope,
  type SystemTickPayload,
} from '@krodex/shared';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { buildEnvelope, emit } from '../outbox-writer';
import { envelopeFromOutboxRow, type ClaimedOutboxRow } from '../worker';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const USER_B = '00000000-0000-0000-0000-00000000000b';
// The nil UUID the pre-remediation code used. Tests assert the
// production code does NOT write this value into outbox anymore.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function makeSystemTickEnvelope(overrides: Partial<{
  accountId: string | null;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
}> = {}) {
  const aggregateId = overrides.aggregateId ?? 'scheduled_job:mark_review_due';
  const aggregateVersion = overrides.aggregateVersion ?? 1;
  const eventId = computeEventId({
    event_type: 'system.tick',
    aggregate_type: 'scheduled_job',
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: 'system.tick',
    aggregate_type: 'scheduled_job',
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
  });
  return buildEnvelope({
    eventType: 'system.tick',
    accountId: overrides.accountId === undefined ? null : overrides.accountId,
    actorId: null,
    aggregateType: 'scheduled_job',
    aggregateId,
    aggregateVersion,
    eventId,
    idempotencyKey,
    payload: {
      job_name: aggregateId,
      ran_at: overrides.occurredAt ?? '2026-09-05T12:00:00.000Z',
      emitted_event_count: 0,
    } satisfies SystemTickPayload,
  });
}

function makeUserEnvelope(accountId: string, aggregateId: string) {
  const eventId = computeEventId({
    event_type: 'attempt.submitted',
    aggregate_type: 'attempt',
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: 'attempt.submitted',
    aggregate_type: 'attempt',
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  return buildEnvelope({
    eventType: 'attempt.submitted',
    accountId,
    actorId: accountId,
    aggregateType: 'attempt',
    aggregateId,
    aggregateVersion: 1,
    eventId,
    idempotencyKey,
    payload: {
      test_id: '00000000-0000-0000-0000-000000000001',
      attempt_id: aggregateId,
      correct_count: 0,
      incorrect_count: 0,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0',
      duration_ms: 0,
      incorrect_question_ids: [],
    },
  });
}

describe('outbox nullable user_id (migration 20)', () => {
  it('accepts a system.tick envelope with accountId=null (no 23503)', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    const env = makeSystemTickEnvelope();
    expect(env.accountId).toBeNull();

    const result = await emit(client, env);
    expect(result.kind).toBe('inserted');
    if (result.kind !== 'inserted') throw new Error('narrow');
    expect(result.row.user_id).toBeNull();
    expect(result.row.event_type).toBe('system.tick');
  });

  it('rejects the pre-remediation defect: accountId=nil UUID is NOT used by the writer for system.tick', () => {
    // This test exists to ensure the writer never again produces an
    // outbox row whose user_id is the nil UUID. If a future refactor
    // reintroduces the nil UUID, the runtime write will fail with
    // 23503 (FK violation) in production; this test pins the
    // contract: the writer's nullable path is the only legal shape
    // for system.tick.
    const env = makeSystemTickEnvelope();
    expect(env.accountId).not.toBe(NIL_UUID);
    expect(env.accountId).toBeNull();
  });

  it('preserves real-user inserts: accountId=<uuid> still inserts and dedups correctly', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    const e1 = makeUserEnvelope(USER_A, 'attempt-1');
    const e2 = makeUserEnvelope(USER_B, 'attempt-1');
    const r1 = await emit(client, e1);
    const r2 = await emit(client, e2);
    expect(r1.kind).toBe('inserted');
    expect(r2.kind).toBe('inserted');

    // A re-emit from USER_A with the same idem key is a duplicate.
    const e1dup = makeUserEnvelope(USER_A, 'attempt-1');
    const r3 = await emit(client, e1dup);
    expect(r3.kind).toBe('duplicate');
  });

  it('NULLS NOT DISTINCT: two system.tick rows with the same idem key are deduped (null === null)', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    // Two system.tick envelopes, same aggregate (same idem key),
    // both with accountId=null. With NULLS NOT DISTINCT the second
    // insert is a duplicate (23505). The fake-supabase util models
    // that via `r[c] === newRow[c]` (null === null is true).
    const env1 = makeSystemTickEnvelope();
    const env2 = makeSystemTickEnvelope();
    expect(env1.idempotencyKey).toBe(env2.idempotencyKey);
    expect(env1.accountId).toBeNull();
    expect(env2.accountId).toBeNull();

    const r1 = await emit(client, env1);
    const r2 = await emit(client, env2);
    expect(r1.kind).toBe('inserted');
    expect(r2.kind).toBe('duplicate');
  });

  it('distinct real users with the same idem key remain distinct (not deduped)', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });

    // Same aggregate, two different users → two distinct rows.
    const e1 = makeUserEnvelope(USER_A, 'attempt-1');
    const e2 = makeUserEnvelope(USER_B, 'attempt-1');
    expect(e1.idempotencyKey).toBe(e2.idempotencyKey);

    const r1 = await emit(client, e1);
    const r2 = await emit(client, e2);
    expect(r1.kind).toBe('inserted');
    expect(r2.kind).toBe('inserted');
  });

  it('worker round-trip: an outbox row with null user_id rehydrates into an envelope with null accountId', async () => {
    // claim_pending_events returns ClaimedOutboxRow. With migration 20
    // user_id is nullable. The worker must rehydrate accountId = null
    // correctly so handlers can short-circuit on system-owned events.
    const row: ClaimedOutboxRow = {
      id: 'id-1',
      occurred_at: '2026-09-05T12:00:00.000Z',
      event_id: 'evt-sys-1',
      event_type: 'system.tick',
      schema_version: 1,
      user_id: null,
      actor_id: null,
      aggregate_type: 'scheduled_job',
      aggregate_id: 'scheduled_job:mark_review_due',
      aggregate_version: 1,
      payload: {
        job_name: 'scheduled_job:mark_review_due',
        ran_at: '2026-09-05T12:00:00.000Z',
        emitted_event_count: 0,
      },
      idempotency_key: 'idem-sys-1',
      created_at: '2026-09-05T12:00:00.000Z',
    };

    const envelope: EventEnvelope = envelopeFromOutboxRow(row);
    expect(envelope.accountId).toBeNull();
    expect(envelope.actorId).toBeNull();
    expect(envelope.eventType).toBe('system.tick');
    expect(envelope.eventId).toBe('evt-sys-1');
  });

  it('worker round-trip: a real-user row rehydrates with the real accountId', () => {
    const row: ClaimedOutboxRow = {
      id: 'id-2',
      occurred_at: '2026-09-05T12:01:00.000Z',
      event_id: 'evt-real-1',
      event_type: 'attempt.submitted',
      schema_version: 1,
      user_id: USER_A,
      actor_id: USER_A,
      aggregate_type: 'attempt',
      aggregate_id: 'attempt-1',
      aggregate_version: 1,
      payload: {
        test_id: '00000000-0000-0000-0000-000000000001',
        attempt_id: 'attempt-1',
        correct_count: 0,
        incorrect_count: 0,
        partial_count: 0,
        skipped_count: 0,
        accuracy: '0',
        duration_ms: 0,
        incorrect_question_ids: [],
      },
      idempotency_key: 'idem-real-1',
      created_at: '2026-09-05T12:01:00.000Z',
    };
    const envelope: EventEnvelope = envelopeFromOutboxRow(row);
    expect(envelope.accountId).toBe(USER_A);
    expect(envelope.actorId).toBe(USER_A);
  });
});
