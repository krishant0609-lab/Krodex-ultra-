/**
 * KRODEX — mark_review_due scheduled job tests.
 *
 * The job's contract:
 *   1. Call the SECURITY DEFINER SQL function `mark_due_reviews`.
 *   2. Emit a synthetic `system.tick` audit event with
 *      aggregate_type='scheduled_job' and aggregate_id=job name.
 *
 * The fake RPC lets us inject a deterministic response from
 * `mark_due_reviews` without a live DB.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import { JOB_NAME, runMarkReviewDue } from './mark_review_due';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function fixedNow(iso: string): () => Date {
  return () => new Date(iso);
}

describe('mark_review_due job', () => {
  it('returns ok=true and reports the transitioned count from the SQL function', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({
          data: [
            { schedule_id: 's1', event_id: 'e1' },
            { schedule_id: 's2', event_id: 'e2' },
          ],
          error: null,
        }),
      },
    });
    const r = await runMarkReviewDue(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
    expect(r.transitionedCount).toBe(2);
    expect(r.tickEnvelope.eventType).toBe('system.tick');
    expect(r.tickEnvelope.aggregateType).toBe('scheduled_job');
    expect(r.tickEnvelope.aggregateId).toBe(JOB_NAME);
    expect(r.tickEnvelope.payload.job_name).toBe('mark_review_due');
    expect(r.tickEnvelope.payload.ran_at).toBe('2026-09-02T10:00:00.000Z');
    expect(r.tickEnvelope.payload.emitted_event_count).toBe(2);
  });

  it('writes a system.tick row into event_outbox', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
      },
    });
    const r = await runMarkReviewDue(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(1);
    const row = outbox[0] as { event_type: string; aggregate_type: string; aggregate_id: string; user_id: string | null };
    expect(row.event_type).toBe('system.tick');
    expect(row.aggregate_type).toBe('scheduled_job');
    expect(row.aggregate_id).toBe('mark_review_due');
    // Migration 20: system.tick is system-owned; user_id is null.
    // This is the contract that prevents the production 23503 FK
    // violation. A future refactor that reintroduces the nil UUID
    // would break this assertion.
    expect(row.user_id).toBeNull();
  });

  it('emitted envelope carries accountId=null (regression: not the nil UUID)', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
      },
    });
    const r = await runMarkReviewDue(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
    expect(r.tickEnvelope.accountId).toBeNull();
    expect(r.tickEnvelope.accountId).not.toBe('00000000-0000-0000-0000-000000000000');
  });

  it('returns ok=true and emits a zero-count tick when nothing was due', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
      },
    });
    const r = await runMarkReviewDue(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
    expect(r.transitionedCount).toBe(0);
    expect(r.tickEnvelope.payload.emitted_event_count).toBe(0);
  });

  it('returns ok=false and never writes the tick when the SQL function errors', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({
          data: null,
          error: { code: 'P0001', message: 'simulated sql failure' },
        }),
      },
    });
    const r = await runMarkReviewDue(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(false);
    expect(r.transitionedCount).toBe(0);
    expect(r.error).toContain('simulated sql failure');
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(0);
  });

  it('is idempotent across two runs in the same second (same bucket) — the second is a duplicate', async () => {
    let calls = 0;
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => {
          calls += 1;
          return { data: [], error: null };
        },
      },
    });
    const now = fixedNow('2026-09-02T10:00:00.000Z');
    await runMarkReviewDue(client, now);
    await runMarkReviewDue(client, now);
    expect(calls).toBe(2);
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    // Two ticks, both inside the same second bucket, dedup to one row.
    expect(outbox).toHaveLength(1);
  });

  it('emits two ticks across two distinct seconds', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        mark_due_reviews: () => ({ data: [], error: null }),
      },
    });
    await runMarkReviewDue(client, fixedNow('2026-09-02T10:00:00.000Z'));
    await runMarkReviewDue(client, fixedNow('2026-09-02T10:00:01.000Z'));
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(2);
  });
});
