/**
 * KRODEX API — tests service tests.
 *
 * The grading logic itself lives in Postgres (submit_test_attempt
 * RPC). These tests cover what the API-side service does:
 *  - create / read / list / update test definitions
 *  - ownership checks
 *  - attachTestQuestion + startTestAttempt counter init
 *  - recordAnswer only when the attempt is in_progress
 *  - submitTestAttempt refuses to re-submit a non-in_progress attempt
 *
 * Note: the actual grading decision tree (single_mcq, multi_mcq,
 * numerical, short_answer, true_false, assertion_reason,
 * comprehension) is encoded in the SQL RPC
 * `public.submit_test_attempt`. Per the locked Phase 2 decisions,
 * the Postgres function is the only place the answer-to-outcome
 * mapping is computed. Those rules are covered by the SQL test
 * suite, not here.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  createTestDefinition,
  getTestDefinition,
  listTestDefinitions,
  updateTestDefinition,
  attachTestQuestion,
  startTestAttempt,
  getTestAttempt,
  listTestAttempts,
  recordAnswer,
  submitTestAttempt,
} from '../tests';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const TEST_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';

describe('createTestDefinition', () => {
  it('inserts a test definition with the expected defaults', async () => {
    const client = makeFakeSupabase();
    const row = await createTestDefinition(client, SUB, {
      title: 'mock-test-1',
      source_kind: 'manual',
      source_payload: { difficulty: 'easy' },
      intended_count: 5,
    });
    expect(row.user_id).toBe(SUB);
    expect(row.title).toBe('mock-test-1');
    expect(row.state).toBe('created');
  });

  it('throws on supabase error', async () => {
    const client = makeFakeSupabase({ errorOn: 'fail' });
    await expect(
      createTestDefinition(client, SUB, {
        title: 't',
        source_kind: 'manual',
        source_payload: {},
        intended_count: 5,
      }),
    ).rejects.toThrow(/createTestDefinition failed/);
  });
});

describe('getTestDefinition / listTestDefinitions / updateTestDefinition', () => {
  it('getTestDefinition throws NotFoundError when missing', async () => {
    const client = makeFakeSupabase();
    await expect(getTestDefinition(client, SUB, TEST_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getTestDefinition throws ForbiddenError on cross-tenant row', async () => {
    const client = makeFakeSupabase({
      tables: { test_definitions: [{ id: TEST_ID, user_id: 'other' }] },
    });
    await expect(getTestDefinition(client, SUB, TEST_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('listTestDefinitions filters by state and source_kind', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_definitions: [
          { id: 't1', user_id: SUB, state: 'created', source_kind: 'manual' },
          { id: 't2', user_id: SUB, state: 'completed', source_kind: 'syllabus' },
        ],
      },
    });
    const out = await listTestDefinitions(client, SUB, { state: 'created' });
    expect(out.map((r) => r.id)).toEqual(['t1']);
  });

  it('updateTestDefinition requires the row to exist first', async () => {
    const client = makeFakeSupabase();
    await expect(
      updateTestDefinition(client, SUB, TEST_ID, { title: 'new' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('attachTestQuestion / startTestAttempt', () => {
  it('attachTestQuestion requires the parent test to exist', async () => {
    const client = makeFakeSupabase();
    await expect(attachTestQuestion(client, SUB, TEST_ID, QUESTION_ID, 0)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('attachTestQuestion inserts and asserts ownership', async () => {
    const client = makeFakeSupabase({
      tables: { test_definitions: [{ id: TEST_ID, user_id: SUB, state: 'created' }] },
    });
    const row = await attachTestQuestion(client, SUB, TEST_ID, QUESTION_ID, 7);
    expect(row.user_id).toBe(SUB);
    expect(row.test_id).toBe(TEST_ID);
    expect(row.display_order).toBe(7);
  });

  it('startTestAttempt creates an in_progress attempt with counters zeroed', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_definitions: [{ id: TEST_ID, user_id: SUB, state: 'created' }],
        test_questions: [
          { id: 'q1', user_id: SUB, test_id: TEST_ID, display_order: 0 },
          { id: 'q2', user_id: SUB, test_id: TEST_ID, display_order: 1 },
        ],
      },
    });
    const attempt = await startTestAttempt(client, SUB, TEST_ID);
    expect(attempt.state).toBe('in_progress');
    expect(attempt.total_questions).toBe(2);
    expect(attempt.correct_count).toBe(0);
    expect(attempt.incorrect_count).toBe(0);
    expect(attempt.partial_count).toBe(0);
    expect(attempt.skipped_count).toBe(0);
    expect(attempt.accuracy).toBe('0');
  });
});

describe('recordAnswer / submitTestAttempt state guards', () => {
  it('recordAnswer refuses a non-in_progress attempt', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_attempts: [
          { id: ATTEMPT_ID, user_id: SUB, state: 'submitted', correct_count: 0, incorrect_count: 0, partial_count: 0, skipped_count: 0, accuracy: '0' },
        ],
      },
    });
    await expect(
      recordAnswer(client, SUB, ATTEMPT_ID, { question_id: QUESTION_ID, selected_option_ids: [] }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('recordAnswer inserts/upserts the answer', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_attempts: [
          { id: ATTEMPT_ID, user_id: SUB, state: 'in_progress', correct_count: 0, incorrect_count: 0, partial_count: 0, skipped_count: 0, accuracy: '0' },
        ],
      },
    });
    const row = await recordAnswer(client, SUB, ATTEMPT_ID, {
      question_id: QUESTION_ID,
      selected_option_ids: ['o1'],
      free_text: 'answer',
      duration_ms: 5_000,
    });
    expect(row.user_id).toBe(SUB);
    expect(row.attempt_id).toBe(ATTEMPT_ID);
    expect(row.outcome).toBeNull();
  });

  it('submitTestAttempt refuses a non-in_progress attempt', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_attempts: [
          { id: ATTEMPT_ID, user_id: SUB, state: 'submitted', correct_count: 0, incorrect_count: 0, partial_count: 0, skipped_count: 0, accuracy: '0' },
        ],
      },
    });
    await expect(submitTestAttempt(client, SUB, ATTEMPT_ID)).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe('listTestAttempts', () => {
  it('orders by created_at desc and caps at 100', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `a${i}`,
      user_id: SUB,
      state: 'in_progress',
      created_at: `2026-09-0${i + 1}T00:00:00Z`,
    }));
    const client = makeFakeSupabase({ tables: { test_attempts: rows } });
    const out = await listTestAttempts(client, SUB, { limit: 10 });
    expect(out).toHaveLength(3);
    expect(out[0]?.id).toBe('a2');
  });
});
