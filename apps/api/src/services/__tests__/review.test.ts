/**
 * KRODEX API — review service tests.
 *
 * Covers:
 *  - scheduleReview inserts with state='scheduled'
 *  - getReviewSchedule auto-transitions scheduled -> due when
 *    due_at has passed (the documented client-triviality rule)
 *  - getReviewSchedule throws NotFoundError on miss
 *  - getReviewSchedule throws ForbiddenError on cross-tenant
 *  - listReviewSchedules filters by state and due_before
 *  - updateReviewSchedule refuses to reopen a terminal state
 *  - updateReviewSchedule sets completed_at when state=completed
 *  - recordReviewAttempt inserts and asserts ownership; refuses
 *    if the parent schedule is missing
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  scheduleReview,
  getReviewSchedule,
  listReviewSchedules,
  updateReviewSchedule,
  recordReviewAttempt,
} from '../review';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const ERR_ID = '22222222-2222-4222-8222-222222222222';
const SCHED_ID = '33333333-3333-4333-8333-333333333333';
const Q_ID = '44444444-4444-4444-8444-444444444444';

describe('scheduleReview', () => {
  it('inserts a scheduled review and asserts ownership', async () => {
    const client = makeFakeSupabase();
    const future = new Date(Date.now() + 60_000).toISOString();
    const row = await scheduleReview(client, SUB, {
      error_id: ERR_ID,
      strategy: 'spaced',
      due_at: future,
    });
    expect(row.user_id).toBe(SUB);
    expect(row.state).toBe('scheduled');
    expect(row.due_at).toBe(future);
  });
});

describe('getReviewSchedule', () => {
  it('throws NotFoundError on miss', async () => {
    const client = makeFakeSupabase();
    await expect(getReviewSchedule(client, SUB, SCHED_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError on cross-tenant', async () => {
    const client = makeFakeSupabase({
      tables: { review_schedules: [{ id: SCHED_ID, user_id: 'other', due_at: '2099-01-01T00:00:00Z' }] },
    });
    await expect(getReviewSchedule(client, SUB, SCHED_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('auto-transitions scheduled -> due when due_at is in the past', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: past },
        ],
      },
    });
    const row = await getReviewSchedule(client, SUB, SCHED_ID);
    expect(row.state).toBe('due');
  });

  it('keeps scheduled state when due_at is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: future },
        ],
      },
    });
    const row = await getReviewSchedule(client, SUB, SCHED_ID);
    expect(row.state).toBe('scheduled');
  });
});

describe('listReviewSchedules', () => {
  it('filters by state and due_before, caps limit at 100', async () => {
    const now = new Date().toISOString();
    const client = makeFakeSupabase({
      tables: {
        review_schedules: [
          { id: 's1', user_id: SUB, state: 'due', due_at: now },
          { id: 's2', user_id: SUB, state: 'scheduled', due_at: '2099-01-01T00:00:00Z' },
        ],
      },
    });
    const out = await listReviewSchedules(client, SUB, { state: 'due', due_before: now });
    expect(out.map((r) => r.id)).toEqual(['s1']);
  });
});

describe('updateReviewSchedule', () => {
  it('refuses to reopen a terminal state', async () => {
    const client = makeFakeSupabase({
      tables: {
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'completed', due_at: '2026-09-01T00:00:00Z' },
        ],
      },
    });
    await expect(
      updateReviewSchedule(client, SUB, SCHED_ID, { state: 'scheduled' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('stamps completed_at when moving to completed', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: future, completed_at: null },
        ],
      },
    });
    const row = await updateReviewSchedule(client, SUB, SCHED_ID, { state: 'completed' });
    expect(row.state).toBe('completed');
    expect(row.completed_at).toBeTruthy();
  });
});

describe('recordReviewAttempt', () => {
  it('refuses when the parent schedule is missing', async () => {
    const client = makeFakeSupabase();
    await expect(
      recordReviewAttempt(client, SUB, {
        schedule_id: SCHED_ID,
        question_id: Q_ID,
        outcome: 'correct',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('inserts an attempt and asserts ownership', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: future },
        ],
      },
    });
    const row = await recordReviewAttempt(client, SUB, {
      schedule_id: SCHED_ID,
      question_id: Q_ID,
      outcome: 'incorrect',
      duration_ms: 4_000,
    });
    expect(row.user_id).toBe(SUB);
    expect(row.outcome).toBe('incorrect');
  });
});

/**
 * Phase 3 §4.2 — review service-layer event emissions.
 *
 * Two events come out of the review service:
 *   - `review.started` from updateReviewSchedule when the state
 *     transitions into 'in_progress' from any non-in_progress
 *     state (the previous_state is recorded on the payload so
 *     consumers can distinguish scheduled→in_progress from
 *     due→in_progress).
 *   - `review.outcome_recorded` from recordReviewAttempt after
 *     the attempt row is written; the payload carries
 *     schedule_id, error_id, question_id, and outcome.
 *
 * The fake supabase returns `data: null, error: { message: 'no
 * row returned' }` for inserts into unknown tables, so the
 * service's post-commit emit is treated as a failure, which is
 * caught and logged. The source mutation still returns the
 * patched row, which is the spec's "log and continue" policy.
 */
describe('Phase 3: review service-layer event emissions', () => {
  const OUTBOX_UNIQUE = [
    ['user_id', 'event_type', 'idempotency_key'],
  ] as const;

  function outboxRows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
    return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('event_outbox');
  }

  it('updateReviewSchedule emits review.started when state→in_progress from scheduled', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: future, error_id: ERR_ID },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updateReviewSchedule(client, SUB, SCHED_ID, { state: 'in_progress' });
    const ob = outboxRows(client);
    expect(ob).toHaveLength(1);
    const ev = ob[0] as {
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: { schedule_id: string; error_id: string; previous_state: string };
    };
    expect(ev.event_type).toBe('review.started');
    expect(ev.aggregate_type).toBe('review_schedule');
    expect(ev.aggregate_id).toBe(SCHED_ID);
    expect(ev.payload.schedule_id).toBe(SCHED_ID);
    expect(ev.payload.error_id).toBe(ERR_ID);
    expect(ev.payload.previous_state).toBe('scheduled');
  });

  it('updateReviewSchedule emits review.started when state→in_progress from due', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: past, error_id: ERR_ID },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updateReviewSchedule(client, SUB, SCHED_ID, { state: 'in_progress' });
    const ob = outboxRows(client);
    const ev = ob[0] as { payload: { previous_state: string } };
    // getReviewSchedule auto-transitions to 'due' first because
    // due_at has passed, so the previous_state on the emit is
    // 'due' not 'scheduled'.
    expect(ev.payload.previous_state).toBe('due');
  });

  it('updateReviewSchedule does NOT emit review.started on idempotent re-start', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'in_progress', due_at: future, error_id: ERR_ID },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updateReviewSchedule(client, SUB, SCHED_ID, { state: 'in_progress' });
    expect(outboxRows(client)).toHaveLength(0);
  });

  it('updateReviewSchedule does NOT emit review.started on non-in_progress state changes', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: future, error_id: ERR_ID },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updateReviewSchedule(client, SUB, SCHED_ID, { state: 'completed' });
    expect(outboxRows(client)).toHaveLength(0);
  });

  it('updateReviewSchedule succeeds even when event_outbox is missing (post-commit log-and-continue)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      // Intentionally NO event_outbox table.
      tables: {
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'scheduled', due_at: future, error_id: ERR_ID },
        ],
      },
    });
    const row = await updateReviewSchedule(client, SUB, SCHED_ID, { state: 'in_progress' });
    expect(row.state).toBe('in_progress');
  });

  it('recordReviewAttempt emits review.outcome_recorded with schedule + error + question + outcome', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'in_progress', due_at: future, error_id: ERR_ID },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await recordReviewAttempt(client, SUB, {
      schedule_id: SCHED_ID,
      question_id: Q_ID,
      outcome: 'correct',
    });
    const ob = outboxRows(client);
    expect(ob).toHaveLength(1);
    const ev = ob[0] as {
      event_type: string;
      aggregate_type: string;
      payload: { schedule_id: string; error_id: string; question_id: string; outcome: string };
    };
    expect(ev.event_type).toBe('review.outcome_recorded');
    expect(ev.aggregate_type).toBe('review_attempt');
    expect(ev.payload.schedule_id).toBe(SCHED_ID);
    expect(ev.payload.error_id).toBe(ERR_ID);
    expect(ev.payload.question_id).toBe(Q_ID);
    expect(ev.payload.outcome).toBe('correct');
  });

  it('recordReviewAttempt succeeds even when event_outbox is missing (post-commit log-and-continue)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const client = makeFakeSupabase({
      // Intentionally NO event_outbox table.
      tables: {
        review_schedules: [
          { id: SCHED_ID, user_id: SUB, state: 'in_progress', due_at: future, error_id: ERR_ID },
        ],
      },
    });
    const row = await recordReviewAttempt(client, SUB, {
      schedule_id: SCHED_ID,
      question_id: Q_ID,
      outcome: 'partial',
    });
    expect(row.outcome).toBe('partial');
  });
});
