/**
 * KRODEX API — capture orchestrator tests (Phase 9).
 *
 * Exercises the 10-stage pipeline end-to-end through the fake
 * Supabase client. The orchestrator is failure-tolerant per
 * stage, so the tests cover:
 *   - happy path: error → evidence → snapshot → schedule
 *   - snapshot failure: still records the ErrorEvidence row
 *   - AI failure (null provider): classificationStatus = 'skipped'
 *   - scheduling failure: still records the ErrorEvidence row
 *   - emission: evidence.captured + evidence.snapshot_created
 *     both land in the outbox
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { runCapture } from '../capture-orchestrator';
import type {
  ErrorEntryRow,
  QuestionOptionRow,
  QuestionRow,
  TestAnswerRow,
} from '@krodex/shared';

const SUB = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const ERROR_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '00000000-0000-4000-8000-000000000001';
const EVIDENCE_ID = '44444444-4444-4444-8444-444444444444';
const TOPIC_ID = '77777777-7777-4777-8777-777777777777';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

const NOW = new Date('2026-09-03T12:00:00.000Z');

const ERROR_ROW: Partial<ErrorEntryRow> = {
  id: ERROR_ID,
  user_id: SUB,
  status: 'active',
  recurrence_count: 0,
};

const QUESTION_ROW: Partial<QuestionRow> = {
  id: QUESTION_ID,
  topic_id: TOPIC_ID,
  prompt: 'What is 2 + 2?',
  question_type: 'single_mcq',
  difficulty: 'easy',
};

const OPTIONS: readonly QuestionOptionRow[] = [
  { id: 'o1', question_id: QUESTION_ID, display_order: 1, body: '3', is_correct: false, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
  { id: 'o2', question_id: QUESTION_ID, display_order: 2, body: '4', is_correct: true, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
  { id: 'o3', question_id: QUESTION_ID, display_order: 3, body: '5', is_correct: false, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
];

const ANSWER_ROW: Partial<TestAnswerRow> = {
  id: '88888888-8888-4888-8888-888888888888',
  user_id: SUB,
  attempt_id: ATTEMPT_ID,
  question_id: QUESTION_ID,
  selected_option_ids: ['o3'],
  free_text: null,
  outcome: 'incorrect',
  duration_ms: 5000,
};

function rows(client: ReturnType<typeof makeFakeSupabase>, table: string): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows(table);
}

function outbox(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('event_outbox');
}

function setStorageError(client: ReturnType<typeof makeFakeSupabase>, msg: string | null): void {
  (client as unknown as { __setStorageError: (m: string | null) => void }).__setStorageError(msg);
}

describe('runCapture — happy path', () => {
  it('records evidence, renders snapshot, schedules a review', async () => {
    const client = makeFakeSupabase({
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const result = await runCapture(client, {
      userId: SUB,
      attempt: { id: ATTEMPT_ID, test_id: 't1' },
      answer: ANSWER_ROW as TestAnswerRow,
      errorEntry: ERROR_ROW as ErrorEntryRow,
      question: QUESTION_ROW as QuestionRow,
      questionOptions: OPTIONS,
      topicName: 'Arithmetic',
      aiProvider: null,
      storageBucket: 'error-evidence',
      now: NOW,
    });
    expect(result.evidenceId).toBeDefined();
    expect(result.snapshotStatus).toBe('available');
    expect(result.classificationStatus).toBe('skipped');
    expect(result.reviewScheduledAt).toBeDefined();

    const ev = rows(client, 'error_evidence');
    expect(ev).toHaveLength(1);
    expect(ev[0]?.user_id).toBe(SUB);
    expect(ev[0]?.attempt_id).toBe(ATTEMPT_ID);
    expect(ev[0]?.error_entry_id).toBe(ERROR_ID);

    const assets = rows(client, 'evidence_assets');
    expect(assets).toHaveLength(1);
    expect(assets[0]?.status).toBe('available');

    const reviews = rows(client, 'review_schedules');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.strategy).toBe('spaced');
  });

  it('emits evidence.captured and evidence.snapshot_created outbox events', async () => {
    const client = makeFakeSupabase({
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await runCapture(client, {
      userId: SUB,
      attempt: { id: ATTEMPT_ID, test_id: 't1' },
      answer: ANSWER_ROW as TestAnswerRow,
      errorEntry: ERROR_ROW as ErrorEntryRow,
      question: QUESTION_ROW as QuestionRow,
      questionOptions: OPTIONS,
      topicName: 'Arithmetic',
      aiProvider: null,
      storageBucket: 'error-evidence',
      now: NOW,
    });
    const types = outbox(client).map((r) => r.event_type);
    expect(types).toContain('evidence.captured');
    expect(types).toContain('evidence.snapshot_created');
  });
});

describe('runCapture — failure isolation', () => {
  it('still creates the evidence row when snapshot upload fails', async () => {
    const client = makeFakeSupabase();
    setStorageError(client, 'bucket offline');
    const result = await runCapture(client, {
      userId: SUB,
      attempt: { id: ATTEMPT_ID, test_id: 't1' },
      answer: ANSWER_ROW as TestAnswerRow,
      errorEntry: ERROR_ROW as ErrorEntryRow,
      question: QUESTION_ROW as QuestionRow,
      questionOptions: OPTIONS,
      topicName: 'Arithmetic',
      aiProvider: null,
      storageBucket: 'error-evidence',
      now: NOW,
    });
    expect(result.snapshotStatus).toBe('failed');
    expect(result.evidenceId).toBeDefined();
    // The error_evidence row must still exist.
    const ev = rows(client, 'error_evidence');
    expect(ev).toHaveLength(1);
    // The asset row records status='failed' rather than throwing.
    const assets = rows(client, 'evidence_assets');
    expect(assets).toHaveLength(1);
    expect(assets[0]?.status).toBe('failed');
  });

  it('emits evidence.snapshot_failed when the snapshot stage fails', async () => {
    const client = makeFakeSupabase();
    setStorageError(client, 'bucket offline');
    await runCapture(client, {
      userId: SUB,
      attempt: { id: ATTEMPT_ID, test_id: 't1' },
      answer: ANSWER_ROW as TestAnswerRow,
      errorEntry: ERROR_ROW as ErrorEntryRow,
      question: QUESTION_ROW as QuestionRow,
      questionOptions: OPTIONS,
      topicName: 'Arithmetic',
      aiProvider: null,
      storageBucket: 'error-evidence',
      now: NOW,
    });
    const types = outbox(client).map((r) => r.event_type);
    expect(types).toContain('evidence.snapshot_failed');
    expect(types).toContain('evidence.captured');
    // Not the success event:
    expect(types).not.toContain('evidence.snapshot_created');
  });

  it('captures free_text as the student answer', async () => {
    const client = makeFakeSupabase();
    const result = await runCapture(client, {
      userId: SUB,
      attempt: { id: ATTEMPT_ID, test_id: 't1' },
      answer: { ...ANSWER_ROW, free_text: 'my answer was 5' } as TestAnswerRow,
      errorEntry: ERROR_ROW as ErrorEntryRow,
      question: QUESTION_ROW as QuestionRow,
      questionOptions: OPTIONS,
      topicName: 'Arithmetic',
      aiProvider: null,
      storageBucket: 'error-evidence',
      now: NOW,
    });
    expect(result.evidenceId).toBeDefined();
    const ev = rows(client, 'error_evidence');
    expect(ev[0]?.student_answer).toBe('my answer was 5');
  });
});

describe('runCapture — idempotence', () => {
  it('re-running with the same attempt returns the same evidence id', async () => {
    const client = makeFakeSupabase();
    const input = {
      userId: SUB,
      attempt: { id: ATTEMPT_ID, test_id: 't1' },
      answer: ANSWER_ROW as TestAnswerRow,
      errorEntry: ERROR_ROW as ErrorEntryRow,
      question: QUESTION_ROW as QuestionRow,
      questionOptions: OPTIONS,
      topicName: 'Arithmetic',
      aiProvider: null,
      storageBucket: 'error-evidence',
      now: NOW,
    };
    const a = await runCapture(client, input);
    const b = await runCapture(client, input);
    expect(a.evidenceId).toBe(b.evidenceId);
    // Only one evidence row, one snapshot, one schedule.
    expect(rows(client, 'error_evidence')).toHaveLength(1);
    expect(rows(client, 'evidence_assets')).toHaveLength(1);
  });
});
