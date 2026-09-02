/**
 * KRODEX — scheduled jobs runner.
 *
 * Per PHASE3_PLAN.md §6.3 and §6.4, the two scheduled-only jobs
 * in Phase 3 are:
 *
 *   - mark_review_due     — every 5  minutes (§6.3 #4)
 *   - detect_task_missed  — every 15 minutes (§6.3 #5)
 *
 * Per PHASE4_PLAN.md §13.1, Phase 4 adds:
 *
 *   - recompute_analytics_rollup — every 5 minutes (D-9,
 *     Class C — Approved Product Policy)
 *
 * Unlike the event handlers (which run inside the outbox worker
 * fan-out in `worker.ts`), these are called on a wall-clock timer
 * inside the API process. The flow per tick is:
 *
 *   1. The timer fires.
 *   2. We call the job's `run*` function. Internally that
 *      function:
 *        a. Invokes the SECURITY DEFINER Postgres function
 *           (mark_due_reviews / detect_missed_tasks /
 *           recompute_analytics_rollup) via RPC. The SQL
 *           function does the state transition + emits one
 *           domain event per row (review.started / task.missed)
 *           into event_outbox.
 *        b. Emits a synthetic `system.tick` audit event with the
 *           job's stable name as the aggregate, so the existing
 *           worker/handler contract records the run in event_log.
 *   3. We log the structured result. A failed run is logged as a
 *      warning but does not throw — the timer will fire again
 *      on the next interval.
 *
 * The runner is intentionally minimal: it owns no business logic
 * (that lives in the SQL functions + per-job TS files), and it
 * is the only place that knows about the wall-clock cadence. The
 * cadence is *configurable* so tests can drive a synchronous
 * `runOnce` instead of relying on real timers.
 *
 * Lifecycle:
 *   - `registerScheduledJobs` returns a `Scheduler` whose
 *     `start()` arms the timers and `stop()` clears them.
 *   - The server's bootstrap calls `start()` after the Fastify
 *     app is up; on shutdown the orchestrator calls `stop()`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { JOB_NAME as MARK_REVIEW_DUE_JOB, runMarkReviewDue } from './mark_review_due';
import { JOB_NAME as DETECT_TASK_MISSED_JOB, runDetectTaskMissed } from './detect_task_missed';
import { JOB_NAME as RECOMPUTE_ANALYTICS_JOB, runRecomputeAnalyticsRollup } from './recompute_analytics_rollup';
import { JOB_NAME as RECOMPUTE_STUDENT_MODEL_JOB, runRecomputeStudentModel } from './recompute_student_model';

/** Default per-job cadence (ms). Mirrors PHASE3_PLAN §6.3 + PHASE4_PLAN §13.1 + PHASE5_PLAN §5. */
export const DEFAULT_INTERVALS_MS = {
  mark_review_due: 5 * 60 * 1000, // 5 minutes
  detect_task_missed: 15 * 60 * 1000, // 15 minutes
  // Phase 4: D-9 (Class C — Approved Product Policy). 5-minute
  // recompute of analytics_daily_rollup / analytics_weekly_rollup.
  recompute_analytics_rollup: 5 * 60 * 1000, // 5 minutes
  // Phase 5: same D-9 cadence by analogy — the student model
  // has the same freshness requirements as the analytics rollup.
  // Re-runs are idempotent (the SQL function replaces the prior
  // snapshot+feature rows with a fresh one).
  recompute_student_model: 5 * 60 * 1000, // 5 minutes
} as const;

/** Lightweight logger interface; Fastify's app.log is compatible. */
export interface JobLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface SchedulerOptions {
  /** Service-role Supabase client. */
  client: SupabaseClient;
  /** Logger. */
  logger: JobLogger;
  /**
   * Wall-clock function. Defaults to `Date.now`. Tests inject a
   * deterministic clock so they can simulate "now" precisely.
   */
  now?: () => number;
  /**
   * Per-job intervals in ms. Defaults to DEFAULT_INTERVALS_MS.
   * Tests pass 0 to make `runOnce` synchronous and skip the
   * timer entirely.
   */
  intervals?: Partial<typeof DEFAULT_INTERVALS_MS>;
  /**
   * Timer factory. Defaults to globalThis.setInterval /
   * clearInterval. Tests inject a fake timer harness.
   */
  setIntervalFn?: (cb: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface JobTickResult {
  job:
    | typeof MARK_REVIEW_DUE_JOB
    | typeof DETECT_TASK_MISSED_JOB
    | typeof RECOMPUTE_ANALYTICS_JOB
    | typeof RECOMPUTE_STUDENT_MODEL_JOB;
  ok: boolean;
  transitionedCount: number;
  error?: string;
  /** Wall-clock duration of this run, in ms. */
  duration_ms: number;
}

export interface Scheduler {
  /** Manually run every job once. Safe to call before start(). */
  runOnce(): Promise<readonly JobTickResult[]>;
  /** Arm the interval timers. Idempotent. */
  start(): void;
  /** Clear the interval timers. Idempotent. */
  stop(): void;
  /** True if the timers are armed. */
  isRunning(): boolean;
}

/**
 * Build a scheduler. Owns timers and the (now() | interval) clock
 * for both jobs. The per-job `run*` functions live in their own
 * modules and own all SQL + outbox-write work; this runner only
 * schedules and logs.
 */
export function registerScheduledJobs(opts: SchedulerOptions): Scheduler {
  const intervals = { ...DEFAULT_INTERVALS_MS, ...(opts.intervals ?? {}) };
  const now = opts.now ?? Date.now;
  const setIntervalFn = opts.setIntervalFn ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
  const clearIntervalFn = opts.clearIntervalFn ?? ((h: unknown) => clearInterval(h as number));

  let running = false;
  const handles: { key: string; h: unknown }[] = [];

  async function runMarkReviewDueOnce(): Promise<JobTickResult> {
    const startedAt = now();
    const r = await runMarkReviewDue(opts.client, () => new Date(now()));
    const duration_ms = now() - startedAt;
    return {
      job: MARK_REVIEW_DUE_JOB,
      ok: r.ok,
      transitionedCount: r.transitionedCount,
      error: r.error,
      duration_ms,
    };
  }

  async function runDetectTaskMissedOnce(): Promise<JobTickResult> {
    const startedAt = now();
    const r = await runDetectTaskMissed(opts.client, () => new Date(now()));
    const duration_ms = now() - startedAt;
    return {
      job: DETECT_TASK_MISSED_JOB,
      ok: r.ok,
      transitionedCount: r.transitionedCount,
      error: r.error,
      duration_ms,
    };
  }

  async function runRecomputeAnalyticsRollupOnce(): Promise<JobTickResult> {
    const startedAt = now();
    const r = await runRecomputeAnalyticsRollup(opts.client, () => new Date(now()));
    const duration_ms = now() - startedAt;
    return {
      job: RECOMPUTE_ANALYTICS_JOB,
      ok: r.ok,
      // For the analytics job, the structured result carries
      // `rowsRecomputed` rather than `transitionedCount`. We
      // forward the `rowsRecomputed` value so the log line
      // reports the same number that the SQL function returned.
      transitionedCount: r.rowsRecomputed,
      error: r.error,
      duration_ms,
    };
  }

  async function runRecomputeStudentModelOnce(): Promise<JobTickResult> {
    const startedAt = now();
    const r = await runRecomputeStudentModel(opts.client, () => new Date(now()));
    const duration_ms = now() - startedAt;
    return {
      job: RECOMPUTE_STUDENT_MODEL_JOB,
      ok: r.ok,
      // For the student-model job, the structured result
      // carries `featuresWritten` (sum of per-user per-feature
      // rows) rather than `transitionedCount`. We forward the
      // `featuresWritten` value so the log line reports the
      // same number the orchestrator produced.
      transitionedCount: r.featuresWritten,
      error: r.error,
      duration_ms,
    };
  }

  async function runOnce(): Promise<readonly JobTickResult[]> {
    const out: JobTickResult[] = [];
    // Run sequentially: all jobs are service-role and their SQL
    // functions use FOR UPDATE SKIP LOCKED, so order is not
    // observable. Sequential keeps the per-job log lines easy to
    // read.
    out.push(await runMarkReviewDueOnce());
    out.push(await runDetectTaskMissedOnce());
    out.push(await runRecomputeAnalyticsRollupOnce());
    out.push(await runRecomputeStudentModelOnce());
    for (const r of out) {
      if (r.ok) {
        opts.logger.info(
          { job: r.job, transitionedCount: r.transitionedCount, duration_ms: r.duration_ms },
          'scheduled job ok',
        );
      } else {
        opts.logger.warn(
          { job: r.job, error: r.error, duration_ms: r.duration_ms },
          'scheduled job failed',
        );
      }
    }
    return out;
  }

  function start(): void {
    if (running) return;
    running = true;
    const mr = setIntervalFn(() => {
      void runMarkReviewDueOnce().then((r) => {
        if (r.ok) {
          opts.logger.info(
            { job: r.job, transitionedCount: r.transitionedCount, duration_ms: r.duration_ms },
            'scheduled job ok',
          );
        } else {
          opts.logger.warn(
            { job: r.job, error: r.error, duration_ms: r.duration_ms },
            'scheduled job failed',
          );
        }
      });
    }, intervals.mark_review_due);
    const dt = setIntervalFn(() => {
      void runDetectTaskMissedOnce().then((r) => {
        if (r.ok) {
          opts.logger.info(
            { job: r.job, transitionedCount: r.transitionedCount, duration_ms: r.duration_ms },
            'scheduled job ok',
          );
        } else {
          opts.logger.warn(
            { job: r.job, error: r.error, duration_ms: r.duration_ms },
            'scheduled job failed',
          );
        }
      });
    }, intervals.detect_task_missed);
    const ra = setIntervalFn(() => {
      void runRecomputeAnalyticsRollupOnce().then((r) => {
        if (r.ok) {
          opts.logger.info(
            { job: r.job, transitionedCount: r.transitionedCount, duration_ms: r.duration_ms },
            'scheduled job ok',
          );
        } else {
          opts.logger.warn(
            { job: r.job, error: r.error, duration_ms: r.duration_ms },
            'scheduled job failed',
          );
        }
      });
    }, intervals.recompute_analytics_rollup);
    const rsm = setIntervalFn(() => {
      void runRecomputeStudentModelOnce().then((r) => {
        if (r.ok) {
          opts.logger.info(
            { job: r.job, transitionedCount: r.transitionedCount, duration_ms: r.duration_ms },
            'scheduled job ok',
          );
        } else {
          opts.logger.warn(
            { job: r.job, error: r.error, duration_ms: r.duration_ms },
            'scheduled job failed',
          );
        }
      });
    }, intervals.recompute_student_model);
    handles.push({ key: 'mark_review_due', h: mr });
    handles.push({ key: 'detect_task_missed', h: dt });
    handles.push({ key: 'recompute_analytics_rollup', h: ra });
    handles.push({ key: 'recompute_student_model', h: rsm });
  }

  function stop(): void {
    if (!running) return;
    for (const { h } of handles) clearIntervalFn(h);
    handles.length = 0;
    running = false;
  }

  return {
    runOnce,
    start,
    stop,
    isRunning: () => running,
  };
}
