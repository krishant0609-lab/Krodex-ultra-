/**
 * KRODEX — outbox worker.
 *
 * Per PHASE3_PLAN.md §6.1 + §13 (locked decision 2), the worker:
 *   1. polls the event_outbox table via `claim_pending_events` once
 *      per registered handler (the (event_id, handler_name) unique
 *      on event_log makes this safe);
 *   2. for each claimed row, looks up the prior event_log entry
 *      to decide whether to attempt and what attempt_count to
 *      write;
 *   3. dispatches to the handler with a 30s timeout;
 *   4. writes the resulting event_log row (succeeded | failed |
 *      dead_letter);
 *   5. enforces the backoff schedule 0 / 30s / 2m / 10m / 1h.
 *
 * The worker is a *function*, not a class. The orchestrator decides
 * how often to call it (PHASE3_PLAN §13: poll every 5s, 60s lease,
 * 30s handler timeout). Tests call `processOnce(...)` once per
 * tick to keep the cycle deterministic.
 *
 * The worker does NOT manage timers, intervals, or shutdown. It is
 * a single batch. Wiring it into Node's event loop and into the
 * Fastify lifecycle is the server's responsibility.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { EventEnvelope, EventType, Json } from '@krodex/shared';

import type { HandlerOutcome } from './handler-outcome';
import type { Handler, HandlerRegistry } from './registry';

/* -------------------------------------------------------------------------- */
/* Tunables. PHASE3_PLAN §13 decision 2 — locked.                             */
/* -------------------------------------------------------------------------- */

/** Max retry attempts before status='dead_letter'. PHASE3_PLAN §13 #2. */
export const MAX_ATTEMPTS = 5;

/** Lease the worker takes on a claimed batch. PHASE3_PLAN §13 #2. */
export const LEASE_SECONDS = 60;

/** Per-handler timeout. PHASE3_PLAN §13 #2. */
export const HANDLER_TIMEOUT_MS = 30_000;

/** Suggested poll interval for the orchestrator. PHASE3_PLAN §13 #2. */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Backoff schedule. `BACKOFF_MS[N]` is the wait AFTER attempt N+1
 * fails before attempt N+2 may run.
 *
 *   BACKOFF_MS[0] = 0       (attempt 1 fails -> attempt 2 is immediate)
 *   BACKOFF_MS[1] = 30_000  (attempt 2 fails -> wait 30s -> attempt 3)
 *   BACKOFF_MS[2] = 120_000 (attempt 3 fails -> wait 2m  -> attempt 4)
 *   BACKOFF_MS[3] = 600_000 (attempt 4 fails -> wait 10m -> attempt 5)
 *   BACKOFF_MS[4] = 3_600_000 (attempt 5 fails -> dead_letter)
 *
 * The last entry is the wait that would apply to a hypothetical
 * attempt 6; we never run attempt 6 — instead we mark
 * status='dead_letter' as soon as attempt 5 fails.
 */
export const BACKOFF_MS = [
  0,
  30_000,
  120_000,
  600_000,
  3_600_000,
] as const;

/** Default batch size when calling `claim_pending_events`. */
export const DEFAULT_BATCH = 25;

/* -------------------------------------------------------------------------- */
/* Public types.                                                              */
/* -------------------------------------------------------------------------- */

/** The shape returned by `claim_pending_events`. Mirror of event_outbox. */
export interface ClaimedOutboxRow {
  id: string;
  occurred_at: string;
  event_id: string;
  event_type: string;
  schema_version: number;
  user_id: string;
  actor_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: Json;
  idempotency_key: string;
  created_at: string;
}

/** The shape of a single event_log row. */
export interface EventLogRow {
  id: string;
  event_id: string;
  handler_name: string;
  status: 'succeeded' | 'failed' | 'dead_letter';
  attempt_count: number;
  last_error: string | null;
  first_attempted_at: string;
  last_attempted_at: string;
  completed_at: string | null;
}

/** Per-event outcome the worker reports. */
export interface DeliveryResult {
  event_id: string;
  handler_name: string;
  status: 'succeeded' | 'failed' | 'dead_letter' | 'skipped_backoff';
  attempt_count: number;
  wrote?: number;
  last_error: string | null;
  duration_ms: number;
}

/** Top-level result of one tick. */
export interface WorkerTickResult {
  /** Wall-clock duration of the tick. */
  duration_ms: number;
  /** Per-(event, handler) outcome. */
  deliveries: readonly DeliveryResult[];
  /** Number of (event, handler) pairs we processed. */
  processed: number;
  /** Per-handler number of claimed rows. */
  claimed_per_handler: Record<string, number>;
}

/** Options for `processOnce`. */
export interface ProcessOnceOptions {
  /** Maximum rows per handler per tick. Defaults to DEFAULT_BATCH. */
  batch?: number;
  /** Now-clock (test seam). Defaults to `new Date()`. */
  now?: () => Date;
  /** Lease interval string passed to `claim_pending_events`. Defaults to `'60 seconds'`. */
  lease?: string;
  /**
   * Per-handler timeout in ms. Defaults to HANDLER_TIMEOUT_MS.
   * Set to 0 to disable the wrapper (useful in tests).
   */
  handlerTimeoutMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Build a `EventEnvelope` from a claimed outbox row. This is the
 * shape the handler's `handle(client, envelope)` signature expects.
 * We trust the row because the worker is the only consumer of
 * `claim_pending_events` and the RPC is service-role only.
 */
function envelopeFromOutboxRow(row: ClaimedOutboxRow): EventEnvelope {
  return {
    eventId: row.event_id,
    eventType: row.event_type as EventType,
    schemaVersion: row.schema_version as 1,
    occurredAt: row.occurred_at,
    accountId: row.user_id,
    actorId: row.actor_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    payload: row.payload as unknown as EventEnvelope['payload'],
    idempotencyKey: row.idempotency_key,
  };
}

/** Map an event_type to the matching BackoffMs for the next attempt. */
function backoffForFailedAttempt(attemptCount: number): number {
  // After attempt N fails, we wait BACKOFF_MS[N - 1] for the next try.
  // attempt 1 fails -> BACKOFF_MS[0] = 0 (next try is immediate)
  // attempt 5 fails -> BACKOFF_MS[4] (would be the wait, but we dead-letter instead)
  // Clamp into the array so callers never get `undefined`.
  const idx = Math.min(Math.max(attemptCount - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx] ?? 0;
}

/**
 * Format a Date as an ISO 8601 string with millisecond precision,
 * matching Postgres' `timestamptz` round-trip format.
 */
function toIso(d: Date): string {
  return d.toISOString();
}

/* -------------------------------------------------------------------------- */
/* Core: process a single (event, handler) pair.                             */
/* -------------------------------------------------------------------------- */

interface ProcessEventArgs {
  client: SupabaseClient;
  handler: Handler;
  outboxRow: ClaimedOutboxRow;
  /** attempt_count to write on the log row for THIS delivery. */
  attemptCount: number;
  nowMs: number;
  handlerTimeoutMs: number;
}

/**
 * Run the handler with a timeout. Returns the outcome (or a
 * synthesized failed outcome on timeout). Does not throw.
 */
async function runHandlerWithTimeout(args: {
  client: SupabaseClient;
  handler: Handler;
  envelope: EventEnvelope;
  timeoutMs: number;
}): Promise<HandlerOutcome> {
  if (args.timeoutMs <= 0) {
    return args.handler.handle(args.client, args.envelope);
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<HandlerOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        kind: 'failed',
        message: `handler '${args.handler.name}' timed out after ${args.timeoutMs}ms`,
        retryable: true,
      });
    }, args.timeoutMs);
  });
  const result = await Promise.race([
    args.handler.handle(args.client, args.envelope),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
  return result;
}

/**
 * Decide whether to skip this (event, handler) pair because the
 * backoff window has not yet elapsed. Returns the skipped result
 * or null to indicate "go ahead and process".
 */
async function skipForBackoff(
  client: SupabaseClient,
  eventId: string,
  handlerName: string,
  nowMs: number,
): Promise<DeliveryResult | null> {
  // Look up the most recent event_log row for (event_id, handler).
  // We order by last_attempted_at desc and take 1.
  const { data, error } = await client
    .from('event_log')
    .select('*')
    .eq('event_id', eventId)
    .eq('handler_name', handlerName)
    .order('last_attempted_at', { ascending: false })
    .limit(1);
  if (error) {
    // If the log table is missing, the system is misconfigured;
    // surface a hard failure so the worker raises.
    throw new Error(
      `worker: read event_log failed (${error.code}): ${error.message}`,
    );
  }
  const rows = (data ?? []) as EventLogRow[];
  const last = rows[0];
  if (!last) return null;
  if (last.status !== 'failed') return null; // succeeded/dead_letter shouldn't have been claimed

  const wait = backoffForFailedAttempt(last.attempt_count);
  const lastMs = Date.parse(last.last_attempted_at);
  if (!Number.isFinite(lastMs)) return null;
  if (nowMs - lastMs < wait) {
    return {
      event_id: eventId,
      handler_name: handlerName,
      status: 'skipped_backoff',
      attempt_count: last.attempt_count,
      last_error: last.last_error,
      duration_ms: 0,
    };
  }
  return null;
}

/**
 * Persist the outcome of a single (event, handler) delivery into
 * event_log. The unique (event_id, handler_name) index makes this
 * the idempotency primitive: the first write creates the row,
 * every subsequent retry updates `attempt_count`, `last_attempted_at`,
 * `last_error`, and (on a final transition) `status` + `completed_at`.
 *
 * `first_attempted_at` is preserved across retries by reading the
 * prior row's value before upserting.
 */
async function writeLogRow(
  client: SupabaseClient,
  args: {
    eventId: string;
    handlerName: string;
    status: 'succeeded' | 'failed' | 'dead_letter';
    attemptCount: number;
    lastError: string | null;
    startedAt: Date;
    completedAt: Date;
  },
): Promise<void> {
  // Preserve first_attempted_at across retries.
  const { data: prior } = await client
    .from('event_log')
    .select('first_attempted_at')
    .eq('event_id', args.eventId)
    .eq('handler_name', args.handlerName)
    .order('last_attempted_at', { ascending: false })
    .limit(1);
  const priorFirst = (prior as { first_attempted_at?: string }[] | null)?.[0]
    ?.first_attempted_at;
  const firstAttemptedAt = priorFirst ?? toIso(args.startedAt);

  const completedAtIso = toIso(args.completedAt);
  const { error } = await client.from('event_log').upsert(
    {
      event_id: args.eventId,
      handler_name: args.handlerName,
      status: args.status,
      attempt_count: args.attemptCount,
      last_error: args.lastError,
      first_attempted_at: firstAttemptedAt,
      last_attempted_at: completedAtIso,
      completed_at: args.status === 'succeeded' || args.status === 'dead_letter'
        ? completedAtIso
        : null,
    },
    { onConflict: 'event_id,handler_name' },
  );
  if (error) {
    throw new Error(
      `worker: write event_log failed (${error.code}): ${error.message}`,
    );
  }
}

/**
 * Look up the most recent event_log row for (event_id, handler)
 * to determine the next attempt_count. Returns 1 if no prior log
 * row exists.
 */
async function priorAttemptCount(
  client: SupabaseClient,
  eventId: string,
  handlerName: string,
): Promise<number> {
  const { data, error } = await client
    .from('event_log')
    .select('attempt_count')
    .eq('event_id', eventId)
    .eq('handler_name', handlerName)
    .order('last_attempted_at', { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(
      `worker: read event_log failed (${error.code}): ${error.message}`,
    );
  }
  const rows = (data ?? []) as { attempt_count: number }[];
  return rows[0]?.attempt_count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* processEvent: the single (event, handler) delivery.                       */
/* -------------------------------------------------------------------------- */

async function processEvent(
  args: ProcessEventArgs,
): Promise<DeliveryResult> {
  const { client, handler, outboxRow, nowMs, handlerTimeoutMs } = args;
  const eventId = outboxRow.event_id;
  const handlerName = handler.name;

  // 1. Backoff gate.
  const skip = await skipForBackoff(client, eventId, handlerName, nowMs);
  if (skip) return skip;

  // 2. Determine the attempt_count to write for THIS delivery.
  const prior = await priorAttemptCount(client, eventId, handlerName);
  const nextAttempt = prior + 1;

  // 3. If a prior attempt hit the cap and is still failed (i.e. not
  //    yet flipped to dead_letter), flip it now. This handles the
  //    "claim returned a row whose last failed log was the 5th"
  //    case.
  if (prior >= MAX_ATTEMPTS) {
    const completedAt = new Date(nowMs);
    await writeLogRow(client, {
      eventId,
      handlerName,
      status: 'dead_letter',
      attemptCount: prior,
      lastError: 'exceeded max attempts; no further retries',
      startedAt: completedAt,
      completedAt,
    });
    return {
      event_id: eventId,
      handler_name: handlerName,
      status: 'dead_letter',
      attempt_count: prior,
      last_error: 'exceeded max attempts; no further retries',
      duration_ms: 0,
    };
  }

  // 4. Run the handler (with timeout).
  const envelope = envelopeFromOutboxRow(outboxRow);
  const startedAt = new Date(nowMs);
  const startMs = Date.now();
  let outcome: HandlerOutcome;
  let lastError: string | null = null;
  try {
    outcome = await runHandlerWithTimeout({
      client,
      handler,
      envelope,
      timeoutMs: handlerTimeoutMs,
    });
  } catch (err) {
    outcome = {
      kind: 'failed',
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
  // Use the orchestrator-supplied clock for `completedAt` so the
  // next-tick backoff gate (which reads this back as `last_attempted_at`)
  // measures elapsed time against the same clock. The test harness
  // injects a fake clock; production uses `Date.now()`.
  const realCompletedMs = Date.now();
  const completedAt = new Date(nowMs + (realCompletedMs - startMs));
  const durationMs = completedAt.getTime() - nowMs;

  // 5. Persist the log row.
  if (outcome.kind === 'succeeded') {
    lastError = null;
    await writeLogRow(client, {
      eventId,
      handlerName,
      status: 'succeeded',
      attemptCount: nextAttempt,
      lastError,
      startedAt,
      completedAt,
    });
    return {
      event_id: eventId,
      handler_name: handlerName,
      status: 'succeeded',
      attempt_count: nextAttempt,
      wrote: outcome.wrote,
      last_error: lastError,
      duration_ms: durationMs,
    };
  }

  // outcome.kind === 'failed'
  lastError = outcome.message;
  const isFinal = nextAttempt >= MAX_ATTEMPTS;
  await writeLogRow(client, {
    eventId,
    handlerName,
    status: isFinal ? 'dead_letter' : 'failed',
    attemptCount: nextAttempt,
    lastError,
    startedAt,
    completedAt,
  });
  return {
    event_id: eventId,
    handler_name: handlerName,
    status: isFinal ? 'dead_letter' : 'failed',
    attempt_count: nextAttempt,
    last_error: lastError,
    duration_ms: durationMs,
  };
}

/* -------------------------------------------------------------------------- */
/* processOnce: the worker tick.                                              */
/* -------------------------------------------------------------------------- */

export interface Worker {
  /** Run one tick. Idempotent and side-effectful only on event_outbox+event_log. */
  processOnce(opts?: ProcessOnceOptions): Promise<WorkerTickResult>;
}

/**
 * Build a worker bound to a Supabase client and a handler registry.
 * The same client must be used for the entire tick; concurrency
 * across ticks is the orchestrator's responsibility.
 */
export function createWorker(
  client: SupabaseClient,
  registry: HandlerRegistry,
): Worker {
  return {
    async processOnce(opts: ProcessOnceOptions = {}): Promise<WorkerTickResult> {
      const startedAt = Date.now();
      const batch = opts.batch ?? DEFAULT_BATCH;
      const nowFn = opts.now ?? (() => new Date());
      const lease = opts.lease ?? `${LEASE_SECONDS} seconds`;
      const handlerTimeoutMs = opts.handlerTimeoutMs ?? HANDLER_TIMEOUT_MS;
      const now = nowFn();
      const nowMs = now.getTime();

      const handlers = registry.allHandlers();
      const claimedPerHandler: Record<string, number> = {};
      const deliveries: DeliveryResult[] = [];

      for (const handler of handlers) {
        // 1. Claim. The RPC filters out events with a succeeded or
        //    dead_letter log row for this handler. Within-tick
        //    duplicates across handlers are fine: the (event_id,
        //    handler_name) pair is unique.
        const { data, error } = await client.rpc('claim_pending_events', {
          p_handler: handler.name,
          p_batch: batch,
          p_lease_for: lease,
        });
        if (error) {
          throw new Error(
            `worker: claim_pending_events failed (${error.code ?? 'unknown'}): ${error.message}`,
          );
        }
        const rows = (data ?? []) as ClaimedOutboxRow[];
        claimedPerHandler[handler.name] = rows.length;

        // 2. Dispatch each claimed row.
        for (const row of rows) {
          const result = await processEvent({
            client,
            handler,
            outboxRow: row,
            attemptCount: 0, // computed inside processEvent
            nowMs,
            handlerTimeoutMs,
          });
          deliveries.push(result);
        }
      }

      return {
        duration_ms: Date.now() - startedAt,
        deliveries,
        processed: deliveries.length,
        claimed_per_handler: claimedPerHandler,
      };
    },
  };
}
