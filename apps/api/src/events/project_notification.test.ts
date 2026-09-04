/**
 * KRODEX — project_notification handler tests (Phase 12).
 *
 * Covers:
 *   - planNotificationForEvent: every supported event_type
 *   - computeDedupKey: deterministic, recurring-vs-once bucket
 *   - handle: dedup, preferences (kind + quiet hours + channel),
 *     channel delivery rows
 *   - fail-open: missing profile -> defaults, no throw
 */

import { describe, expect, it } from 'vitest';
import { computeEventId, computeIdempotencyKeyForEvent } from '@krodex/shared';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import { buildEnvelope } from './outbox-writer';
import {
  computeDedupKey,
  evaluatePreferences,
  handle,
  isRecurringKind,
  pickEnabledChannels,
  planNotificationForEvent,
} from './project_notification';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isInQuietHours,
} from '../services/notification-preferences-service';
import type { EventEnvelope, EventType } from '@krodex/shared';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const OCCURRED_AT = '2026-09-04T10:00:00.000Z';

function envOf<T extends EventType>(
  eventType: T,
  payload: EventEnvelope<T>['payload'],
  aggregateType = 'notification',
  aggregateId = 'a1',
): EventEnvelope<T> {
  const eventId = computeEventId({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  return buildEnvelope({
    eventType,
    accountId: USER_A,
    actorId: USER_A,
    aggregateType,
    aggregateId,
    aggregateVersion: 1,
    eventId,
    idempotencyKey,
    occurredAt: OCCURRED_AT,
    payload,
  });
}

function asRows<T>(client: unknown, table: string): T[] {
  return (client as { __rows: (t: string) => unknown[] }).__rows(table) as T[];
}

describe('planNotificationForEvent', () => {
  it('returns one error_recorded for error.lifecycle.active', () => {
    const env = envOf('error.lifecycle.active', {
      error_id: 'e1', from_status: null, to_status: 'active', trigger: 'attempt', reason: null, review_id: null,
    });
    const out = planNotificationForEvent(env);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('error_recorded');
    expect(out[0]?.severity).toBe('info');
    expect(out[0]?.source_aggregate_id).toBe('e1');
    expect(out[0]?.date_bucket).toBeNull();
  });

  it('returns error_reopened for error.lifecycle.reopened', () => {
    const env = envOf('error.lifecycle.reopened', {
      error_id: 'e1', from_status: 'resolved', to_status: 'reopened', trigger: 'attempt', reason: null, review_id: null,
    });
    const out = planNotificationForEvent(env);
    expect(out[0]?.kind).toBe('error_reopened');
    expect(out[0]?.severity).toBe('warning');
  });

  it('skips attempt.analyzed when there are no incorrect answers', () => {
    const env = envOf('attempt.analyzed', {
      attempt_id: 'a1', test_id: 't1',
      answers: [{ question_id: 'q1', outcome: 'correct' }],
    });
    expect(planNotificationForEvent(env)).toHaveLength(0);
  });

  it('emits attempt_analyzed when at least one answer is incorrect', () => {
    const env = envOf('attempt.analyzed', {
      attempt_id: 'a1', test_id: 't1',
      answers: [
        { question_id: 'q1', outcome: 'correct' },
        { question_id: 'q2', outcome: 'incorrect' },
      ],
    });
    const out = planNotificationForEvent(env);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('attempt_analyzed');
    expect((out[0]?.payload as { incorrect_count: number }).incorrect_count).toBe(1);
  });

  it('only emits review_outcome_recorded on correct outcomes', () => {
    const env = envOf('review.outcome_recorded', {
      schedule_id: 's1', error_id: 'e1', question_id: 'q1', outcome: 'correct',
    });
    expect(planNotificationForEvent(env)).toHaveLength(1);

    const env2 = envOf('review.outcome_recorded', {
      schedule_id: 's1', error_id: 'e1', question_id: 'q1', outcome: 'incorrect',
    });
    expect(planNotificationForEvent(env2)).toHaveLength(0);
  });

  it('emits task_missed, task_completed, backlog_recovery', () => {
    const m = envOf('task.missed', { task_id: 'tk1', plan_date: '2026-09-04', subject_id: 's1' });
    const c = envOf('task.completed', { task_id: 'tk1', plan_date: '2026-09-04', subject_id: 's1' });
    const b = envOf('backlog.item_created', { backlog_item_id: 'b1', source_task_id: 'tk1', reason: 'missed' });
    expect(planNotificationForEvent(m)[0]?.kind).toBe('task_missed');
    expect(planNotificationForEvent(c)[0]?.kind).toBe('task_completed');
    expect(planNotificationForEvent(b)[0]?.kind).toBe('backlog_recovery');
  });

  it('review.due uses the day bucket from due_at', () => {
    const env = envOf('review.due', {
      schedule_id: 's1', error_id: 'e1', due_at: '2026-09-04T12:00:00.000Z', strategy: 'spaced_repetition',
    });
    const out = planNotificationForEvent(env);
    expect(out[0]?.kind).toBe('review_due');
    expect(out[0]?.date_bucket).toBe('2026-09-04');
  });

  it('review.overdue uses the day bucket from due_at', () => {
    const env = envOf('review.overdue', {
      schedule_id: 's1', error_id: 'e1', due_at: '2026-09-03T00:00:00.000Z', overdue_by_seconds: 3600,
    });
    const out = planNotificationForEvent(env);
    expect(out[0]?.kind).toBe('review_overdue');
    expect(out[0]?.date_bucket).toBe('2026-09-03');
  });

  it('task.upcoming uses the day bucket from due_at', () => {
    const env = envOf('task.upcoming', {
      task_id: 'tk1', plan_date: '2026-09-04', subject_id: 's1', due_at: '2026-09-04T14:00:00.000Z',
    });
    const out = planNotificationForEvent(env);
    expect(out[0]?.kind).toBe('task_upcoming');
    expect(out[0]?.date_bucket).toBe('2026-09-04');
  });

  it('returns [] for non-notification events', () => {
    const env = envOf('attempt.submitted', {
      test_id: 't1', attempt_id: 'a1', correct_count: 0, incorrect_count: 0,
      partial_count: 0, skipped_count: 0, accuracy: '0', duration_ms: null, incorrect_question_ids: [],
    });
    expect(planNotificationForEvent(env)).toHaveLength(0);
  });
});

describe('computeDedupKey', () => {
  const plan = {
    user_id: USER_A,
    kind: 'review_due',
    severity: 'warning' as const,
    title: 't',
    body: null,
    payload: {},
    source_aggregate_id: 's1',
    date_bucket: '2026-09-04',
  };
  it('is deterministic for the same input', () => {
    expect(computeDedupKey(plan)).toBe(computeDedupKey(plan));
  });
  it('changes when source_aggregate_id changes', () => {
    const a = computeDedupKey(plan);
    const b = computeDedupKey({ ...plan, source_aggregate_id: 's2' });
    expect(a).not.toBe(b);
  });
  it('changes when the day bucket changes', () => {
    const a = computeDedupKey(plan);
    const b = computeDedupKey({ ...plan, date_bucket: '2026-09-05' });
    expect(a).not.toBe(b);
  });
});

describe('isRecurringKind / evaluatePreferences / pickEnabledChannels', () => {
  it('flags review_due and review_overdue as recurring', () => {
    expect(isRecurringKind('review_due')).toBe(true);
    expect(isRecurringKind('review_overdue')).toBe(true);
    expect(isRecurringKind('error_recorded')).toBe(false);
  });

  it('returns null when kind is enabled and not in quiet hours', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    const out = evaluatePreferences(prefs, 'UTC', new Date('2026-09-04T12:00:00.000Z'), 'review_due');
    expect(out).toBeNull();
  });

  it('returns kind_disabled when the kind is in disabled_kinds', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, disabled_kinds: ['review_due'] };
    const out = evaluatePreferences(prefs, 'UTC', new Date('2026-09-04T12:00:00.000Z'), 'review_due');
    expect(out).toBe('kind_disabled');
  });

  it('returns quiet_hours when inside a configured quiet window', () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quiet_hours: { enabled: true, start: '22:00', end: '08:00' },
    };
    // 23:00 UTC == inside the window
    const out = evaluatePreferences(prefs, 'UTC', new Date('2026-09-04T23:00:00.000Z'), 'review_due');
    expect(out).toBe('quiet_hours');
  });

  it('pickEnabledChannels reflects per-channel toggles', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, in_app_enabled: true, email_enabled: true, push_enabled: false };
    expect(pickEnabledChannels(prefs)).toEqual(['in_app', 'email']);
  });

  it('quiet hours: cross-midnight in IST', () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quiet_hours: { enabled: true, start: '22:00', end: '08:00' },
    };
    // 03:00 IST == 21:30 UTC previous day — inside
    const inside = isInQuietHours(prefs, 'Asia/Kolkata', new Date('2026-09-03T21:30:00.000Z'));
    expect(inside).toBe(true);
  });
});

describe('handle()', () => {
  it('inserts a notifications row and an in_app delivery row', async () => {
    const client = makeFakeSupabase({
      tables: {
        profiles: [{ id: 'p1', user_id: USER_A, settings: {}, users: { timezone: 'UTC' } }],
      },
      uniqueConstraints: { notifications: [['user_id', 'dedup_key']] },
    });
    const env = envOf('error.lifecycle.active', {
      error_id: 'e1', from_status: null, to_status: 'active', trigger: 'attempt', reason: null, review_id: null,
    });
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(1);

    const notifs = asRows<{ kind: string; dedup_key: string | null }>(client, 'notifications');
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.kind).toBe('error_recorded');
    expect(notifs[0]?.dedup_key).toMatch(/^[a-f0-9]{64}$/);

    const deliv = asRows<{ channel: string; state: string }>(client, 'notification_deliveries');
    expect(deliv).toHaveLength(1);
    expect(deliv[0]?.channel).toBe('in_app');
    expect(deliv[0]?.state).toBe('pending');
  });

  it('is idempotent on duplicate dedup_key (23505 -> no-op)', async () => {
    const client = makeFakeSupabase({
      tables: { profiles: [{ id: 'p1', user_id: USER_A, settings: {}, users: { timezone: 'UTC' } }] },
      uniqueConstraints: { notifications: [['user_id', 'dedup_key']] },
    });
    const env = envOf('review.due', {
      schedule_id: 's1', error_id: 'e1', due_at: '2026-09-04T12:00:00.000Z', strategy: 'spaced_repetition',
    });
    const a = await handle(client, env);
    const b = await handle(client, env);
    expect(a.kind === 'succeeded' && a.wrote).toBe(1);
    expect(b.kind === 'succeeded' && b.wrote).toBe(0);
    const notifs = asRows<{ kind: string }>(client, 'notifications');
    expect(notifs).toHaveLength(1);
  });

  it('skips when the kind is in disabled_kinds', async () => {
    const client = makeFakeSupabase({
      tables: {
        profiles: [{
          id: 'p1', user_id: USER_A,
          settings: { notification_preferences: { disabled_kinds: ['review_due'] } },
          users: { timezone: 'UTC' },
        }],
      },
    });
    const env = envOf('review.due', {
      schedule_id: 's1', error_id: 'e1', due_at: '2026-09-04T12:00:00.000Z', strategy: 'spaced_repetition',
    });
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(0);
    expect(out.skipped).toBe('all_suppressed_by_preferences');
  });

  it('skips when inside quiet hours', async () => {
    const client = makeFakeSupabase({
      tables: {
        profiles: [{
          id: 'p1', user_id: USER_A,
          settings: { notification_preferences: { quiet_hours: { enabled: true, start: '00:00', end: '23:59' } } },
          users: { timezone: 'UTC' },
        }],
      },
    });
    const env = envOf('task.upcoming', {
      task_id: 'tk1', plan_date: '2026-09-04', subject_id: 's1', due_at: '2026-09-04T14:00:00.000Z',
    });
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(0);
  });

  it('honors the channel toggles (in_app off, email on -> email only)', async () => {
    const client = makeFakeSupabase({
      tables: {
        profiles: [{
          id: 'p1', user_id: USER_A,
          settings: { notification_preferences: { in_app_enabled: false, email_enabled: true, push_enabled: false } },
          users: { timezone: 'UTC' },
        }],
      },
    });
    const env = envOf('task.completed', { task_id: 'tk1', plan_date: '2026-09-04', subject_id: 's1' });
    const out = await handle(client, env);
    expect(out.kind === 'succeeded' && out.wrote).toBe(1);
    const deliv = asRows<{ channel: string }>(client, 'notification_deliveries');
    expect(deliv.map((d) => d.channel)).toEqual(['email']);
  });

  it('fails open when the profile row is missing', async () => {
    const client = makeFakeSupabase({ tables: { profiles: [] } });
    const env = envOf('attempt.analyzed', {
      attempt_id: 'a1', test_id: 't1',
      answers: [{ question_id: 'q1', outcome: 'incorrect' }],
    });
    const out = await handle(client, env);
    expect(out.kind === 'succeeded' && out.wrote).toBe(1);
  });

  it('returns wrote=0 for non-notification events', async () => {
    const client = makeFakeSupabase({ tables: { profiles: [] } });
    const env = envOf('attempt.submitted', {
      test_id: 't1', attempt_id: 'a1', correct_count: 0, incorrect_count: 0,
      partial_count: 0, skipped_count: 0, accuracy: '0', duration_ms: null, incorrect_question_ids: [],
    });
    const out = await handle(client, env);
    expect(out.kind === 'succeeded' && out.wrote).toBe(0);
  });
});
