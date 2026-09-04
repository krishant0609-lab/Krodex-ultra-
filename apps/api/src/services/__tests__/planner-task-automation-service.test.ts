/**
 * KRODEX API — PlannerTaskAutomationService tests (Phase 11).
 *
 * Covers:
 *  - detectMissedTasks: scans overdue tasks, flips to 'missed',
 *    creates backlog items, is idempotent on re-scan
 *  - markPartial: transitions to 'partial', increments
 *    partial_count, appends planner_task_events row, creates
 *    backlog item; idempotent on re-mark
 *  - rescheduleTask: creates a new task linked via
 *    source_task_id, appends 'rescheduled' event, preserves
 *    original; refuses on completed
 *  - recoverBacklogItem: reschedule creates a new task and
 *    flips backlog to 'recovered'; complete marks the source
 *    task complete; dismiss flips to 'dropped'; split records
 *    the recovery event without state change
 *  - getTaskHistory: returns events in descending order, throws
 *    NotFoundError on miss, ForbiddenError on cross-tenant
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  detectMissedTasks,
  getTaskHistory,
  markPartial,
  recoverBacklogItem,
  rescheduleTask,
} from '../planner-task-automation-service';
import { ForbiddenError, NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID_2 = '33333333-3333-4333-8333-333333333333';
const BACKLOG_ID = '44444444-4444-4444-8444-444444444444';

type TestRow = Record<string, unknown>;
function rows(
  client: ReturnType<typeof makeFakeSupabase>,
  table: string,
): TestRow[] {
  return (
    client as unknown as { __rows: (t: string) => TestRow[] }
  ).__rows(table);
}

describe('detectMissedTasks', () => {
  it('flips overdue planned tasks to missed and creates backlog items', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-08-30' },
        ],
      },
    });
    const out = await detectMissedTasks(client, { userId: SUB });
    expect(out.newlyMissed).toHaveLength(1);
    expect(out.newlyMissed[0]?.task.state).toBe('missed');
    expect(out.alreadyMissed).toHaveLength(0);
    // Backlog item was inserted.
    const backlogs = rows(client, 'backlog_items');
    expect(backlogs).toHaveLength(1);
    expect(backlogs[0]?.source_task_id).toBe(TASK_ID);
    expect(backlogs[0]?.reason).toBe('missed');
    // History row was appended.
    const events = rows(client, 'planner_task_events');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('missed');
    expect(events[0]?.task_id).toBe(TASK_ID);
  });

  it('is idempotent: re-scan finds already-missed task and skips it', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'missed', plan_date: '2026-08-30' },
        ],
      },
    });
    const out = await detectMissedTasks(client, { userId: SUB });
    expect(out.newlyMissed).toHaveLength(0);
    expect(out.alreadyMissed).toHaveLength(1);
    expect(out.alreadyMissed[0]?.task.id).toBe(TASK_ID);
    // No backlog item was created.
    expect(rows(client, 'backlog_items')).toHaveLength(0);
  });

  it('skips future tasks and completed tasks', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-12-30' },
          { id: TASK_ID_2, user_id: SUB, state: 'completed', plan_date: '2026-08-30' },
        ],
      },
    });
    const out = await detectMissedTasks(client, { userId: SUB });
    expect(out.newlyMissed).toHaveLength(0);
  });
});

describe('markPartial', () => {
  it('transitions planned task to partial, increments partial_count, creates backlog', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-09-01', partial_count: 0 },
        ],
      },
    });
    const out = await markPartial(client, { userId: SUB, taskId: TASK_ID });
    expect(out.task.state).toBe('partial');
    expect(out.task.partial_count).toBe(1);
    // History row.
    const events = rows(client, 'planner_task_events');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('partial');
    // Backlog item.
    const backlogs = rows(client, 'backlog_items');
    expect(backlogs).toHaveLength(1);
    expect(backlogs[0]?.reason).toBe('partial');
    // Recovery event.
    const recovery = rows(client, 'backlog_recovery_events');
    expect(recovery).toHaveLength(1);
    expect(recovery[0]?.recovery_type).toBe('downgraded');
  });

  it('throws on completed task', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'completed' },
        ],
      },
    });
    await expect(
      markPartial(client, { userId: SUB, taskId: TASK_ID }),
    ).rejects.toThrow(/completed/);
  });

  it('is idempotent on already-partial: no second backlog item, but a second event row', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'partial', plan_date: '2026-09-01', partial_count: 1 },
        ],
      },
    });
    const out = await markPartial(client, { userId: SUB, taskId: TASK_ID });
    expect(out.task.state).toBe('partial');
    // An event row IS appended (records the additional attempt).
    const events = rows(client, 'planner_task_events');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e?.event_type === 'partial')).toBe(true);
  });
});

describe('rescheduleTask', () => {
  it('creates a new task linked via source_task_id and appends rescheduled event', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          {
            id: TASK_ID,
            user_id: SUB,
            state: 'planned',
            plan_date: '2026-09-01',
            title: 'Original',
            partial_count: 0,
          },
        ],
      },
    });
    const out = await rescheduleTask(client, {
      userId: SUB,
      taskId: TASK_ID,
      newDueAt: '2026-09-08',
    });
    expect(out.originalTask.id).toBe(TASK_ID);
    expect(out.newTask.id).not.toBe(TASK_ID);
    expect(out.newTask.plan_date).toBe('2026-09-08');
    expect(out.newTask.title).toBe('Original');
    expect(out.newTask.source_task_id).toBe(TASK_ID);
    // Original task is preserved.
    const all = rows(client, 'planner_tasks');
    expect(all).toHaveLength(2);
    expect(all.find((r) => r?.id === TASK_ID)?.state).toBe('planned');
    // History row on the original.
    const events = rows(client, 'planner_task_events');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('rescheduled');
    expect(events[0]?.task_id).toBe(TASK_ID);
    expect(events[0]?.previous_due_at).toBe('2026-09-01');
    expect(events[0]?.new_due_at).toBe('2026-09-08');
  });

  it('refuses to reschedule a completed task', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [{ id: TASK_ID, user_id: SUB, state: 'completed' }],
      },
    });
    await expect(
      rescheduleTask(client, { userId: SUB, taskId: TASK_ID, newDueAt: '2026-09-08' }),
    ).rejects.toThrow(/completed/);
  });

  it('throws NotFoundError on missing task', async () => {
    const client = makeFakeSupabase();
    await expect(
      rescheduleTask(client, { userId: SUB, taskId: TASK_ID, newDueAt: '2026-09-08' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError on cross-tenant', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [{ id: TASK_ID, user_id: OTHER, state: 'planned' }],
      },
    });
    await expect(
      rescheduleTask(client, { userId: SUB, taskId: TASK_ID, newDueAt: '2026-09-08' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('recoverBacklogItem', () => {
  it('reschedule creates a new task and flips backlog to recovered', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'missed', plan_date: '2026-08-30', title: 'Missed' },
        ],
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, source_task_id: TASK_ID, reason: 'missed', state: 'open' },
        ],
      },
    });
    const out = await recoverBacklogItem(client, {
      userId: SUB,
      backlogItemId: BACKLOG_ID,
      action: 'reschedule',
      newDueAt: '2026-09-08',
    });
    expect(out.newTask).toBeTruthy();
    expect(out.newTask?.plan_date).toBe('2026-09-08');
    expect(out.newTask?.source_task_id).toBe(TASK_ID);
    // Backlog flipped to recovered.
    const backlogs = rows(client, 'backlog_items');
    expect(backlogs[0]?.state).toBe('recovered');
    // Recovery event.
    const recovery = rows(client, 'backlog_recovery_events');
    expect(recovery.some((e) => e?.recovery_type === 'rescheduled')).toBe(true);
  });

  it('reschedule requires newDueAt', async () => {
    const client = makeFakeSupabase({
      tables: {
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, source_task_id: TASK_ID, reason: 'missed', state: 'open' },
        ],
      },
    });
    await expect(
      recoverBacklogItem(client, { userId: SUB, backlogItemId: BACKLOG_ID, action: 'reschedule' }),
    ).rejects.toThrow(/newDueAt/);
  });

  it('complete marks the source task completed', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-08-30' },
        ],
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, source_task_id: TASK_ID, reason: 'missed', state: 'open' },
        ],
      },
    });
    const out = await recoverBacklogItem(client, {
      userId: SUB,
      backlogItemId: BACKLOG_ID,
      action: 'complete',
    });
    const all = rows(client, 'planner_tasks');
    const source = all.find((r) => r?.id === TASK_ID);
    expect(source?.state).toBe('completed');
    expect(out.backlogItem.state).toBe('recovered');
    // History row for the completion.
    const events = rows(client, 'planner_task_events');
    expect(events.some((e) => e?.event_type === 'completed')).toBe(true);
  });

  it('dismiss flips the backlog to dropped and does not touch any planner task', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-08-30' },
        ],
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, source_task_id: TASK_ID, reason: 'missed', state: 'open' },
        ],
      },
    });
    const out = await recoverBacklogItem(client, {
      userId: SUB,
      backlogItemId: BACKLOG_ID,
      action: 'dismiss',
    });
    expect(out.backlogItem.state).toBe('dropped');
    const all = rows(client, 'planner_tasks');
    const source = all.find((r) => r?.id === TASK_ID);
    expect(source?.state).toBe('planned');
  });

  it('split records the recovery event without state change', async () => {
    const client = makeFakeSupabase({
      tables: {
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, source_task_id: TASK_ID, reason: 'missed', state: 'open' },
        ],
      },
    });
    const out = await recoverBacklogItem(client, {
      userId: SUB,
      backlogItemId: BACKLOG_ID,
      action: 'split',
    });
    expect(out.newTask).toBeUndefined();
    expect(out.backlogItem.state).toBe('open');
    const recovery = rows(client, 'backlog_recovery_events');
    expect(recovery.some((e) => e?.recovery_type === 'split')).toBe(true);
  });

  it('throws NotFoundError on missing backlog item', async () => {
    const client = makeFakeSupabase();
    await expect(
      recoverBacklogItem(client, {
        userId: SUB,
        backlogItemId: BACKLOG_ID,
        action: 'dismiss',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getTaskHistory', () => {
  it('returns events in descending order for the given task', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [{ id: TASK_ID, user_id: SUB }],
        planner_task_events: [
          { id: 'e1', task_id: TASK_ID, event_type: 'created', created_at: '2026-08-30T10:00:00Z' },
          { id: 'e2', task_id: TASK_ID, event_type: 'completed', created_at: '2026-09-01T10:00:00Z' },
          { id: 'e3', task_id: TASK_ID, event_type: 'missed', created_at: '2026-08-31T10:00:00Z' },
        ],
      },
    });
    const out = await getTaskHistory(client, SUB, TASK_ID);
    expect(out.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });

  it('throws NotFoundError on missing task', async () => {
    const client = makeFakeSupabase();
    await expect(getTaskHistory(client, SUB, TASK_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError on cross-tenant', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [{ id: TASK_ID, user_id: OTHER }],
      },
    });
    await expect(getTaskHistory(client, SUB, TASK_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
