/**
 * KRODEX API — Phase 8 evidence assembler tests.
 *
 * The assembler is the only place that crosses the boundary
 * from Supabase rows to AI evidence. These tests pin three
 * contracts:
 *   1. The error is owned-checked (other students' data is
 *      never returned).
 *   2. The linked question, topic, and recent resolved errors
 *      are all scoped to the same `userId`.
 *   3. The prompt renderer produces a stable, deterministic
 *      block — no timestamps, no nondeterministic ordering,
 *      200-char excerpts.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { ForbiddenError } from '../../errors';
import {
  buildAssistantEvidence,
  buildClassificationEvidence,
  renderClassificationEvidenceForPrompt,
} from '../evidence';
import type {
  ErrorEntryRow,
  QuestionRow,
  TopicRow,
} from '@krodex/shared';

/** The fake supabase accepts any indexable record. */
type Row = Record<string, unknown>;

const USER = 'user-A';
const OTHER = 'user-B';

function err(overrides: Partial<ErrorEntryRow> = {}): Row {
  const row: ErrorEntryRow = {
    id: 'err-1',
    user_id: USER,
    question_id: 'q-1',
    status: 'active',
    mistake_type: null,
    remark: 'I forgot to carry the 1.',
    source_attempt_id: null,
    first_seen_at: '2025-01-01T00:00:00.000Z',
    last_seen_at: '2025-01-02T00:00:00.000Z',
    resolved_at: null,
    recurrence_count: 0,
    metadata: {},
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
  return row as unknown as Row;
}

function q(overrides: Partial<QuestionRow> = {}): Row {
  const row: QuestionRow = {
    id: 'q-1',
    subject_id: 'subj-1',
    topic_id: 'topic-1',
    sub_topic_id: null,
    question_type: 'single_mcq',
    difficulty: 'medium',
    prompt: 'A long question prompt. '.repeat(50).trim(),
    explanation: null,
    source: null,
    source_year: null,
    marks_correct: '4',
    marks_incorrect: '-1',
    metadata: {},
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
  return row as unknown as Row;
}

function topic(overrides: Partial<TopicRow> = {}): Row {
  const row: TopicRow = {
    id: 'topic-1',
    subject_id: 'subj-1',
    parent_topic_id: null,
    code: 'T1',
    name: 'Arithmetic',
    display_order: 1,
    syllabus_scope: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
  return row as unknown as Row;
}

describe('buildClassificationEvidence', () => {
  it('returns the error + linked question + topic + capturedAt', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [err()],
        questions: [q()],
        topics: [topic()],
      },
      defaultUserId: USER,
    });
    const fixed = new Date('2025-05-01T00:00:00.000Z');
    const ev = await buildClassificationEvidence(client, USER, 'err-1', () => fixed);
    expect(ev.error.id).toBe('err-1');
    expect(ev.question?.id).toBe('q-1');
    expect(ev.topic?.id).toBe('topic-1');
    expect(ev.recentByTopic).toEqual([]);
    expect(ev.capturedAt).toBe('2025-05-01T00:00:00.000Z');
  });

  it('throws ForbiddenError when the error is owned by a different student', async () => {
    const client = makeFakeSupabase({
      tables: { error_entries: [err({ user_id: OTHER })] },
    });
    await expect(buildClassificationEvidence(client, USER, 'err-1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('returns null question and topic when the error is unlinked', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [err({ question_id: null })],
        questions: [],
        topics: [],
      },
    });
    const ev = await buildClassificationEvidence(client, USER, 'err-1');
    expect(ev.question).toBeNull();
    expect(ev.topic).toBeNull();
  });

  it('filters recentByTopic to errors owned by the caller and ordered by resolved_at desc', async () => {
    const resolvedA = err({
      id: 'err-A',
      status: 'resolved',
      resolved_at: '2025-02-01T00:00:00.000Z',
      question_id: 'q-1',
    });
    const resolvedB = err({
      id: 'err-B',
      status: 'resolved',
      resolved_at: '2025-03-01T00:00:00.000Z',
      question_id: 'q-1',
    });
    const openC = err({
      id: 'err-C',
      status: 'active',
      resolved_at: null,
      question_id: 'q-1',
    });
    const otherStudent = err({
      id: 'err-X',
      user_id: OTHER,
      status: 'resolved',
      resolved_at: '2025-04-01T00:00:00.000Z',
      question_id: 'q-1',
    });
    const client = makeFakeSupabase({
      tables: {
        error_entries: [err(), resolvedA, resolvedB, openC, otherStudent],
        questions: [q()],
        topics: [topic()],
      },
    });
    const ev = await buildClassificationEvidence(client, USER, 'err-1');
    expect(ev.recentByTopic.map((r) => r.id)).toEqual(['err-B', 'err-A']);
  });

  it('throws when the error does not exist', async () => {
    const client = makeFakeSupabase({ tables: { error_entries: [] } });
    await expect(buildClassificationEvidence(client, USER, 'missing')).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('buildAssistantEvidence', () => {
  it('returns the bundle of errors, reviews, and topics for the caller', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [err({ id: 'err-2', user_id: USER })],
        review_schedules: [
          {
            id: 'rev-1',
            error_id: 'err-1',
            user_id: USER,
            state: 'due',
            outcome: null,
          },
        ],
        topics: [topic()],
      },
    });
    const bundle = await buildAssistantEvidence(client, USER);
    expect(bundle.errors.map((e) => e.id)).toEqual(['err-2']);
    expect(bundle.reviews).toEqual([
      { id: 'rev-1', error_id: 'err-1', user_id: USER, state: 'due', outcome: null },
    ]);
    expect(bundle.topics.map((t) => t.id)).toEqual(['topic-1']);
    expect(typeof bundle.capturedAt).toBe('string');
  });

  it('respects the per-table limit options', async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      err({ id: `e-${i}`, user_id: USER }),
    );
    const client = makeFakeSupabase({
      tables: { error_entries: many },
    });
    const bundle = await buildAssistantEvidence(client, USER, { errorLimit: 2 });
    expect(bundle.errors).toHaveLength(2);
  });
});

describe('renderClassificationEvidenceForPrompt', () => {
  it('includes the error id, status, and a 200-char remark excerpt', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [err()],
        questions: [q()],
        topics: [topic()],
      },
    });
    const ev = await buildClassificationEvidence(client, USER, 'err-1');
    const text = renderClassificationEvidenceForPrompt(ev);
    expect(text).toContain('# Error err-1');
    expect(text).toContain('- status: active');
    expect(text).toContain('- current mistake_type: null');
    expect(text).toContain('# Linked question q-1');
    expect(text).toContain('- topic: Arithmetic');
  });

  it('renders the "no linked question" branch when the error is unlinked', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [err({ question_id: null })],
        questions: [],
        topics: [],
      },
    });
    const ev = await buildClassificationEvidence(client, USER, 'err-1');
    const text = renderClassificationEvidenceForPrompt(ev);
    expect(text).toContain('# No linked question');
  });

  it('truncates excerpts to 200 characters and appends …', () => {
    const longRemark = 'A'.repeat(500);
    const ev = {
      error: err({ remark: longRemark }) as unknown as ErrorEntryRow,
      question: null,
      topic: null,
      recentByTopic: [],
      capturedAt: '2025-01-01T00:00:00.000Z',
    };
    const text = renderClassificationEvidenceForPrompt(ev);
    // 200 As + …
    expect(text).toContain('A'.repeat(200) + '…');
    // The full 500-As string must NOT appear in the prompt.
    expect(text).not.toContain('A'.repeat(201));
  });
});
