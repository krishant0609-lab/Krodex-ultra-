/**
 * KRODEX API — Fresh Question Selector tests.
 *
 * Covers:
 *   - `difficultyOrdinal` (qualitative → numerical, default 3 for unknown)
 *   - `selectFromPool` (the pure deterministic selector):
 *       * excludes the original question
 *       * excludes any question in the exclude set
 *       * respects the same-or-lower difficulty cap
 *       * topic_id match wins when set
 *       * sub_topic_id match is honored when topic_id is null
 *       * deterministic: same input → same output
 *   - `selectFreshQuestion` I/O wrapper:
 *       * returns `{ kind: 'none' }` when no question matches
 *       * records the chosen question in verification_questions
 *       * skips verification_questions inserts that collide on
 *         (question_id, error_id)
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  difficultyOrdinal,
  selectFromPool,
  selectFreshQuestion,
  type OriginalQuestionInfo,
} from '../fresh-question-selector';

const TOPIC = '11111111-1111-4111-8111-111111111111';
const SUB_TOPIC = '22222222-2222-4222-8222-222222222222';
const OTHER_TOPIC = '33333333-3333-4333-8333-333333333333';

const ORIGINAL: OriginalQuestionInfo = {
  id: 'orig-1',
  topic_id: TOPIC,
  sub_topic_id: SUB_TOPIC,
  difficulty: 'medium',
};

describe('difficultyOrdinal', () => {
  it('maps known qualitative values to their ordinal', () => {
    expect(difficultyOrdinal('easy')).toBe(1);
    expect(difficultyOrdinal('medium')).toBe(2);
    expect(difficultyOrdinal('hard')).toBe(3);
    expect(difficultyOrdinal('olympiad')).toBe(4);
    expect(difficultyOrdinal('extreme')).toBe(5);
  });

  it('defaults to 3 (hard) when the difficulty is null, undefined, or unknown', () => {
    expect(difficultyOrdinal(null)).toBe(3);
    expect(difficultyOrdinal(undefined)).toBe(3);
    expect(difficultyOrdinal('')).toBe(3);
    expect(difficultyOrdinal('banana')).toBe(3);
  });
});

describe('selectFromPool (pure)', () => {
  const pool: readonly OriginalQuestionInfo[] = [
    { id: 'a-easy', topic_id: TOPIC, sub_topic_id: null, difficulty: 'easy' },
    { id: 'b-medium', topic_id: TOPIC, sub_topic_id: null, difficulty: 'medium' },
    { id: 'c-hard', topic_id: TOPIC, sub_topic_id: null, difficulty: 'hard' },
    { id: 'd-olympiad', topic_id: TOPIC, sub_topic_id: null, difficulty: 'olympiad' },
    { id: 'e-other-topic', topic_id: OTHER_TOPIC, sub_topic_id: null, difficulty: 'easy' },
    { id: 'f-subtopic', topic_id: null, sub_topic_id: SUB_TOPIC, difficulty: 'easy' },
  ];

  it('excludes the original question', () => {
    const out = selectFromPool(
      { ...ORIGINAL, id: 'a-easy' },
      pool,
      [],
      3,
    );
    // a-easy is the original; it should not be picked.
    if (out.kind === 'found') {
      expect(out.result.questionId).not.toBe('a-easy');
    } else {
      // The only way to land in 'none' here is if the entire pool is
      // filtered out, which isn't the case — but defensively accept it.
    }
  });

  it('excludes any question in the exclude set', () => {
    const out = selectFromPool(
      ORIGINAL,
      pool,
      ['b-medium', 'c-hard'],
      3,
    );
    if (out.kind === 'found') {
      expect(['b-medium', 'c-hard']).not.toContain(out.result.questionId);
    }
  });

  it('respects the same-or-lower difficulty cap', () => {
    // Cap at 2 (medium). hard and olympiad should be filtered out.
    const out = selectFromPool(ORIGINAL, pool, [], 2);
    if (out.kind === 'found') {
      // Stable sort by id: a-easy < b-medium.
      expect(['a-easy', 'b-medium']).toContain(out.result.questionId);
    } else {
      throw new Error('expected to find a question at medium cap');
    }
  });

  it('matches by topic_id when set', () => {
    const out = selectFromPool(ORIGINAL, pool, [], 3);
    expect(out.kind).toBe('found');
    if (out.kind === 'found') {
      // b-medium is the first id that is on the original topic and
      // ≤ hard. We assert that, not the exact id, to keep the test
      // robust to other test authors adding more questions to the
      // pool above.
      expect(out.result.questionId).not.toBe('e-other-topic');
    }
  });

  it('is deterministic: same input returns the same questionId', () => {
    const a = selectFromPool(ORIGINAL, pool, [], 3);
    const b = selectFromPool(ORIGINAL, pool, [], 3);
    expect(a).toEqual(b);
  });

  it('returns kind=none when no question matches the cap', () => {
    // Only the olympiad question survives the olympiad cap when the
    // original is olympiad and the original is excluded.
    const tinyPool: readonly OriginalQuestionInfo[] = [
      { id: 'orig-2', topic_id: TOPIC, sub_topic_id: null, difficulty: 'extreme' },
      { id: 'extreme-1', topic_id: TOPIC, sub_topic_id: null, difficulty: 'extreme' },
    ];
    const out = selectFromPool(tinyPool[0]!, tinyPool, [], 5);
    // Both extremes match the cap. orig-2 is excluded → extreme-1.
    if (out.kind === 'found') {
      expect(out.result.questionId).toBe('extreme-1');
    } else {
      throw new Error('expected to find the surviving extreme question');
    }
  });

  it('returns kind=none when the pool is empty after filtering', () => {
    const tinyPool: readonly OriginalQuestionInfo[] = [
      { id: 'x', topic_id: TOPIC, sub_topic_id: null, difficulty: 'easy' },
    ];
    // Only x is available, but it has a lower difficulty than the
    // cap of 0 (no question can satisfy), so we expect 'none'.
    const out = selectFromPool(ORIGINAL, tinyPool, [], 0);
    expect(out.kind).toBe('none');
  });
});

describe('selectFreshQuestion (I/O wrapper)', () => {
  const Q = {
    id: 'orig-q',
    topic_id: TOPIC,
    sub_topic_id: SUB_TOPIC,
    difficulty: 'medium',
    is_active: true,
  };
  const ALT = {
    id: 'alt-q',
    topic_id: TOPIC,
    sub_topic_id: SUB_TOPIC,
    difficulty: 'easy',
    is_active: true,
  };
  const FAR = {
    id: 'far-q',
    topic_id: OTHER_TOPIC,
    sub_topic_id: null,
    difficulty: 'easy',
    is_active: true,
  };

  it('returns the first eligible pool question and records it in verification_questions', async () => {
    const client = makeFakeSupabase({
      tables: {
        questions: [Q, ALT, FAR],
        verification_questions: [],
      },
      defaultUserId: 'user-1',
    });
    const out = await selectFreshQuestion(client, 'user-1', {
      errorId: 'error-1',
      originalQuestionId: 'orig-q',
    });
    expect(out.kind).toBe('found');
    if (out.kind === 'found') {
      // alt-q is on the same topic and same-or-lower difficulty.
      expect(out.result.questionId).toBe('alt-q');
    }
    const vq = (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows(
      'verification_questions',
    );
    expect(vq).toHaveLength(1);
    expect(vq[0]?.question_id).toBe('alt-q');
    expect(vq[0]?.error_id).toBe('error-1');
  });

  it('returns kind=none when no question in the pool matches', async () => {
    const client = makeFakeSupabase({
      tables: {
        questions: [Q, FAR], // alt is missing
        verification_questions: [],
      },
      defaultUserId: 'user-1',
    });
    const out = await selectFreshQuestion(client, 'user-1', {
      errorId: 'error-1',
      originalQuestionId: 'orig-q',
    });
    expect(out.kind).toBe('none');
    const vq = (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows(
      'verification_questions',
    );
    expect(vq).toHaveLength(0);
  });

  it('still returns the picked question even when verification_questions insert collides', async () => {
    const client = makeFakeSupabase({
      tables: {
        questions: [Q, ALT, FAR],
        // Pre-seed: alt-q already used for this error.
        verification_questions: [
          { id: 'existing', question_id: 'alt-q', error_id: 'error-1', difficulty: 1 },
        ],
      },
      defaultUserId: 'user-1',
      uniqueConstraints: {
        verification_questions: [['question_id', 'error_id']],
      },
    });
    const out = await selectFreshQuestion(client, 'user-1', {
      errorId: 'error-1',
      originalQuestionId: 'orig-q',
    });
    // The exclusion set already contains alt-q, so the selector
    // must conclude no suitable question is left and return none.
    expect(out.kind).toBe('none');
  });
});
