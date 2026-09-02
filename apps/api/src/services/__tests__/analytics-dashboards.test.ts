/**
 * KRODEX API — analytics dashboards service tests.
 *
 * Per PHASE3_PLAN.md §7.3, the overview endpoint returns:
 *   1. testsThisWeek  — distinct `attempt.submitted` events in
 *      the last 7 days, deduped by aggregate_id (the attempt id).
 *   2. activeErrors   — `error_entries WHERE status='active'`.
 *   3. dueReviews     — `review_schedules WHERE state IN
 *      ('scheduled','due') AND due_at <= now()`.
 *
 * All three are direct counts on existing tables. The tests
 * use the fake-supabase client with fixed `now` timestamps so
 * the time-window math is deterministic.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { getAnalyticsOverview } from '../analytics-dashboards';

const SUB = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-02T12:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SIX_DAYS_AGO = new Date(NOW.getTime() - 6 * ONE_DAY_MS).toISOString();
const EIGHT_DAYS_AGO = new Date(NOW.getTime() - 8 * ONE_DAY_MS).toISOString();
const HOUR_AGO = new Date(NOW.getTime() - ONE_DAY_MS / 24).toISOString();
const HOUR_FROM_NOW = new Date(NOW.getTime() + ONE_DAY_MS / 24).toISOString();

describe('getAnalyticsOverview', () => {
  it('returns zeros when the user has no data', async () => {
    const client = makeFakeSupabase();
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.testsThisWeek).toBe(0);
    expect(out.activeErrors).toBe(0);
    expect(out.dueReviews).toBe(0);
    expect(out.computedAt).toBe(NOW.toISOString());
  });

  it('testsThisWeek counts only events within the 7-day window', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: SIX_DAYS_AGO },
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a2', occurred_at: HOUR_AGO },
          // Outside the 7-day window:
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a3', occurred_at: EIGHT_DAYS_AGO },
        ],
      },
    });
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.testsThisWeek).toBe(2);
  });

  it('testsThisWeek dedupes by aggregate_id', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          // Two events for the same attempt (e.g. submit + retry).
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: HOUR_AGO },
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: SIX_DAYS_AGO },
        ],
      },
    });
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.testsThisWeek).toBe(1);
  });

  it('testsThisWeek ignores other event types', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: SUB, event_type: 'error.classified', aggregate_id: 'e1', occurred_at: HOUR_AGO },
          { user_id: SUB, event_type: 'task.completed', aggregate_id: 't1', occurred_at: HOUR_AGO },
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: HOUR_AGO },
        ],
      },
    });
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.testsThisWeek).toBe(1);
  });

  it('testsThisWeek is per-user (does not leak across tenants)', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: 'other', event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: HOUR_AGO },
        ],
      },
    });
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.testsThisWeek).toBe(0);
  });

  it('activeErrors counts only status=active rows', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [
          { user_id: SUB, status: 'active' },
          { user_id: SUB, status: 'active' },
          { user_id: SUB, status: 'resolved' },
          { user_id: SUB, status: 'archived' },
          { user_id: 'other', status: 'active' },
        ],
      },
    });
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.activeErrors).toBe(2);
  });

  it('dueReviews counts scheduled+overdue AND due rows for this user', async () => {
    const client = makeFakeSupabase({
      tables: {
        review_schedules: [
          // Scheduled, past due — counts.
          { user_id: SUB, state: 'scheduled', due_at: HOUR_AGO, metadata: {} },
          // Already marked 'due' by the service — counts.
          { user_id: SUB, state: 'due', due_at: HOUR_AGO, metadata: {} },
          // Scheduled, not yet due — does not count.
          { user_id: SUB, state: 'scheduled', due_at: HOUR_FROM_NOW, metadata: {} },
          // Terminal state — does not count.
          { user_id: SUB, state: 'completed', due_at: HOUR_AGO, metadata: {} },
          { user_id: SUB, state: 'skipped', due_at: HOUR_AGO, metadata: {} },
          // Other user — does not count.
          { user_id: 'other', state: 'due', due_at: HOUR_AGO, metadata: {} },
        ],
      },
    });
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.dueReviews).toBe(2);
  });

  it('returns the canonical envelope shape with computedAt stamped at the end', async () => {
    const client = makeFakeSupabase();
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(Object.keys(out).sort()).toEqual(
      ['activeErrors', 'computedAt', 'dueReviews', 'metrics', 'testsThisWeek', 'windowLabel'].sort(),
    );
    expect(out.computedAt).toBe(NOW.toISOString());
  });

  it('combines all three counts into one snapshot', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: HOUR_AGO },
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a2', occurred_at: SIX_DAYS_AGO },
        ],
        error_entries: [
          { user_id: SUB, status: 'active' },
        ],
        review_schedules: [
          { user_id: SUB, state: 'due', due_at: HOUR_AGO },
        ],
      },
    });
    const out = await getAnalyticsOverview(client, SUB, NOW);
    expect(out.testsThisWeek).toBe(2);
    expect(out.activeErrors).toBe(1);
    expect(out.dueReviews).toBe(1);
  });
});
