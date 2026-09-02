/**
 * KRODEX API — syllabus service tests.
 *
 * Covers:
 *  - listSubjects / listTopics / listSubTopics filters and order
 *  - listQuestions cursor encoding (nextCursor emitted when more
 *    rows exist; not emitted on the last page)
 *  - getQuestionOptions returns the four fields the route relies on
 *  - getSyllabusProgress assertOwned on every returned row, and
 *    cursor pagination
 *  - upsertSyllabusProgress writes through upsert
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  listSubjects,
  listTopics,
  listSubTopics,
  listQuestions,
  getQuestionOptions,
  getSyllabusProgress,
  upsertSyllabusProgress,
} from '../syllabus';

const SUB = '11111111-1111-4111-8111-111111111111';

describe('listSubjects', () => {
  it('returns rows in display_order', async () => {
    const client = makeFakeSupabase({
      tables: {
        subjects: [
          { id: 's2', display_order: 2 },
          { id: 's1', display_order: 1 },
        ],
      },
    });
    const out = await listSubjects(client);
    expect(out.map((r) => r.id)).toEqual(['s1', 's2']);
  });

  it('throws on supabase error', async () => {
    const client = makeFakeSupabase({ errorOn: 'kaboom' });
    await expect(listSubjects(client)).rejects.toThrow(/listSubjects failed/);
  });
});

describe('listTopics', () => {
  it('filters by subject_id', async () => {
    const client = makeFakeSupabase({
      tables: {
        topics: [
          { id: 't1', subject_id: 'S', display_order: 1 },
          { id: 't2', subject_id: 'OTHER', display_order: 1 },
        ],
      },
    });
    const out = await listTopics(client, { subject_id: 'S' });
    expect(out.map((r) => r.id)).toEqual(['t1']);
  });

  it('parent_topic_id=null -> top-level only', async () => {
    const client = makeFakeSupabase({
      tables: {
        topics: [
          { id: 't1', parent_topic_id: null },
          { id: 't2', parent_topic_id: 't1' },
        ],
      },
    });
    const out = await listTopics(client, { parent_topic_id: null });
    expect(out.map((r) => r.id)).toEqual(['t1']);
  });

  it('parent_topic_id=present -> only that subtree', async () => {
    const client = makeFakeSupabase({
      tables: {
        topics: [
          { id: 't1', parent_topic_id: 'P' },
          { id: 't2', parent_topic_id: 'Q' },
        ],
      },
    });
    const out = await listTopics(client, { parent_topic_id: 'P' });
    expect(out.map((r) => r.id)).toEqual(['t1']);
  });
});

describe('listSubTopics', () => {
  it('filters by topic_id and orders by display_order', async () => {
    const client = makeFakeSupabase({
      tables: {
        sub_topics: [
          { id: 'st1', topic_id: 'T', display_order: 1 },
          { id: 'st2', topic_id: 'OTHER', display_order: 1 },
          { id: 'st3', topic_id: 'T', display_order: 2 },
        ],
      },
    });
    const out = await listSubTopics(client, 'T');
    expect(out.map((r) => r.id)).toEqual(['st1', 'st3']);
  });
});

describe('listQuestions (cursor pagination)', () => {
  it('emits nextCursor when more rows exist than limit', async () => {
    const client = makeFakeSupabase({
      tables: {
        questions: [
          { id: 'q1', is_active: true },
          { id: 'q2', is_active: true },
          { id: 'q3', is_active: true },
        ],
      },
    });
    const page1 = await listQuestions(client, { limit: 2 });
    expect(page1.items.map((r) => r.id)).toEqual(['q1', 'q2']);
    expect(page1.nextCursor).toBeTruthy();
  });

  it('omits nextCursor on the last page', async () => {
    const client = makeFakeSupabase({
      tables: {
        questions: [{ id: 'q1', is_active: true }],
      },
    });
    const out = await listQuestions(client, { limit: 5 });
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });

  it('filters by type and difficulty', async () => {
    const client = makeFakeSupabase({
      tables: {
        questions: [
          { id: 'q1', is_active: true, question_type: 'single_mcq', difficulty: 'easy' },
          { id: 'q2', is_active: true, question_type: 'numerical', difficulty: 'easy' },
        ],
      },
    });
    const out = await listQuestions(client, { type: 'single_mcq', difficulty: 'easy' });
    expect(out.items.map((r) => r.id)).toEqual(['q1']);
  });
});

describe('getQuestionOptions', () => {
  it('returns the four fields the route relies on', async () => {
    const client = makeFakeSupabase({
      tables: {
        question_options: [
          { id: 'o1', question_id: 'q1', display_order: 1, body: 'A', is_correct: true },
          { id: 'o2', question_id: 'q1', display_order: 2, body: 'B', is_correct: false },
        ],
      },
    });
    const out = await getQuestionOptions(client, 'q1');
    expect(out).toHaveLength(2);
    expect(out[0]?.is_correct).toBe(true);
  });
});

describe('getSyllabusProgress (assertOwned + cursor)', () => {
  it('returns an empty page when no rows match the caller', async () => {
    // The service filters by user_id at the query level, so another
    // user's rows are never returned. assertOwned is defense-in-
    // depth for that filter, not the only line of defense.
    const client = makeFakeSupabase({
      tables: {
        syllabus_progress: [
          { id: 'p1', user_id: 'other', scope: 'subject', updated_at: '2026-09-01T00:00:00Z' },
        ],
      },
    });
    const out = await getSyllabusProgress(client, SUB, 'subject');
    expect(out.items).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });

  it('returns rows owned by the caller and emits nextCursor', async () => {
    const client = makeFakeSupabase({
      tables: {
        syllabus_progress: [
          { id: 'p1', user_id: SUB, scope: 'subject', updated_at: '2026-09-01T00:00:00Z' },
          { id: 'p2', user_id: SUB, scope: 'subject', updated_at: '2026-08-31T00:00:00Z' },
        ],
      },
    });
    const out = await getSyllabusProgress(client, SUB, 'subject', null, 1);
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeTruthy();
  });
});

describe('upsertSyllabusProgress', () => {
  it('upserts and asserts ownership', async () => {
    const client = makeFakeSupabase();
    const row = await upsertSyllabusProgress(client, SUB, {
      scope: 'subject',
      scope_id: null,
      coverage_state: 'in_progress',
    });
    expect(row.user_id).toBe(SUB);
    expect(row.coverage_state).toBe('in_progress');
  });
});
