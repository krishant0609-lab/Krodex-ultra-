/**
 * KRODEX API — planner service tests.
 *
 * Covers:
 *  - createPlannerTask inserts with state='planned'
 *  - getPlannerTask throws NotFoundError on miss
 *  - getPlannerTask throws ForbiddenError on cross-tenant
 *  - listPlannerTasks filters by state, plan_date, subject_id
 *  - updatePlannerTask auto-stamps started_at / completed_at on
 *    the corresponding state transitions
 *  - createPlannerTemplate with is_default=true clears other
 *    default flags first (single-default invariant)
 *  - markTaskMissed: invalid on terminal states, otherwise
 *    creates a backlog item alongside
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  createPlannerTask,
  getPlannerTask,
  listPlannerTasks,
  updatePlannerTask,
  createPlannerTemplate,
  listPlannerTemplates,
  markTaskMissed,
} from '../planner';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

describe('createPlannerTask', () => {
  it('inserts a planned task with the listed fields', async () => {
    const client = makeFakeSupabase();
    const row = await createPlannerTask(client, SUB, {
      plan_date: '2026-09-02',
      title: 'Practice electrostatics',
    });
    expect(row.user_id).toBe(SUB);
    expect(row.state).toBe('planned');
    expect(row.title).toBe('Practice electrostatics');
  });
});

describe('getPlannerTask', () => {
  it('throws NotFoundError on miss', async () => {
    const client = makeFakeSupabase();
    await expect(getPlannerTask(client, SUB, TASK_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError on cross-tenant', async () => {
    const client = makeFakeSupabase({
      tables: { planner_tasks: [{ id: TASK_ID, user_id: 'other' }] },
    });
    await expect(getPlannerTask(client, SUB, TASK_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('listPlannerTasks', () => {
  it('filters by state, plan_date, subject_id', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: 't1', user_id: SUB, state: 'planned', plan_date: '2026-09-02', subject_id: 'phy' },
          { id: 't2', user_id: SUB, state: 'completed', plan_date: '2026-09-02', subject_id: 'phy' },
          { id: 't3', user_id: SUB, state: 'planned', plan_date: '2026-09-03', subject_id: 'math' },
        ],
      },
    });
    const out = await listPlannerTasks(client, SUB, {
      state: 'planned',
      plan_date: '2026-09-02',
      subject_id: 'phy',
    });
    expect(out.map((r) => r.id)).toEqual(['t1']);
  });
});

describe('updatePlannerTask', () => {
  it('auto-stamps started_at on in_progress transition', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', started_at: null },
        ],
      },
    });
    const row = await updatePlannerTask(client, SUB, TASK_ID, { state: 'in_progress' });
    expect(row.state).toBe('in_progress');
    expect(row.started_at).toBeTruthy();
  });

  it('auto-stamps completed_at on completed transition', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'in_progress', started_at: '2026-09-02T01:00:00Z' },
        ],
      },
    });
    const row = await updatePlannerTask(client, SUB, TASK_ID, { state: 'completed' });
    expect(row.state).toBe('completed');
    expect(row.completed_at).toBeTruthy();
  });

  it('respects an explicit completed_at override', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'in_progress', started_at: '2026-09-02T01:00:00Z' },
        ],
      },
    });
    const explicit = '2026-09-02T02:30:00Z';
    const row = await updatePlannerTask(client, SUB, TASK_ID, {
      state: 'completed',
      completed_at: explicit,
    });
    expect(row.completed_at).toBe(explicit);
  });
});

describe('createPlannerTemplate / listPlannerTemplates', () => {
  it('is_default=true clears previous defaults', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_templates: [
          { id: 'tpl-old', user_id: SUB, is_default: true },
        ],
      },
    });
    const row = await createPlannerTemplate(client, SUB, {
      name: 'school-day',
      is_default: true,
      template_payload: { blocks: [] },
    });
    expect(row.is_default).toBe(true);
    const old = (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> })
      .__rows('planner_templates')
      .find((r) => r.id === 'tpl-old');
    expect(old?.is_default).toBe(false);
  });

  it('listPlannerTemplates returns all rows for the user', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_templates: [
          { id: 'a', user_id: SUB, created_at: '2026-09-01T00:00:00Z' },
          { id: 'b', user_id: 'other', created_at: '2026-09-01T00:00:00Z' },
        ],
      },
    });
    const out = await listPlannerTemplates(client, SUB);
    expect(out.map((r) => r.id)).toEqual(['a']);
  });
});

describe('markTaskMissed', () => {
  it('refuses to mark a terminal task missed', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'completed' },
        ],
      },
    });
    await expect(markTaskMissed(client, SUB, TASK_ID)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('marks missed and creates a backlog item', async () => {
    const client = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned' },
        ],
      },
    });
    const out = await markTaskMissed(client, SUB, TASK_ID);
    expect(out.task.state).toBe('missed');
    expect(out.backlog).toBeTruthy();
    expect(out.backlog?.source_task_id).toBe(TASK_ID);
    expect(out.backlog?.reason).toBe('missed');
    expect(out.backlog?.state).toBe('open');
  });
});

/**
 * Phase 3 §4.2 — planner service-layer event emissions.
 *
 * Two events come out of the planner service:
 *   - `task.completed` from updatePlannerTask when the state
 *     transitions into 'completed' (not on idempotent re-marks).
 *   - `task.missed` from markTaskMissed after the state has
 *     flipped to 'missed' and the backlog item exists.
 *
 * The fake supabase returns `data: null, error: { message: 'no
 * row returned' }` for inserts into unknown tables, so the
 * service's post-commit emit is treated as a failure, which is
 * caught and logged. The source mutation still returns the
 * patched row, which is the spec's "log and continue" policy.
 */
describe('Phase 3: planner service-layer event emissions', () => {
  const OUTBOX_UNIQUE = [
    ['user_id', 'event_type', 'idempotency_key'],
  ] as const;

  function outboxRows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
    return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('event_outbox');
  }

  it('updatePlannerTask emits task.completed exactly once on state→completed', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'in_progress', started_at: '2026-09-02T01:00:00Z' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const row = await updatePlannerTask(client, SUB, TASK_ID, { state: 'completed' });
    expect(row.state).toBe('completed');
    const outbox = outboxRows(client);
    expect(outbox).toHaveLength(1);
    const ev = outbox[0] as {
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      actor_id: string | null;
      payload: { task_id: string; plan_date: string | null; subject_id: string | null };
    };
    expect(ev.event_type).toBe('task.completed');
    expect(ev.aggregate_type).toBe('planner_task');
    expect(ev.aggregate_id).toBe(TASK_ID);
    expect(ev.actor_id).toBe(SUB);
    expect(ev.payload.task_id).toBe(TASK_ID);
  });

  it('updatePlannerTask does NOT re-emit task.completed on idempotent re-mark', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'completed', started_at: '2026-09-02T01:00:00Z', completed_at: '2026-09-02T02:00:00Z' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updatePlannerTask(client, SUB, TASK_ID, { state: 'completed' });
    expect(outboxRows(client)).toHaveLength(0);
  });

  it('updatePlannerTask does NOT emit task.completed on non-completed state changes', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updatePlannerTask(client, SUB, TASK_ID, { state: 'in_progress' });
    expect(outboxRows(client)).toHaveLength(0);
  });

  it('updatePlannerTask succeeds even when event_outbox is missing (post-commit log-and-continue)', async () => {
    const client = makeFakeSupabase({
      // Intentionally NO event_outbox table.
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'in_progress', started_at: '2026-09-02T01:00:00Z' },
        ],
      },
    });
    const row = await updatePlannerTask(client, SUB, TASK_ID, { state: 'completed' });
    expect(row.state).toBe('completed');
  });

  it('markTaskMissed emits task.missed after the state flips and the backlog item is created', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-09-02', subject_id: 'phy' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const out = await markTaskMissed(client, SUB, TASK_ID);
    expect(out.task.state).toBe('missed');
    const ob = outboxRows(client);
    expect(ob).toHaveLength(1);
    const ev = ob[0] as {
      event_type: string;
      aggregate_id: string;
      payload: { task_id: string; plan_date: string | null; subject_id: string | null };
    };
    expect(ev.event_type).toBe('task.missed');
    expect(ev.aggregate_id).toBe(TASK_ID);
    expect(ev.payload.task_id).toBe(TASK_ID);
    expect(ev.payload.plan_date).toBe('2026-09-02');
    expect(ev.payload.subject_id).toBe('phy');
  });
});
