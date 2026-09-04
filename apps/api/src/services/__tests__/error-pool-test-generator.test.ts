/**
 * KRODEX API — ErrorPoolTestGenerator tests (Phase 10).
 *
 * Covers:
 *
 *   - `buildPoolSignature`: dedup + lexical sort, identical
 *     signatures from permuted input
 *   - `findExistingPoolTest`: matches by sorted-id signature
 *     inside `source_payload.error_ids`; ignores foreign tests
 *   - `collectQuestionIdsForErrors`:
 *       * picks `error_entries.question_id` when present
 *       * falls back to `error_question_links` for errors
 *         without a direct question
 *       * dedup + stable sort
 *   - `generateErrorPoolTest`:
 *       * happy path: creates test_definitions + test_questions
 *       * second call with same set returns the same testId
 *         with `isNew: false` (no duplicates)
 *       * third call with reordered ids still returns the
 *         same testId (signature is order-independent)
 *       * third call with extra ids produces a NEW test
 *       * throws NotFoundError when no questions can be
 *         resolved (all errors have no question and no links)
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  buildPoolSignature,
  collectQuestionIdsForErrors,
  findExistingPoolTest,
  generateErrorPoolTest,
} from '../error-pool-test-generator';
import { NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const E1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const E2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const E3 = 'cccccccc-3333-4333-8333-cccccccccccc';
const E4 = 'dddddddd-4444-4444-8444-dddddddddddd';
const E5 = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const Q1 = 'q1111111-1111-4111-8111-111111111111';
const Q2 = 'q2222222-2222-4222-8222-222222222222';
const Q3 = 'q3333333-3333-4333-8333-333333333333';
const Q4 = 'q4444444-4444-4444-8444-444444444444';
const TOPIC = 't0000000-0000-4000-8000-000000000000';

function baseTables(overrides: {
  errors?: Array<Record<string, unknown>>;
  tests?: Array<Record<string, unknown>>;
  testQuestions?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
} = {}) {
  return {
    test_definitions: overrides.tests ?? [],
    test_questions: overrides.testQuestions ?? [],
    error_entries: overrides.errors ?? [],
    error_question_links: overrides.links ?? [],
  };
}

describe('buildPoolSignature', () => {
  it('dedupes the input set', () => {
    expect(buildPoolSignature([E1, E1, E2, E1])).toBe(`${E1}|${E2}`);
  });

  it('sorts the ids lexically (stable order)', () => {
    expect(buildPoolSignature([E3, E1, E2])).toBe(`${E1}|${E2}|${E3}`);
  });

  it('produces the same signature for permuted input', () => {
    expect(buildPoolSignature([E1, E2, E3])).toBe(buildPoolSignature([E3, E1, E2]));
  });

  it('returns an empty string for empty input', () => {
    expect(buildPoolSignature([])).toBe('');
  });
});

describe('findExistingPoolTest', () => {
  it('finds a test whose source_payload.error_ids match the signature', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        tests: [
          {
            id: 't1',
            user_id: SUB,
            title: 'Existing',
            source_kind: 'error_bank',
            source_payload: { error_ids: [E1, E2] },
            intended_count: 2,
            duration_minutes: null,
            state: 'created',
            metadata: {},
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-01T00:00:00Z',
          },
        ],
      }),
      defaultUserId: SUB,
    });
    const sig = buildPoolSignature([E2, E1]);
    const found = await findExistingPoolTest(client, SUB, sig);
    expect(found?.id).toBe('t1');
  });

  it('ignores tests whose error_ids do not match exactly', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        tests: [
          {
            id: 't1',
            user_id: SUB,
            title: 'Different',
            source_kind: 'error_bank',
            source_payload: { error_ids: [E1, E3] },
            intended_count: 2,
            duration_minutes: null,
            state: 'created',
            metadata: {},
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-01T00:00:00Z',
          },
        ],
      }),
      defaultUserId: SUB,
    });
    const sig = buildPoolSignature([E1, E2]);
    const found = await findExistingPoolTest(client, SUB, sig);
    expect(found).toBeNull();
  });

  it('ignores tests that are not error_bank', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        tests: [
          {
            id: 't1',
            user_id: SUB,
            title: 'Syllabus',
            source_kind: 'syllabus',
            source_payload: { error_ids: [E1, E2] },
            intended_count: 2,
            duration_minutes: null,
            state: 'created',
            metadata: {},
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-01T00:00:00Z',
          },
        ],
      }),
      defaultUserId: SUB,
    });
    const found = await findExistingPoolTest(client, SUB, buildPoolSignature([E1, E2]));
    expect(found).toBeNull();
  });
});

describe('collectQuestionIdsForErrors', () => {
  it('returns an empty list for an empty error set', async () => {
    const client = makeFakeSupabase({ tables: baseTables(), defaultUserId: SUB });
    const r = await collectQuestionIdsForErrors(client, SUB, []);
    expect(r.questionIds).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('returns the question_id of each error', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q1 },
          { id: E2, user_id: SUB, question_id: Q2 },
        ],
      }),
      defaultUserId: SUB,
    });
    const r = await collectQuestionIdsForErrors(client, SUB, [E1, E2]);
    expect(r.questionIds).toEqual([Q1, Q2]);
    expect(r.skipped).toEqual([]);
  });

  it('sorts the question ids lexically and dedupes', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q3 },
          { id: E2, user_id: SUB, question_id: Q1 },
          { id: E3, user_id: SUB, question_id: Q2 },
        ],
      }),
      defaultUserId: SUB,
    });
    const r = await collectQuestionIdsForErrors(client, SUB, [E1, E2, E3]);
    expect(r.questionIds).toEqual([Q1, Q2, Q3]);
  });

  it('falls back to error_question_links when question_id is null', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [{ id: E1, user_id: SUB, question_id: null }],
        links: [
          { id: 'l1', error_id: E1, question_id: Q2, user_id: SUB },
          { id: 'l2', error_id: E1, question_id: Q1, user_id: SUB },
        ],
      }),
      defaultUserId: SUB,
    });
    const r = await collectQuestionIdsForErrors(client, SUB, [E1]);
    // Lexically first of {Q1, Q2} is Q1.
    expect(r.questionIds).toEqual([Q1]);
    expect(r.skipped).toEqual([]);
  });

  it('records errors as skipped when no question is available', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q1 },
          { id: E2, user_id: SUB, question_id: null },
        ],
      }),
      defaultUserId: SUB,
    });
    const r = await collectQuestionIdsForErrors(client, SUB, [E1, E2]);
    expect(r.questionIds).toEqual([Q1]);
    expect(r.skipped).toEqual([E2]);
  });
});

describe('generateErrorPoolTest', () => {
  it('creates a new test with the deduped question list', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q1 },
          { id: E2, user_id: SUB, question_id: Q2 },
          { id: E3, user_id: SUB, question_id: Q3 },
        ],
      }),
      defaultUserId: SUB,
    });
    const result = await generateErrorPoolTest(client, SUB, { errorIds: [E1, E2, E3] });
    expect(result.isNew).toBe(true);
    expect(result.questionCount).toBe(3);
    expect(result.attached.map((q) => q.question_id)).toEqual([Q1, Q2, Q3]);

    const defs = (
      client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }
    ).__rows('test_definitions');
    expect(defs).toHaveLength(1);
    const def = defs[0]!;
    expect(def.source_kind).toBe('error_bank');
    expect(def.user_id).toBe(SUB);
    const payload = def.source_payload as { error_ids: string[] };
    expect([...payload.error_ids].sort()).toEqual([E1, E2, E3].sort());
  });

  it('returns isNew=false on a second call with the same ids', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q1 },
          { id: E2, user_id: SUB, question_id: Q2 },
        ],
      }),
      defaultUserId: SUB,
    });
    const first = await generateErrorPoolTest(client, SUB, { errorIds: [E1, E2] });
    const second = await generateErrorPoolTest(client, SUB, { errorIds: [E1, E2] });
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.testId).toBe(first.testId);

    const defs = (
      client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }
    ).__rows('test_definitions');
    expect(defs).toHaveLength(1);
  });

  it('dedupes across order — permuted input returns the same testId', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q1 },
          { id: E2, user_id: SUB, question_id: Q2 },
          { id: E3, user_id: SUB, question_id: Q3 },
        ],
      }),
      defaultUserId: SUB,
    });
    const a = await generateErrorPoolTest(client, SUB, { errorIds: [E1, E2, E3] });
    const b = await generateErrorPoolTest(client, SUB, { errorIds: [E3, E1, E2] });
    expect(b.testId).toBe(a.testId);
    expect(b.isNew).toBe(false);
  });

  it('creates a new test when a new id is added', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q1 },
          { id: E2, user_id: SUB, question_id: Q2 },
          { id: E3, user_id: SUB, question_id: Q3 },
        ],
      }),
      defaultUserId: SUB,
    });
    const a = await generateErrorPoolTest(client, SUB, { errorIds: [E1, E2] });
    const b = await generateErrorPoolTest(client, SUB, { errorIds: [E1, E2, E3] });
    expect(b.isNew).toBe(true);
    expect(b.testId).not.toBe(a.testId);
  });

  it('throws NotFoundError when no questions are available for the pool', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [{ id: E1, user_id: SUB, question_id: null }],
      }),
      defaultUserId: SUB,
    });
    await expect(
      generateErrorPoolTest(client, SUB, { errorIds: [E1] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('honours a custom title and questionsPerError on the intended_count', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [
          { id: E1, user_id: SUB, question_id: Q1 },
          { id: E2, user_id: SUB, question_id: Q2 },
        ],
      }),
      defaultUserId: SUB,
    });
    const result = await generateErrorPoolTest(client, SUB, {
      errorIds: [E1, E2],
      title: 'Custom review',
      questionsPerError: 3,
    });
    expect(result.isNew).toBe(true);
    const defs = (
      client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }
    ).__rows('test_definitions');
    expect(defs[0]?.title).toBe('Custom review');
    expect(defs[0]?.intended_count).toBe(2 * 3);
  });

  it('uses error_question_links when error_entries.question_id is null', async () => {
    const client = makeFakeSupabase({
      tables: baseTables({
        errors: [{ id: E1, user_id: SUB, question_id: null }],
        links: [
          { id: 'l1', error_id: E1, question_id: Q4, user_id: SUB },
        ],
      }),
      defaultUserId: SUB,
    });
    const result = await generateErrorPoolTest(client, SUB, { errorIds: [E1] });
    expect(result.isNew).toBe(true);
    expect(result.attached.map((q) => q.question_id)).toEqual([Q4]);
  });
});
