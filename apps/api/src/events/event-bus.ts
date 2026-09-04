/**
 * KRODEX — event-bus orchestrator.
 *
 * Per PHASE3_PLAN.md §6.1 + §6.3 and PHASE4_PLAN.md §13.1, the
 * API process owns:
 *
 *   1. The outbox worker poll loop (poll every 5s).
 *   2. The scheduled-jobs timer (5m mark_review_due, 15m
 *      detect_task_missed, 5m recompute_analytics_rollup).
 *   3. The handler registry wiring the 4 registered handlers to
 *      their subscribed event types.
 *
 * This module is the single boot/shutdown entry point. The server
 * calls `startEventBus()` after Fastify is ready and `stopEventBus()`
 * on graceful shutdown.
 *
 * Health surface (PHASE3_PLAN §6.5):
 *   `getEventBusStatus()` returns a small snapshot:
 *     {
 *       running: boolean,
 *       worker: { running: boolean, handlers: string[] },
 *       scheduler: { running: boolean, jobs: { mark_review_due: 300_000, ... } },
 *       lastTickAt: string | null,
 *       lastError: string | null
 *     }
 *
 * Lifecycle invariants (per PHASE3_PLAN §13 decision 2 + PHASE4 §13.1 + PHASE5 §5):
 *   - poll:  5s
 *   - lease: 60s
 *   - handler timeout: 30s
 *   - max attempts: 5
 *   - backoff: 0/30s/2m/10m/1h
 *   - scheduler: 5m (mark_review_due), 15m (detect_task_missed),
 *                5m (recompute_analytics_rollup, D-9 Class C),
 *                5m (recompute_student_model, D-9 Class C by analogy)
 *
 * If the service-role Supabase client cannot be constructed (no
 * SUPABASE_URL/SERVICE_ROLE_KEY in env), the bus still starts but
 * `getEventBusStatus().running === false` and the worker timer is
 * skipped. /health reports the worker as `disabled` so operators
 * know to fix the env. The HTTP API still serves authenticated
 * requests; only the event bus is dark.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventType } from '@krodex/shared';

import type { ApiEnv } from '../config/env';
import { getServiceClient } from '../db/supabase';
import { createRegistry, type Handler, type HandlerRegistry } from './registry';
import {
  createWorker,
  POLL_INTERVAL_MS,
  type Worker,
} from './worker';
import {
  DEFAULT_INTERVALS_MS,
  registerScheduledJobs,
  type Scheduler,
} from './scheduled-jobs';
import * as projectProgressEvidence from './project_progress_evidence';
import * as projectNotification from './project_notification';
import * as emitAttemptAnalyzed from './emit_attempt_analyzed';
import * as projectAnalyticsRollup from './project_analytics_rollup';
import * as projectStudentModel from './project_student_model';

/* -------------------------------------------------------------------------- */
/* Subscription map. Handlers are subscribed to the event types they handle.   */
/* -------------------------------------------------------------------------- */

/**
 * Every event type the project_progress_evidence handler may write
 * evidence for (see apps/api/src/events/project_progress_evidence.ts).
 * The handler is itself a no-op for types it doesn't recognize; we
 * only subscribe it to keep the worker loop honest about fan-out.
 */
const PROJECT_PROGRESS_EVIDENCE_EVENTS: readonly EventType[] = [
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
  'system.tick',
];

/**
 * Per PHASE12_PLAN.md §8a + §12, project_notification subscribes to
 * every notification-worthy domain event. The handler is a no-op
 * for types it does not recognize (returns `succeeded` with
 * wrote=0), so the subscription list is the only place that drives
 * worker fan-out.
 */
const PROJECT_NOTIFICATION_EVENTS: readonly EventType[] = [
  // Phase 0–9 — backward-compat with the pre-Phase-12 producer
  'notification.created',
  // Phase 9 — error lifecycle / capture
  'error.lifecycle.active',
  'error.lifecycle.reopened',
  'attempt.analyzed',
  // Phase 10 — review / retest
  'review.outcome_recorded',
  // Phase 11 — planner / backlog
  'task.missed',
  'task.completed',
  'backlog.item_created',
  // Phase 12 — scheduled reminders
  'review.due',
  'review.overdue',
  'task.upcoming',
];

/**
 * attempt.submitted triggers the derived attempt.analyzed fan-out
 * (see PHASE3_PLAN §6.2 #3). The emit_attempt_analyzed handler
 * itself emits an attempt.analyzed envelope back into the outbox.
 */
const EMIT_ATTEMPT_ANALYZED_EVENTS: readonly EventType[] = ['attempt.submitted'];

/**
 * Per PHASE4_PLAN.md §13.1, the project_analytics_rollup handler
 * subscribes to every event type project_progress_evidence does.
 * The rollup projection is idempotent (re-running the SQL
 * function inside the same window produces the same state), so
 * duplicating the subscription is safe.
 *
 * The synthetic `system.tick` envelopes are handled inside the
 * handler (`planRollupForEvent` returns null for them); we still
 * subscribe so the worker loop is honest about fan-out.
 */
const PROJECT_ANALYTICS_ROLLUP_EVENTS: readonly EventType[] = [...PROJECT_PROGRESS_EVIDENCE_EVENTS];

/**
 * Per PHASE5_PLAN.md §5, the project_student_model handler
 * subscribes to the same event set so every measurable student
 * activity also triggers a student-model projection. The
 * recompute is idempotent (the SQL function replaces the prior
 * snapshot+features with a fresh one), so a duplicate event
 * (e.g. an outbox replay) is a no-op write-wise.
 *
 * The synthetic `system.tick` envelopes are handled inside the
 * handler (`planStudentModelForEvent` returns null for them);
 * we still subscribe so the worker loop is honest about fan-out.
 */
const PROJECT_STUDENT_MODEL_EVENTS: readonly EventType[] = [...PROJECT_PROGRESS_EVIDENCE_EVENTS];

/* -------------------------------------------------------------------------- */
/* Handler factories.                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Wrap a `(client, envelope) => Promise<HandlerOutcome>` function
 * into a `Handler` (the registry's subscription shape). The
 * HANDLER_NAME constant is published by each handler module.
 */
function makeHandler(
  name: string,
  fn: (client: SupabaseClient, envelope: Parameters<Handler['handle']>[1]) => ReturnType<Handler['handle']>,
): Handler {
  return {
    name,
    handle: fn,
  };
}

/* -------------------------------------------------------------------------- */
/* Public types.                                                               */
/* -------------------------------------------------------------------------- */

export interface WorkerStatus {
  running: boolean;
  handlers: readonly string[];
  pollIntervalMs: number;
  lastTickAt: string | null;
  lastError: string | null;
  lastProcessed: number;
  lastDurationMs: number;
}

export interface SchedulerStatus {
  running: boolean;
  jobs: {
    mark_review_due: number;
    detect_task_missed: number;
    recompute_analytics_rollup: number;
    recompute_student_model: number;
  };
}

export interface EventBusStatus {
  running: boolean;
  reason: string;
  worker: WorkerStatus;
  scheduler: SchedulerStatus;
}

export interface EventBus {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  status(): EventBusStatus;
  worker(): Worker;
  registry(): HandlerRegistry;
}

/* -------------------------------------------------------------------------- */
/* Build.                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Build the event bus. Always returns an EventBus; the returned
 * `isRunning()` is false when Supabase service-role is not
 * configured (the bus is then a no-op).
 */
export function buildEventBus(
  env: ApiEnv,
  logger: { info: Function; warn: Function; error: Function },
): EventBus {
  const registry = createRegistry();

  // Register the 4 handlers. Each handler subscribes to its own
  // event types. The worker iterates `registry.allHandlers()` per
  // tick, so the subscription map is the only place this lives.
  const progressHandler = makeHandler(
    projectProgressEvidence.HANDLER_NAME,
    projectProgressEvidence.handle as Handler['handle'],
  );
  const notificationHandler = makeHandler(
    projectNotification.HANDLER_NAME,
    projectNotification.handle as Handler['handle'],
  );
  const attemptAnalyzedHandler = makeHandler(
    emitAttemptAnalyzed.HANDLER_NAME,
    emitAttemptAnalyzed.handle as Handler['handle'],
  );
  const analyticsRollupHandler = makeHandler(
    projectAnalyticsRollup.HANDLER_NAME,
    projectAnalyticsRollup.handle as Handler['handle'],
  );
  const studentModelHandler = makeHandler(
    projectStudentModel.HANDLER_NAME,
    projectStudentModel.handle as Handler['handle'],
  );

  registry.subscribe(progressHandler, ...PROJECT_PROGRESS_EVIDENCE_EVENTS);
  registry.subscribe(notificationHandler, ...PROJECT_NOTIFICATION_EVENTS);
  registry.subscribe(attemptAnalyzedHandler, ...EMIT_ATTEMPT_ANALYZED_EVENTS);
  registry.subscribe(analyticsRollupHandler, ...PROJECT_ANALYTICS_ROLLUP_EVENTS);
  registry.subscribe(studentModelHandler, ...PROJECT_STUDENT_MODEL_EVENTS);

  // Worker is bound to a Supabase client, lazily constructed.
  // We only construct the client once at start() (so the
  // unconfigured-env path doesn't try to call getServiceClient()
  // and throw).
  let client: SupabaseClient | null = null;
  let worker: Worker | null = null;
  if (env.hasSupabase && env.hasServiceRole) {
    client = getServiceClient(env);
    worker = createWorker(client, registry);
  }

  // Scheduler. Same lazy client pattern.
  let scheduler: Scheduler | null = null;
  if (client) {
    scheduler = registerScheduledJobs({
      client,
      logger: {
        info: (obj, msg) => logger.info(obj, msg),
        warn: (obj, msg) => logger.warn(obj, msg),
        error: (obj, msg) => logger.error(obj, msg),
      },
    });
  }

  // Lifecycle state. The poll loop reads / writes these.
  let running = false;
  let lastTickAt: string | null = null;
  let lastError: string | null = null;
  let lastProcessed = 0;
  let lastDurationMs = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function tick(): void {
    if (!worker) return;
    const tickStart = Date.now();
    worker
      .processOnce()
      .then((result) => {
        lastTickAt = new Date().toISOString();
        lastError = null;
        lastProcessed = result.processed;
        lastDurationMs = result.duration_ms;
        if (result.processed > 0) {
          logger.info(
            {
              processed: result.processed,
              duration_ms: result.duration_ms,
              claimed_per_handler: result.claimed_per_handler,
            },
            'event_bus.tick',
          );
        }
      })
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        logger.error(
          { err, duration_ms: Date.now() - tickStart },
          'event_bus.tick_failed',
        );
      });
  }

  function start(): void {
    if (running) return;
    if (!worker) {
      logger.warn(
        { reason: 'service_role_unconfigured' },
        'event_bus.disabled: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing',
      );
      return;
    }
    running = true;
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    if (scheduler) scheduler.start();
    logger.info(
      {
        poll_ms: POLL_INTERVAL_MS,
        handler_count: registry.allHandlers().length,
        scheduler_jobs: DEFAULT_INTERVALS_MS,
      },
      'event_bus.started',
    );
  }

  function stop(): void {
    if (!running) return;
    running = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (scheduler) scheduler.stop();
    logger.info({}, 'event_bus.stopped');
  }

  function isRunning(): boolean {
    return running;
  }

  function status(): EventBusStatus {
    const handlerNames = registry.allHandlers().map((h) => h.name);
    if (!worker) {
      return {
        running: false,
        reason: 'service_role_unconfigured',
        worker: {
          running: false,
          handlers: handlerNames,
          pollIntervalMs: POLL_INTERVAL_MS,
          lastTickAt,
          lastError: lastError ?? 'service-role Supabase client not available',
          lastProcessed,
          lastDurationMs,
        },
        scheduler: {
          running: false,
          jobs: { ...DEFAULT_INTERVALS_MS },
        },
      };
    }
    return {
      running,
      reason: running ? 'ok' : 'stopped',
      worker: {
        running,
        handlers: handlerNames,
        pollIntervalMs: POLL_INTERVAL_MS,
        lastTickAt,
        lastError,
        lastProcessed,
        lastDurationMs,
      },
      scheduler: {
        running: scheduler?.isRunning() ?? false,
        jobs: { ...DEFAULT_INTERVALS_MS },
      },
    };
  }

  return {
    start,
    stop,
    isRunning,
    status,
    worker: () => {
      if (!worker) throw new Error('event_bus: worker is not available (service role unconfigured)');
      return worker;
    },
    registry: () => registry,
  };
}
