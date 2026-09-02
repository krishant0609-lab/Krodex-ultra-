/**
 * KRODEX — `project_analytics_rollup` handler tests.
 *
 * Per PHASE4_PLAN.md §13.1, this handler is the new Phase 4
 * fan-out handler that projects domain events into the
 * `analytics_daily_rollup` / `analytics_weekly_rollup` tables
 * via the `recompute_analytics_rollup` SQL function.
 *
 * The tests below cover:
 *   1. The pure predicate `isRollupTriggeringEvent` and the
 *      planner `planRollupForEvent` — both no-DB.
 *   2. The `handle()` function happy path: the SQL RPC is
 *      called with the right (user, since, until) and the
 *      outcome's `wrote` is the rows-recomputed count.
 *   3. The skip path: a `system.tick` envelope is NOT a
 *      rollup-triggering event for this handler (the scheduler
 *      job already invokes the SQL function directly for every
 *      active user).
 *   4. The unknown-event-type skip path.
 *
 * Note: This is a unit test for the handler module. The
 * service-level recompute (`recomputeRollupForUser`) has its
 * own service test; we stub the RPC here to assert the handler
 * passes the right args.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventEnvelope } from '@krodex/shared';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  HANDLER_NAME,
  handle,
  isRollupTriggeringEvent,
  planRollupForEvent,
} from '../project_analytics_rollup';

const USER_A = '11111111-1111-4111-8111-111111111111';

function envelope(eventType: string, accountId = USER_A): EventEnvelope {
  return {
    eventId: `evt_${eventType}_${accountId}`,
    eventType,
    accountId,
    actorId: null,
    aggregateType: 'aggregate',
    aggregateId: `agg_${eventType}_${accountId}`,
    aggregateVersion: 1,
    idempotencyKey: `idem_${eventType}_${accountId}`,
    payload: {},
    occurredAt: '2026-09-02T12:00:00.000Z',
    schemaVersion: 1,
  } as EventEnvelope;
}

describe('project_analytics_rollup', () => {
  it('HANDLER_NAME is stable', () => {
    expect(HANDLER_NAME).toBe('project_analytics_rollup');
  });

  describe('isRollupTriggeringEvent', () => {
    const YES = [
      'attempt.submitted',
      'attempt.analyzed',
      'error.recorded',
      'error.classified',
      'error.resolved',
      'error.reopened',
      'review.scheduled',
      'review.outcome_recorded',
      'task.completed',
      'task.missed',
      'syllabus.node_archived',
      'notification.created',
    ];
    for (const t of YES) {
      it(`returns true for ${t}`, () => {
        expect(isRollupTriggeringEvent(envelope(t))).toBe(true);
      });
    }

    it('returns false for unknown event types', () => {
      expect(isRollupTriggeringEvent(envelope('something.else'))).toBe(false);
    });
  });

  describe('planRollupForEvent', () => {
    const now = new Date('2026-09-02T12:00:00.000Z');

    it('returns null for system.tick (scheduler owns that path)', () => {
      expect(planRollupForEvent(envelope('system.tick'), now)).toBeNull();
    });

    it('returns null for unknown event types', () => {
      expect(planRollupForEvent(envelope('foo.bar'), now)).toBeNull();
    });

    it('returns the 5-minute trailing window for a real event', () => {
      const plan = planRollupForEvent(envelope('attempt.submitted'), now);
      expect(plan).not.toBeNull();
      expect(plan!.userId).toBe(USER_A);
      // 5 minutes = 300_000 ms.
      expect(now.getTime() - plan!.since.getTime()).toBe(5 * 60 * 1000);
      expect(plan!.until.getTime()).toBe(now.getTime());
    });
  });

  describe('handle()', () => {
    let client: SupabaseClient;
    beforeEach(() => {
      client = makeFakeSupabase({
        rpcImpls: {
          recompute_analytics_rollup: () => ({ data: 4, error: null }),
        },
      });
    });

    it('returns skipped outcome for system.tick', async () => {
      const outcome = await handle(client, envelope('system.tick'));
      expect(outcome.kind).toBe('succeeded');
      if (outcome.kind === 'succeeded') {
        expect(outcome.wrote).toBe(0);
        expect(outcome.skipped).toBe('not_a_rollup_triggering_event');
      }
    });

    it('returns skipped outcome for an unknown event type', async () => {
      const outcome = await handle(client, envelope('foo.bar'));
      expect(outcome.kind).toBe('succeeded');
      if (outcome.kind === 'succeeded') {
        expect(outcome.wrote).toBe(0);
        expect(outcome.skipped).toBe('not_a_rollup_triggering_event');
      }
    });

    it('invokes the SQL RPC for attempt.submitted and reports rows', async () => {
      const rpcSpy = vi.spyOn(client, 'rpc');
      const outcome = await handle(client, envelope('attempt.submitted'));
      expect(outcome.kind).toBe('succeeded');
      if (outcome.kind === 'succeeded') {
        expect(outcome.wrote).toBe(4);
        expect(outcome.skipped).toBeUndefined();
      }
      expect(rpcSpy).toHaveBeenCalledTimes(1);
      expect(rpcSpy).toHaveBeenCalledWith(
        'recompute_analytics_rollup',
        expect.objectContaining({
          p_user_id: USER_A,
          p_since: expect.any(String),
          p_until: expect.any(String),
        }),
      );
    });

    it('propagates SQL errors as thrown exceptions', async () => {
      const errClient = makeFakeSupabase({
        rpcImpls: {
          recompute_analytics_rollup: () => ({
            data: null,
            error: { code: 'P0001', message: 'sql boom' },
          }),
        },
      });
      // recomputeRollupForUser throws when the RPC returns an
      // error; the worker handles that as a retryable failure.
      await expect(handle(errClient, envelope('attempt.submitted'))).rejects.toThrow(/sql boom/);
    });
  });
});
