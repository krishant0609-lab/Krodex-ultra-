/**
 * KRODEX — scheduled-jobs runner tests.
 *
 * The runner:
 *   - on `runOnce()`, calls both jobs sequentially and reports
 *     their structured results;
 *   - on `start()`, arms one timer per job at the configured
 *     interval;
 *   - on `stop()`, clears the timers.
 *
 * We inject a fake timer harness so the test is deterministic.
 */

import { describe, expect, it, vi } from 'vitest';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import { registerScheduledJobs, type JobLogger } from './scheduled-jobs';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function makeLogger(): JobLogger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** A tiny fake interval harness. */
function makeFakeTimers() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const setIntervalFn = vi.fn((cb: () => void, _ms: number) => {
    const h = nextHandle++;
    callbacks.set(h, cb);
    return h;
  });
  const clearIntervalFn = vi.fn((h: unknown) => {
    callbacks.delete(h as number);
  });
  return {
    setIntervalFn,
    clearIntervalFn,
    callbacks,
    fireAll(): void {
      for (const cb of [...callbacks.values()]) cb();
    },
  };
}

describe('registerScheduledJobs', () => {
  it('runOnce calls all 4 jobs sequentially and returns structured results', async () => {
    const logger = makeLogger();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        progress_evidence: [
          { user_id: 'u1', created_at: '2026-09-02T09:59:30Z' },
          { user_id: 'u1', created_at: '2026-09-02T09:59:45Z' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({
          data: [{ schedule_id: 's1', event_id: 'e1' }],
          error: null,
        }),
        detect_missed_tasks: () => ({
          data: [
            { task_id: 't1', backlog_item_id: 'b1', event_id: 'e1' },
            { task_id: 't2', backlog_item_id: 'b2', event_id: 'e2' },
          ],
          error: null,
        }),
        // The analytics job's RPC is called once per candidate
        // user; with one candidate and `data: 5`, the scheduler
        // sees transitionedCount=5.
        recompute_analytics_rollup: () => ({ data: 5, error: null }),
        // The student-model job's RPC is called once per candidate
        // user; with one candidate and `data: 7` (one row per
        // feature key), the scheduler sees transitionedCount=7.
        recompute_student_model: () => ({ data: 7, error: null }),
      },
    });
    const sched = registerScheduledJobs({
      client,
      logger,
      now: () => Date.parse('2026-09-02T10:00:00.000Z'),
      intervals: {
        mark_review_due: 0,
        detect_task_missed: 0,
        recompute_analytics_rollup: 0,
        recompute_student_model: 0,
      },
    });
    const out = await sched.runOnce();
    expect(out).toHaveLength(4);
    const [a, b, c, d] = out;
    expect(a?.job).toBe('mark_review_due');
    expect(a?.ok).toBe(true);
    expect(a?.transitionedCount).toBe(1);
    expect(b?.job).toBe('detect_task_missed');
    expect(b?.ok).toBe(true);
    expect(b?.transitionedCount).toBe(2);
    expect(c?.job).toBe('recompute_analytics_rollup');
    expect(c?.ok).toBe(true);
    // The analytics job reports `rowsRecomputed` (not a
    // transition count) via the scheduler's `transitionedCount`
    // slot.
    expect(c?.transitionedCount).toBe(5);
    expect(d?.job).toBe('recompute_student_model');
    expect(d?.ok).toBe(true);
    // The student-model job reports `featuresWritten` (sum of
    // per-user per-feature rows) via the scheduler's
    // `transitionedCount` slot.
    expect(d?.transitionedCount).toBe(7);
    expect(logger.info).toHaveBeenCalled();
  });

  it('migration 20: all 4 jobs write system.tick rows with user_id=null (no nil UUID)', async () => {
    const logger = makeLogger();
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        progress_evidence: [
          { user_id: 'u1', created_at: '2026-09-02T09:59:30Z' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
        detect_missed_tasks: () => ({ data: [], error: null }),
        recompute_analytics_rollup: () => ({ data: 0, error: null }),
        recompute_student_model: () => ({ data: 0, error: null }),
      },
    });
    const sched = registerScheduledJobs({
      client,
      logger,
      now: () => Date.parse('2026-09-02T10:00:00.000Z'),
      intervals: {
        mark_review_due: 0,
        detect_task_missed: 0,
        recompute_analytics_rollup: 0,
        recompute_student_model: 0,
      },
    });
    await sched.runOnce();
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    // 4 jobs → 4 system.tick rows.
    expect(outbox).toHaveLength(4);
    for (const row of outbox as Array<{ event_type: string; user_id: string | null; aggregate_id: string }>) {
      expect(row.event_type).toBe('system.tick');
      // Migration 20 contract: system.tick is system-owned; user_id is null.
      expect(row.user_id).toBeNull();
      // The pre-remediation defect was the nil UUID. Guard against regression.
      expect(row.user_id).not.toBe('00000000-0000-0000-0000-000000000000');
    }
  });

  it('runOnce logs a warning when a job fails but does not throw', async () => {
    const logger = makeLogger();
    const client = makeFakeSupabase({
      tables: { event_outbox: [], progress_evidence: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({
          data: null,
          error: { code: 'P0001', message: 'boom' },
        }),
        detect_missed_tasks: () => ({ data: [], error: null }),
        recompute_analytics_rollup: () => ({ data: 0, error: null }),
        recompute_student_model: () => ({ data: 0, error: null }),
      },
    });
    const sched = registerScheduledJobs({
      client,
      logger,
      intervals: {
        mark_review_due: 0,
        detect_task_missed: 0,
        recompute_analytics_rollup: 0,
        recompute_student_model: 0,
      },
    });
    const out = await sched.runOnce();
    expect(out.find((r) => r.job === 'mark_review_due')?.ok).toBe(false);
    expect(out.find((r) => r.job === 'detect_task_missed')?.ok).toBe(true);
    expect(out.find((r) => r.job === 'recompute_analytics_rollup')?.ok).toBe(true);
    expect(out.find((r) => r.job === 'recompute_student_model')?.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('start() arms one timer per job (4 jobs in Phase 5); stop() clears them', () => {
    const logger = makeLogger();
    const client = makeFakeSupabase({
      tables: { event_outbox: [], progress_evidence: [] },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
        detect_missed_tasks: () => ({ data: [], error: null }),
        recompute_analytics_rollup: () => ({ data: 0, error: null }),
        recompute_student_model: () => ({ data: 0, error: null }),
      },
    });
    const timers = makeFakeTimers();
    const sched = registerScheduledJobs({
      client,
      logger,
      intervals: {
        mark_review_due: 100,
        detect_task_missed: 200,
        recompute_analytics_rollup: 300,
        recompute_student_model: 400,
      },
      setIntervalFn: timers.setIntervalFn as unknown as (cb: () => void, ms: number) => unknown,
      clearIntervalFn: timers.clearIntervalFn as unknown as (h: unknown) => void,
    });
    expect(sched.isRunning()).toBe(false);
    sched.start();
    expect(sched.isRunning()).toBe(true);
    expect(timers.setIntervalFn).toHaveBeenCalledTimes(4);
    expect(timers.callbacks.size).toBe(4);
    sched.stop();
    expect(sched.isRunning()).toBe(false);
    expect(timers.callbacks.size).toBe(0);
  });

  it('start() is idempotent; calling it twice arms only one timer per job', () => {
    const logger = makeLogger();
    const client = makeFakeSupabase({
      tables: { event_outbox: [], progress_evidence: [] },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
        detect_missed_tasks: () => ({ data: [], error: null }),
        recompute_analytics_rollup: () => ({ data: 0, error: null }),
        recompute_student_model: () => ({ data: 0, error: null }),
      },
    });
    const timers = makeFakeTimers();
    const sched = registerScheduledJobs({
      client,
      logger,
      intervals: {
        mark_review_due: 100,
        detect_task_missed: 200,
        recompute_analytics_rollup: 300,
        recompute_student_model: 400,
      },
      setIntervalFn: timers.setIntervalFn as unknown as (cb: () => void, ms: number) => unknown,
      clearIntervalFn: timers.clearIntervalFn as unknown as (h: unknown) => void,
    });
    sched.start();
    sched.start();
    expect(timers.setIntervalFn).toHaveBeenCalledTimes(4);
  });

  it('timer callbacks drive the underlying job and log results', async () => {
    const logger = makeLogger();
    const client = makeFakeSupabase({
      tables: { event_outbox: [], progress_evidence: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
        detect_missed_tasks: () => ({ data: [], error: null }),
        recompute_analytics_rollup: () => ({ data: 0, error: null }),
        recompute_student_model: () => ({ data: 0, error: null }),
      },
    });
    const timers = makeFakeTimers();
    const sched = registerScheduledJobs({
      client,
      logger,
      intervals: {
        mark_review_due: 100,
        detect_task_missed: 200,
        recompute_analytics_rollup: 300,
        recompute_student_model: 400,
      },
      setIntervalFn: timers.setIntervalFn as unknown as (cb: () => void, ms: number) => unknown,
      clearIntervalFn: timers.clearIntervalFn as unknown as (h: unknown) => void,
    });
    sched.start();
    // Fire the mark_review_due callback once.
    const cb = timers.callbacks.values().next().value as () => void;
    cb();
    // Allow the microtask queue to drain.
    await new Promise<void>((r) => setImmediate(r));
    expect(logger.info).toHaveBeenCalled();
    sched.stop();
  });
});
