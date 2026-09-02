/**
 * KRODEX — worker tests.
 *
 * Exercises the contract from PHASE3_PLAN §13 decision 2:
 *   - MAX_ATTEMPTS = 5
 *   - backoff 0 / 30s / 2m / 10m / 1h
 *   - lease 60s (modeled via claim_pending_events)
 *   - poll 5s (orchestrator concern; not tested here)
 *   - handler timeout 30s
 *
 * The worker is a pure function of (Supabase client, handler
 * registry, now-clock). Tests inject a fake Supabase client +
 * canned claim RPC and a fake clock to make backoff decisions
 * deterministic.
 *
 * We do not test the synthetic `system.tick` event here; the
 * event itself is emitted by the scheduled-job handlers tested
 * in worker.test for step 10.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  type EventEnvelope,
  type EventType,
} from '@krodex/shared';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import {
  BACKOFF_MS,
  HANDLER_TIMEOUT_MS,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  createWorker,
  type ClaimedOutboxRow,
} from './worker';
import type { HandlerOutcome } from './handler-outcome';
import { createRegistry, type Handler } from './registry';
import { buildEnvelope } from './outbox-writer';

/* -------------------------------------------------------------------------- */
/* Fixtures.                                                                  */
/* -------------------------------------------------------------------------- */

const USER_A = '00000000-0000-0000-0000-00000000000a';
const ATTEMPT_ID = '00000000-0000-0000-0000-0000000000a1';
const EVENT_ID = computeEventId({
  event_type: 'attempt.submitted',
  aggregate_type: 'attempt',
  aggregate_id: ATTEMPT_ID,
  aggregate_version: 1,
});
const IDEMPOTENCY_KEY = computeIdempotencyKeyForEvent({
  event_type: 'attempt.submitted',
  aggregate_type: 'attempt',
  aggregate_id: ATTEMPT_ID,
  aggregate_version: 1,
});

function envelopeFor<T extends EventType>(
  eventType: T,
  aggregateId: string,
  payload: EventEnvelope<T>['payload'],
): EventEnvelope<T> {
  const eventId = computeEventId({
    event_type: eventType,
    aggregate_type: 'attempt',
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: eventType,
    aggregate_type: 'attempt',
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  return buildEnvelope({
    eventType,
    accountId: USER_A,
    actorId: USER_A,
    aggregateType: 'attempt',
    aggregateId,
    aggregateVersion: 1,
    eventId,
    idempotencyKey,
    payload,
  });
}

function outboxRowFor(envelope: EventEnvelope): ClaimedOutboxRow {
  return {
    id: `ob_${envelope.eventId.slice(0, 8)}`,
    occurred_at: envelope.occurredAt,
    event_id: envelope.eventId,
    event_type: envelope.eventType,
    schema_version: envelope.schemaVersion,
    user_id: envelope.accountId,
    actor_id: envelope.actorId,
    aggregate_type: envelope.aggregateType,
    aggregate_id: envelope.aggregateId,
    aggregate_version: envelope.aggregateVersion,
    payload: envelope.payload as never,
    idempotency_key: envelope.idempotencyKey,
    created_at: envelope.occurredAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Test helpers.                                                              */
/* -------------------------------------------------------------------------- */

/** A fake clock the worker reads via the `now` option. */
class Clock {
  constructor(public t: number) {}
  date(): Date { return new Date(this.t); }
  advance(ms: number): void { this.t += ms; }
}

interface Harness {
  client: SupabaseClient;
  worker: ReturnType<typeof createWorker>;
  handlers: Map<string, Handler>;
  claimedRows: ClaimedOutboxRow[];
  clock: Clock;
  /**
   * Convenience wrapper that calls `processOnce` with the harness
   * defaults. Per-call overrides can still be passed in `extra` —
   * they are merged on top. The `handlerTimeoutMs` from
   * `buildHarness` opts is applied automatically so the test author
   * does not have to thread it through every call site.
   */
  runOnce(extra?: Omit<Parameters<Harness['worker']['processOnce']>[0], 'handlerTimeoutMs' | 'now'>):
    ReturnType<Harness['worker']['processOnce']>;
}

function buildHarness(opts: {
  handlers: Handler[];
  outboxRows?: ClaimedOutboxRow[];
  now?: number;
  handlerTimeoutMs?: number;
}): Harness {
  const client = makeFakeSupabase({
    tables: {
      event_log: [],
      event_outbox: [],
    },
    uniqueConstraints: {
      event_log: [['event_id', 'handler_name']],
    },
    rpcImpls: {
      claim_pending_events: (params) => {
        const handler = String(params.p_handler);
        if (!opts.handlers.find((h) => h.name === handler)) {
          return { data: [], error: null };
        }
        return { data: opts.outboxRows ?? [], error: null };
      },
    },
  });
  const registry = createRegistry();
  for (const h of opts.handlers) {
    registry.register(h);
  }
  const clock = new Clock(opts.now ?? Date.parse('2026-09-02T12:00:00.000Z'));
  const worker = createWorker(client, registry);
  const harness: Harness = {
    client,
    worker,
    handlers: new Map(opts.handlers.map((h) => [h.name, h])),
    claimedRows: opts.outboxRows ?? [],
    clock,
    runOnce(extra) {
      return worker.processOnce({
        ...(opts.handlerTimeoutMs !== undefined ? { handlerTimeoutMs: opts.handlerTimeoutMs } : {}),
        now: () => clock.date(),
        ...(extra ?? {}),
      });
    },
  };
  return harness;
}

function eventLogRows(
  client: SupabaseClient,
): Array<{
  event_id: string;
  handler_name: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  first_attempted_at: string;
  last_attempted_at: string;
  completed_at: string | null;
}> {
  return (
    client as unknown as {
      __rows: (t: string) => Array<Record<string, unknown>>;
    }
  ).__rows('event_log') as never;
}

/* -------------------------------------------------------------------------- */
/* Test 1: happy path.                                                        */
/* -------------------------------------------------------------------------- */

describe('worker.processOnce — happy path', () => {
  let viUseFake: ReturnType<typeof vi.useFakeTimers> | undefined;

  afterEach(() => {
    if (viUseFake) {
      vi.useRealTimers();
      viUseFake = undefined;
    }
  });

  it('dispatches each claimed event to its handler and writes a succeeded log row', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });

    const handle = vi.fn(async (): Promise<HandlerOutcome> => ({
      kind: 'succeeded',
      wrote: 2,
    }));
    const h: Handler = { name: 'project_progress_evidence', handle };

    const harness = buildHarness({
      handlers: [h],
      outboxRows: [outboxRowFor(envelope)],
    });
    const result = await harness.worker.processOnce({
      now: () => harness.clock.date(),
    });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    expect(result.deliveries[0]?.status).toBe('succeeded');
    expect(result.deliveries[0]?.attempt_count).toBe(1);
    expect(result.deliveries[0]?.wrote).toBe(2);
    expect(result.claimed_per_handler).toEqual({
      project_progress_evidence: 1,
    });

    const logRows = eventLogRows(harness.client);
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      event_id: EVENT_ID,
      handler_name: 'project_progress_evidence',
      status: 'succeeded',
      attempt_count: 1,
      last_error: null,
    });
  });

  it('claims once per registered handler so fan-out is independent', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });

    const a: Handler = {
      name: 'project_progress_evidence',
      handle: vi.fn(async (): Promise<HandlerOutcome> => ({ kind: 'succeeded', wrote: 1 })),
    };
    const b: Handler = {
      name: 'project_notification',
      handle: vi.fn(async (): Promise<HandlerOutcome> => ({ kind: 'succeeded', wrote: 0 })),
    };

    const harness = buildHarness({
      handlers: [a, b],
      outboxRows: [outboxRowFor(envelope)],
    });
    const result = await harness.worker.processOnce({
      now: () => harness.clock.date(),
    });

    expect(a.handle).toHaveBeenCalledTimes(1);
    expect(b.handle).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(2);
    expect(result.deliveries.map((d) => d.handler_name).sort()).toEqual([
      'project_notification',
      'project_progress_evidence',
    ]);
    const logRows = eventLogRows(harness.client);
    expect(logRows).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Test 2: retry policy.                                                      */
/* -------------------------------------------------------------------------- */

describe('worker.processOnce — retry policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records failed on a retryable handler error and writes attempt_count=1', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });

    const h: Handler = {
      name: 'project_progress_evidence',
      handle: vi.fn(async (): Promise<HandlerOutcome> => ({
        kind: 'failed',
        message: 'transient',
        retryable: true,
      })),
    };
    const harness = buildHarness({ handlers: [h], outboxRows: [outboxRowFor(envelope)] });
    const result = await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(result.deliveries[0]?.status).toBe('failed');
    expect(result.deliveries[0]?.attempt_count).toBe(1);
    expect(result.deliveries[0]?.last_error).toBe('transient');
    const log = eventLogRows(harness.client);
    expect(log[0]?.status).toBe('failed');
    expect(log[0]?.attempt_count).toBe(1);
  });

  it('skips the delivery when called again within the backoff window', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });

    let attempts = 0;
    const h: Handler = {
      name: 'project_progress_evidence',
      handle: vi.fn(async (): Promise<HandlerOutcome> => {
        attempts += 1;
        return { kind: 'failed', message: `attempt ${attempts}`, retryable: true };
      }),
    };

    const harness = buildHarness({ handlers: [h], outboxRows: [outboxRowFor(envelope)] });

    // Attempt 1: fail at t=0.
    const r1 = await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(r1.deliveries[0]?.status).toBe('failed');
    expect(attempts).toBe(1);

    // Attempt 2: 5s later — still inside BACKOFF_MS[0] = 0? BACKOFF_MS[0]=0 means
    // "no wait". Actually for the test to be meaningful we must check
    // that the worker DOES re-attempt after a non-zero wait and SKIPS
    // inside the wait. We use BACKOFF_MS[1] = 30_000 by making two
    // prior failures and checking that the 3rd attempt is skipped
    // when 20s have elapsed.
    harness.clock.advance(20_000);
    // Make the RPC claim the same row again (simulating the next
    // poll cycle where the prior claim's lease has expired without
    // a succeeded log row).
    const r2 = await harness.worker.processOnce({ now: () => harness.clock.date() });
    // After 1 failure, the backoff for the 2nd attempt is BACKOFF_MS[0] = 0,
    // so the worker DOES re-attempt. It fails again.
    expect(r2.deliveries[0]?.status).toBe('failed');
    expect(attempts).toBe(2);

    // Now 2 failures are recorded. The backoff for the 3rd attempt
    // is BACKOFF_MS[1] = 30_000. We advance 20s — still inside the
    // window — and re-claim. The worker should SKIP, not call the
    // handler.
    harness.clock.advance(20_000);
    const r3 = await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(r3.deliveries[0]?.status).toBe('skipped_backoff');
    expect(attempts).toBe(2); // handler not called
  });

  it('re-attempts after the backoff window elapses and increments attempt_count', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });

    let attempts = 0;
    const h: Handler = {
      name: 'project_progress_evidence',
      handle: vi.fn(async (): Promise<HandlerOutcome> => {
        attempts += 1;
        return { kind: 'failed', message: `a${attempts}`, retryable: true };
      }),
    };

    const harness = buildHarness({ handlers: [h], outboxRows: [outboxRowFor(envelope)] });

    // Attempt 1: fail.
    await harness.worker.processOnce({ now: () => harness.clock.date() });
    // Attempt 2: immediate (backoff 0) — fail.
    await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(attempts).toBe(2);

    // Attempt 3: must wait BACKOFF_MS[1] = 30_000. Advance 30_001.
    harness.clock.advance(30_001);
    const r3 = await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(r3.deliveries[0]?.status).toBe('failed');
    expect(r3.deliveries[0]?.attempt_count).toBe(3);
    expect(attempts).toBe(3);

    // Attempt 4: must wait BACKOFF_MS[2] = 120_000. Advance 120_001.
    harness.clock.advance(120_001);
    const r4 = await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(r4.deliveries[0]?.attempt_count).toBe(4);

    // Attempt 5: must wait BACKOFF_MS[3] = 600_000. Advance 600_001.
    harness.clock.advance(600_001);
    const r5 = await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(r5.deliveries[0]?.attempt_count).toBe(5);
    expect(r5.deliveries[0]?.status).toBe('dead_letter');
  });

  it('marks the event dead_letter after MAX_ATTEMPTS=5 failures', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });

    const h: Handler = {
      name: 'project_progress_evidence',
      handle: vi.fn(async (): Promise<HandlerOutcome> => ({
        kind: 'failed',
        message: 'always fails',
        retryable: true,
      })),
    };

    const harness = buildHarness({ handlers: [h], outboxRows: [outboxRowFor(envelope)] });

    // Advance through all backoffs in order: 0, 30s, 2m, 10m, 1h.
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      // If a prior backoff is non-zero, advance past it BEFORE the
      // next claim. On the very first iteration there is no prior
      // failure, so the backoff gate is bypassed.
      if (i > 0) {
        const wait = (BACKOFF_MS[i - 1] ?? 0) + 1;
        harness.clock.advance(wait);
      }
      const r = await harness.worker.processOnce({ now: () => harness.clock.date() });
      if (i < MAX_ATTEMPTS - 1) {
        expect(r.deliveries[0]?.status).toBe('failed');
        expect(r.deliveries[0]?.attempt_count).toBe(i + 1);
      } else {
        expect(r.deliveries[0]?.status).toBe('dead_letter');
        expect(r.deliveries[0]?.attempt_count).toBe(MAX_ATTEMPTS);
      }
    }
    const log = eventLogRows(harness.client);
    // The dead_letter row is the most recent write for this (event,handler).
    const dl = log.find((l) => l.status === 'dead_letter');
    expect(dl).toBeDefined();
    expect(dl?.attempt_count).toBe(MAX_ATTEMPTS);
  });

  it('does not re-deliver an event that already has a succeeded log row', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });
    // Pre-seed a succeeded log row.
    const logSeed = {
      event_id: envelope.eventId,
      handler_name: 'project_progress_evidence',
      status: 'succeeded',
      attempt_count: 1,
      last_error: null,
      first_attempted_at: '2026-09-02T11:00:00.000Z',
      last_attempted_at: '2026-09-02T11:00:00.000Z',
      completed_at: '2026-09-02T11:00:00.000Z',
    };
    const client = makeFakeSupabase({
      tables: { event_log: [logSeed], event_outbox: [] },
      uniqueConstraints: { event_log: [['event_id', 'handler_name']] },
      rpcImpls: {
        claim_pending_events: () => ({ data: [], error: null }),
      },
    });
    const h: Handler = {
      name: 'project_progress_evidence',
      handle: vi.fn(async (): Promise<HandlerOutcome> => ({ kind: 'succeeded', wrote: 1 })),
    };
    const reg = createRegistry();
    reg.register(h);
    const worker = createWorker(client, reg);
    const result = await worker.processOnce();
    expect(h.handle).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Test 3: lease + timeout.                                                   */
/* -------------------------------------------------------------------------- */

describe('worker.processOnce — lease + timeout', () => {
  beforeEach(() => {
    // The lease+timeout tests rely on real wall-clock setTimeout.
    // The retry-policy describe leaves fake timers on; ensure we
    // start each lease+timeout test from a clean timer state.
    vi.useRealTimers();
  });

  it('passes the lease to claim_pending_events as a Postgres interval', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });
    let receivedLease: unknown = undefined;
    const h: Handler = {
      name: 'project_progress_evidence',
      handle: async (): Promise<HandlerOutcome> => ({ kind: 'succeeded', wrote: 1 }),
    };
    const client = makeFakeSupabase({
      tables: { event_log: [], event_outbox: [] },
      rpcImpls: {
        claim_pending_events: (params) => {
          receivedLease = params.p_lease_for;
          return { data: [outboxRowFor(envelope)], error: null };
        },
      },
    });
    const reg = createRegistry();
    reg.register(h);
    const worker = createWorker(client, reg);
    await worker.processOnce();
    expect(receivedLease).toBe(`${LEASE_SECONDS} seconds`);
  });

  it('marks a timed-out handler as failed with a retryable timeout message', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });
    const h: Handler = {
      name: 'project_progress_evidence',
      handle: (): Promise<HandlerOutcome> =>
        new Promise(() => {
          // Never resolves. Simulates a hung handler.
        }),
    };
    const harness = buildHarness({
      handlers: [h],
      outboxRows: [outboxRowFor(envelope)],
      handlerTimeoutMs: 25,
    });
    const r = await harness.runOnce();
    expect(r.deliveries[0]?.status).toBe('failed');
    expect(r.deliveries[0]?.last_error).toMatch(/timed out/);
    expect(r.deliveries[0]?.attempt_count).toBe(1);
  });

  it('exposes the locked tunables as named constants', () => {
    // PHASE3_PLAN §13 #2. These numbers are part of the protocol.
    expect(MAX_ATTEMPTS).toBe(5);
    expect(LEASE_SECONDS).toBe(60);
    expect(HANDLER_TIMEOUT_MS).toBe(30_000);
    expect([...BACKOFF_MS]).toEqual([0, 30_000, 120_000, 600_000, 3_600_000]);
  });
});

/* -------------------------------------------------------------------------- */
/* Test 4: thrown handler errors are mapped to failed.                       */
/* -------------------------------------------------------------------------- */

describe('worker.processOnce — thrown errors', () => {
  it('records a thrown handler error as a retryable failure', async () => {
    const envelope = envelopeFor('attempt.submitted', ATTEMPT_ID, {
      test_id: 't1',
      attempt_id: ATTEMPT_ID,
      correct_count: 4,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.8',
      duration_ms: 120_000,
      incorrect_question_ids: ['q1'],
    });
    const h: Handler = {
      name: 'project_progress_evidence',
      handle: async (): Promise<HandlerOutcome> => {
        throw new Error('boom');
      },
    };
    const harness = buildHarness({ handlers: [h], outboxRows: [outboxRowFor(envelope)] });
    const r = await harness.worker.processOnce({ now: () => harness.clock.date() });
    expect(r.deliveries[0]?.status).toBe('failed');
    expect(r.deliveries[0]?.last_error).toBe('boom');
    const log = eventLogRows(harness.client);
    expect(log[0]?.status).toBe('failed');
  });
});
