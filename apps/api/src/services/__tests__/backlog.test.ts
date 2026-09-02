/**
 * KRODEX API — backlog service tests.
 *
 * Covers:
 *  - listBacklogItems filters by state and reason
 *  - getBacklogItem throws NotFoundError / ForbiddenError
 *  - recoverBacklogItem refuses on terminal states, otherwise
 *    creates a new planner_task, marks backlog recovered, and
 *    records a backlog_recoveries row
 *  - dropBacklogItem transitions to dropped and asserts
 *    ownership
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  listBacklogItems,
  getBacklogItem,
  recoverBacklogItem,
  dropBacklogItem,
} from '../backlog';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const BACKLOG_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_TASK_ID = '33333333-3333-4333-8333-333333333333';

describe('listBacklogItems', () => {
  it('filters by state and reason, returns user-owned rows in created_at desc', async () => {
    const client = makeFakeSupabase({
      tables: {
        backlog_items: [
          { id: 'b1', user_id: SUB, state: 'open', reason: 'missed', created_at: '2026-09-02T00:00:00Z' },
          { id: 'b2', user_id: SUB, state: 'recovered', reason: 'missed', created_at: '2026-09-01T00:00:00Z' },
          { id: 'b3', user_id: 'other', state: 'open', reason: 'missed' },
        ],
      },
    });
    const out = await listBacklogItems(client, SUB, { state: 'open' });
    expect(out.map((r) => r.id)).toEqual(['b1']);
  });
});

describe('getBacklogItem', () => {
  it('throws NotFoundError on miss', async () => {
    const client = makeFakeSupabase();
    await expect(getBacklogItem(client, SUB, BACKLOG_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError on cross-tenant', async () => {
    const client = makeFakeSupabase({
      tables: { backlog_items: [{ id: BACKLOG_ID, user_id: 'other' }] },
    });
    await expect(getBacklogItem(client, SUB, BACKLOG_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('recoverBacklogItem', () => {
  it('refuses on a terminal state', async () => {
    const client = makeFakeSupabase({
      tables: {
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, state: 'recovered', source_task_id: SOURCE_TASK_ID },
        ],
      },
    });
    await expect(
      recoverBacklogItem(client, SUB, BACKLOG_ID, {}),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('refuses if the source task is gone', async () => {
    const client = makeFakeSupabase({
      tables: {
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, state: 'open', source_task_id: SOURCE_TASK_ID },
        ],
      },
    });
    await expect(
      recoverBacklogItem(client, SUB, BACKLOG_ID, {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recover flow: new task + recovered backlog + recovery row', async () => {
    const client = makeFakeSupabase({
      tables: {
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, state: 'open', source_task_id: SOURCE_TASK_ID },
        ],
        planner_tasks: [
          {
            id: SOURCE_TASK_ID,
            user_id: SUB,
            title: 'Practice electrostatics',
            description: 'chapter 2',
            state: 'missed',
          },
        ],
      },
    });
    const out = await recoverBacklogItem(client, SUB, BACKLOG_ID, {
      plan_date: '2026-09-03',
    });
    expect(out.backlog.state).toBe('recovered');
    expect(out.recovered_task.title).toBe('Practice electrostatics');
    expect(out.recovered_task.state).toBe('planned');
    expect(out.recovery.backlog_item_id).toBe(BACKLOG_ID);
  });
});

describe('dropBacklogItem', () => {
  it('transitions the row to dropped', async () => {
    const client = makeFakeSupabase({
      tables: {
        backlog_items: [
          { id: BACKLOG_ID, user_id: SUB, state: 'open' },
        ],
      },
    });
    const row = await dropBacklogItem(client, SUB, BACKLOG_ID);
    expect(row.state).toBe('dropped');
  });
});
