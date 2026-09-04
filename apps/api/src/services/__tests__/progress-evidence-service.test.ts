/**
 * KRODEX API — ProgressEvidenceService tests (Phase 11).
 *
 * Covers:
 *  - appendPlannerEvidence inserts a row with the requested
 *    dimension, ref_kind, ref_id, delta
 *  - the emitted outbox event is dimension-mapped:
 *    planner_* / backlog_recovered -> progress.planner_completed
 *    errors_*                      -> progress.error_resolved
 *  - the convenience helpers (recordTaskCompleted /
 *    recordTaskMissed / recordBacklogRecovered /
 *    recordErrorResolved / recordErrorReopened) call through to
 *    the same shape
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  appendPlannerEvidence,
  recordBacklogRecovered,
  recordErrorReopened,
  recordErrorResolved,
  recordTaskCompleted,
  recordTaskMissed,
} from '../progress-evidence-service';

const SUB = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const BACKLOG_ID = '33333333-3333-4333-8333-333333333333';
const ERROR_ID = '44444444-4444-4444-8444-444444444444';

describe('appendPlannerEvidence', () => {
  it('inserts a progress_evidence row with the requested fields', async () => {
    const client = makeFakeSupabase();
    const out = await appendPlannerEvidence(client, {
      userId: SUB,
      dimension: 'planner_completion',
      value: 1,
      refKind: 'planner_task',
      refId: TASK_ID,
      metadata: { source: 'phase11' },
    });
    expect(out.row.dimension).toBe('planner_completion');
    expect(out.row.delta).toBe(String(1));
    expect(out.row.ref_kind).toBe('planner_task');
    expect(out.row.ref_id).toBe(TASK_ID);
    expect(out.row.user_id).toBe(SUB);
    expect(out.eventType).toBe('progress.planner_completed');
  });

  it('routes error dimensions to progress.error_resolved', async () => {
    const client = makeFakeSupabase();
    const out = await appendPlannerEvidence(client, {
      userId: SUB,
      dimension: 'errors_resolved',
      value: 1,
      refKind: 'error_entry',
      refId: ERROR_ID,
    });
    expect(out.eventType).toBe('progress.error_resolved');
  });

  it('routes errors_reopened to progress.error_resolved envelope family', async () => {
    const client = makeFakeSupabase();
    const out = await appendPlannerEvidence(client, {
      userId: SUB,
      dimension: 'errors_reopened',
      value: 1,
      refKind: 'error_entry',
      refId: ERROR_ID,
    });
    expect(out.eventType).toBe('progress.error_resolved');
  });

  it('routes backlog_recovered to the planner event type', async () => {
    const client = makeFakeSupabase();
    const out = await appendPlannerEvidence(client, {
      userId: SUB,
      dimension: 'backlog_recovered',
      value: 1,
      refKind: 'backlog_item',
      refId: BACKLOG_ID,
    });
    expect(out.eventType).toBe('progress.planner_completed');
  });

  it('defaults captured_at to now when not provided', async () => {
    const client = makeFakeSupabase();
    const out = await appendPlannerEvidence(client, {
      userId: SUB,
      dimension: 'planner_completion',
      value: 1,
      refKind: 'planner_task',
      refId: TASK_ID,
    });
    expect(out.row.captured_at).toBeTruthy();
    // ISO timestamp parses.
    expect(Number.isNaN(Date.parse(out.row.captured_at))).toBe(false);
  });

  it('respects an explicit observedAt timestamp', async () => {
    const client = makeFakeSupabase();
    const out = await appendPlannerEvidence(client, {
      userId: SUB,
      dimension: 'planner_completion',
      value: 1,
      refKind: 'planner_task',
      refId: TASK_ID,
      observedAt: '2026-09-01T10:00:00.000Z',
    });
    expect(out.row.captured_at).toBe('2026-09-01T10:00:00.000Z');
  });
});

describe('convenience helpers', () => {
  it('recordTaskCompleted appends a planner_completion row with delta=1', async () => {
    const client = makeFakeSupabase();
    const out = await recordTaskCompleted(client, SUB, TASK_ID, { source: 'test' });
    expect(out.row.dimension).toBe('planner_completion');
    expect(out.row.delta).toBe(String(1));
    expect(out.row.ref_kind).toBe('planner_task');
    expect(out.row.ref_id).toBe(TASK_ID);
  });

  it('recordTaskMissed appends a planner_backlog row with the miss count', async () => {
    const client = makeFakeSupabase();
    const out = await recordTaskMissed(client, SUB, TASK_ID, 3);
    expect(out.row.dimension).toBe('planner_backlog');
    expect(out.row.delta).toBe(String(3));
  });

  it('recordBacklogRecovered appends a backlog_recovered row with delta=1', async () => {
    const client = makeFakeSupabase();
    const out = await recordBacklogRecovered(client, SUB, BACKLOG_ID);
    expect(out.row.dimension).toBe('backlog_recovered');
    expect(out.row.delta).toBe(String(1));
    expect(out.row.ref_kind).toBe('backlog_item');
  });

  it('recordErrorResolved appends an errors_resolved row', async () => {
    const client = makeFakeSupabase();
    const out = await recordErrorResolved(client, SUB, ERROR_ID);
    expect(out.row.dimension).toBe('errors_resolved');
    expect(out.row.delta).toBe(String(1));
    expect(out.eventType).toBe('progress.error_resolved');
  });

  it('recordErrorReopened appends an errors_reopened row', async () => {
    const client = makeFakeSupabase();
    const out = await recordErrorReopened(client, SUB, ERROR_ID);
    expect(out.row.dimension).toBe('errors_reopened');
    expect(out.row.delta).toBe(String(1));
    expect(out.eventType).toBe('progress.error_resolved');
  });
});
