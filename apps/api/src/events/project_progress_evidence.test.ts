/**
 * KRODEX — project_progress_evidence handler tests.
 *
 * Exercises the pure planner (planEvidenceForEvent) and the
 * end-to-end handle() function via the FakeSupabase test client.
 */

import { describe, expect, it } from 'vitest';
import { computeEventId, computeIdempotencyKeyForEvent } from '@krodex/shared';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import {
  buildEnvelope,
  emit,
} from './outbox-writer';
import { handle, planEvidenceForEvent } from './project_progress_evidence';
import type { EventEnvelope, EventType } from '@krodex/shared';

const USER_A = '00000000-0000-0000-0000-00000000000a';

const EVIDENCE_UNIQUE = [
  ['user_id', 'dimension', 'ref_kind', 'ref_id'],
] as const;

function envelopeFor<T extends EventType>(
  eventType: T,
  payload: EventEnvelope<T>['payload'],
  aggregateType = 'attempt',
  aggregateId = 'agg-1',
  aggregateVersion = 1,
): EventEnvelope<T> {
  const eventId = computeEventId({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
  });
  return buildEnvelope({
    eventType,
    accountId: USER_A,
    actorId: USER_A,
    aggregateType,
    aggregateId,
    aggregateVersion,
    eventId,
    idempotencyKey,
    payload,
  });
}

describe('planEvidenceForEvent', () => {
  it('produces test_attempts + test_accuracy rows for attempt.submitted', () => {
    const env = envelopeFor('attempt.submitted', {
      test_id: 't1',
      attempt_id: 'a1',
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });
    const writes = planEvidenceForEvent(env);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.dimension).toBe('test_attempts');
    expect(writes[1]?.dimension).toBe('test_accuracy');
    expect(writes[1]?.delta).toBe('0.8');
  });

  it('produces errors_created for error.recorded', () => {
    const env = envelopeFor('error.recorded', {
      error_id: 'e1',
      question_id: 'q1',
      source_attempt_id: 'a1',
      recurrence_count: 1,
    });
    const writes = planEvidenceForEvent(env);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.dimension).toBe('errors_created');
    expect(writes[0]?.ref_id).toBe('e1');
  });

  it('produces errors_resolved and errors_reopened for the matching events', () => {
    const r = envelopeFor('error.resolved', {
      error_id: 'e1',
      trigger: 'review',
      review_schedule_id: 's1',
    });
    const w = planEvidenceForEvent(r);
    expect(w).toHaveLength(1);
    expect(w[0]?.dimension).toBe('errors_resolved');

    const o = envelopeFor('error.reopened', {
      error_id: 'e1',
      source_attempt_id: 'a1',
    });
    const w2 = planEvidenceForEvent(o);
    expect(w2).toHaveLength(1);
    expect(w2[0]?.dimension).toBe('errors_reopened');
  });

  it('produces review_completed for review.outcome_recorded', () => {
    const env = envelopeFor('review.outcome_recorded', {
      schedule_id: 's1',
      error_id: 'e1',
      question_id: 'q1',
      outcome: 'correct',
    });
    const writes = planEvidenceForEvent(env);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.dimension).toBe('review_completed');
    expect(writes[0]?.metadata).toMatchObject({ outcome: 'correct' });
  });

  it('produces planner_completion +1 for task.completed and -1 for task.missed', () => {
    const done = envelopeFor('task.completed', {
      task_id: 'p1',
      plan_date: '2026-09-02',
      subject_id: null,
    });
    const wd = planEvidenceForEvent(done);
    expect(wd).toHaveLength(1);
    expect(wd[0]?.dimension).toBe('planner_completion');
    expect(wd[0]?.delta).toBe('1');

    const missed = envelopeFor('task.missed', {
      task_id: 'p1',
      plan_date: '2026-09-02',
      subject_id: null,
    });
    const wm = planEvidenceForEvent(missed);
    expect(wm).toHaveLength(1);
    expect(wm[0]?.dimension).toBe('planner_completion');
    expect(wm[0]?.delta).toBe('-1');
  });

  it('produces no evidence rows for system.tick / notification.created / syllabus.node_archived / error.classified / attempt.analyzed / review.scheduled', () => {
    const types: EventType[] = [
      'system.tick',
      'notification.created',
      'syllabus.node_archived',
      'error.classified',
      'attempt.analyzed',
      'review.scheduled',
    ];
    for (const t of types) {
      const env = envelopeFor(
        t,
        // The payload shape varies per type; the planner only
        // looks at eventType and the small fields it needs.
        // Cast through unknown to keep the test compact.
        {} as never,
      );
      expect(planEvidenceForEvent(env)).toEqual([]);
    }
  });
});

describe('handle()', () => {
  it('writes the planned rows into progress_evidence and returns wrote=2 for attempt.submitted', async () => {
    const client = makeFakeSupabase({
      tables: { progress_evidence: [] },
      uniqueConstraints: { progress_evidence: EVIDENCE_UNIQUE },
    });
    const env = envelopeFor('attempt.submitted', {
      test_id: 't1',
      attempt_id: 'a1',
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(2);
    const rows = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('progress_evidence');
    expect(rows).toHaveLength(2);
  });

  it('returns succeeded with wrote=0 when there is no projection for the event type', async () => {
    const client = makeFakeSupabase({
      tables: { progress_evidence: [] },
      uniqueConstraints: { progress_evidence: EVIDENCE_UNIQUE },
    });
    const env = envelopeFor('notification.created', {
      notification_id: 'n1',
      kind: 'review_due',
      severity: 'info',
      source_event_id: 'e1',
      title: 't',
      body: null,
      metadata: {},
    });
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(0);
  });

  it('treats unique-constraint violations as success (idempotent retry)', async () => {
    const client = makeFakeSupabase({
      tables: { progress_evidence: [] },
      uniqueConstraints: { progress_evidence: EVIDENCE_UNIQUE },
    });
    const env = envelopeFor('error.recorded', {
      error_id: 'e1',
      question_id: 'q1',
      source_attempt_id: 'a1',
      recurrence_count: 1,
    });
    const first = await handle(client, env);
    expect(first.kind).toBe('succeeded');
    if (first.kind !== 'succeeded') throw new Error('narrow');
    expect(first.wrote).toBe(1);

    const second = await handle(client, env);
    expect(second.kind).toBe('succeeded');
    if (second.kind !== 'succeeded') throw new Error('narrow');
    expect(second.wrote).toBe(0);

    const rows = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('progress_evidence');
    expect(rows).toHaveLength(1);
  });

  it('throws on a non-unique PostgREST error', async () => {
    const client = makeFakeSupabase({
      tables: { progress_evidence: [] },
      errorOn: 'permission denied for table progress_evidence',
    });
    const env = envelopeFor('error.recorded', {
      error_id: 'e1',
      question_id: 'q1',
      source_attempt_id: 'a1',
      recurrence_count: 1,
    });
    await expect(handle(client, env)).rejects.toThrow(/permission denied/);
  });
});
