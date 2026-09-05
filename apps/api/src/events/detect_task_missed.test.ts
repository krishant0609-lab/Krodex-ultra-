/**
 * KRODEX — detect_task_missed scheduled job tests.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import { JOB_NAME, runDetectTaskMissed } from './detect_task_missed';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function fixedNow(iso: string): () => Date {
  return () => new Date(iso);
}

describe('detect_task_missed job', () => {
  it('returns ok=true and reports the transitioned count from the SQL function', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        detect_missed_tasks: () => ({
          data: [
            { task_id: 't1', backlog_item_id: 'b1', event_id: 'e1' },
            { task_id: 't2', backlog_item_id: 'b2', event_id: 'e2' },
            { task_id: 't3', backlog_item_id: 'b3', event_id: 'e3' },
          ],
          error: null,
        }),
      },
    });
    const r = await runDetectTaskMissed(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
    expect(r.transitionedCount).toBe(3);
    expect(r.tickEnvelope.eventType).toBe('system.tick');
    expect(r.tickEnvelope.aggregateType).toBe('scheduled_job');
    expect(r.tickEnvelope.aggregateId).toBe(JOB_NAME);
    expect(r.tickEnvelope.payload.job_name).toBe('detect_task_missed');
    expect(r.tickEnvelope.payload.ran_at).toBe('2026-09-02T10:00:00.000Z');
    expect(r.tickEnvelope.payload.emitted_event_count).toBe(3);
  });

  it('writes a system.tick row into event_outbox with user_id=null', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        detect_missed_tasks: () => ({ data: [], error: null }),
      },
    });
    const r = await runDetectTaskMissed(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(1);
    const row = outbox[0] as { event_type: string; aggregate_type: string; aggregate_id: string; user_id: string | null };
    expect(row.event_type).toBe('system.tick');
    expect(row.aggregate_type).toBe('scheduled_job');
    expect(row.aggregate_id).toBe('detect_task_missed');
    // Migration 20: system.tick is system-owned; user_id is null.
    expect(row.user_id).toBeNull();
    // The pre-remediation defect was the nil UUID. A future regression
    // would surface here.
    expect(r.tickEnvelope.accountId).toBeNull();
    expect(r.tickEnvelope.accountId).not.toBe('00000000-0000-0000-0000-000000000000');
  });

  it('returns ok=true with zero count when the lookback is empty', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        detect_missed_tasks: () => ({ data: [], error: null }),
      },
    });
    const r = await runDetectTaskMissed(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(true);
    expect(r.transitionedCount).toBe(0);
  });

  it('returns ok=false and never writes the tick when the SQL function errors', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        detect_missed_tasks: () => ({
          data: null,
          error: { code: 'P0001', message: 'simulated sql failure' },
        }),
      },
    });
    const r = await runDetectTaskMissed(client, fixedNow('2026-09-02T10:00:00.000Z'));
    expect(r.ok).toBe(false);
    expect(r.transitionedCount).toBe(0);
    expect(r.error).toContain('simulated sql failure');
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(0);
  });

  it('emits two ticks across two distinct seconds', async () => {
    const client = makeFakeSupabase({
      tables: { event_outbox: [] },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
      rpcImpls: {
        detect_missed_tasks: () => ({ data: [], error: null }),
      },
    });
    await runDetectTaskMissed(client, fixedNow('2026-09-02T10:00:00.000Z'));
    await runDetectTaskMissed(client, fixedNow('2026-09-02T10:00:01.000Z'));
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(2);
  });
});
