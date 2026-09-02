/**
 * KRODEX API — analytics freshness service tests.
 *
 * Per PHASE3_PLAN.md §7.2, the evidence endpoint is wrapped with
 * a `freshness` block:
 *   { lastEventAt: string | null, eventLagSeconds: number | null }
 *
 * Both are null when no events have been emitted. The
 * `eventLagSeconds` is `now - lastEventAt` rounded to seconds.
 *
 * The fake-supabase client returns rows in insertion order
 * (with `.order('occurred_at', { ascending: false })` returning
 * the rows in descending order). These tests assert both the
 * empty and non-empty cases; the lag math is verified with a
 * fixed `now` so it does not depend on the system clock.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { getAnalyticsFreshness } from '../analytics-freshness';

const SUB = '11111111-1111-4111-8111-111111111111';

describe('getAnalyticsFreshness', () => {
  it('returns nulls when the user has no events', async () => {
    const client = makeFakeSupabase();
    const out = await getAnalyticsFreshness(client, SUB, new Date('2026-09-02T12:00:00Z'));
    expect(out.lastEventAt).toBeNull();
    expect(out.eventLagSeconds).toBeNull();
  });

  it('returns lastEventAt and lag in seconds for a recent event', async () => {
    const now = new Date('2026-09-02T12:00:00Z');
    const last = new Date(now.getTime() - 30_000).toISOString(); // 30s ago
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: last },
          { user_id: SUB, event_type: 'error.classified', aggregate_id: 'e1', occurred_at: '2026-09-01T00:00:00Z' },
        ],
      },
    });
    const out = await getAnalyticsFreshness(client, SUB, now);
    expect(out.lastEventAt).toBe(last);
    expect(out.eventLagSeconds).toBe(30);
  });

  it('rounds lag to the nearest second (sub-second freshness)', async () => {
    const now = new Date('2026-09-02T12:00:00.500Z');
    const last = new Date(now.getTime() - 250).toISOString();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: last },
        ],
      },
    });
    const out = await getAnalyticsFreshness(client, SUB, now);
    expect(out.eventLagSeconds).toBe(0); // 250ms rounds to 0
  });

  it('caps lag at 0 when the last event is in the future (clock skew)', async () => {
    const now = new Date('2026-09-02T12:00:00Z');
    const last = new Date(now.getTime() + 5_000).toISOString();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: last },
        ],
      },
    });
    const out = await getAnalyticsFreshness(client, SUB, now);
    expect(out.eventLagSeconds).toBe(0);
  });

  it('ignores events for other users (user_id filter)', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          { user_id: 'other', event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: '2026-09-02T11:00:00Z' },
        ],
      },
    });
    const out = await getAnalyticsFreshness(client, SUB, new Date('2026-09-02T12:00:00Z'));
    expect(out.lastEventAt).toBeNull();
    expect(out.eventLagSeconds).toBeNull();
  });

  it('only counts events in the relevant type set', async () => {
    const now = new Date('2026-09-02T12:00:00Z');
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [
          // An unknown / non-relevant event type — should be ignored.
          { user_id: SUB, event_type: 'unknown.type', aggregate_id: 'a1', occurred_at: now.toISOString() },
          { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a2', occurred_at: '2026-09-02T11:00:00Z' },
        ],
      },
    });
    const out = await getAnalyticsFreshness(client, SUB, now);
    expect(out.lastEventAt).toBe('2026-09-02T11:00:00Z');
  });
});
