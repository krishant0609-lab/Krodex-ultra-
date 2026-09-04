/**
 * KRODEX API — attempt-capture bridge tests (Phase 9).
 *
 * Exercises the connection between the submit RPC's
 * error_entries upsert and the per-wrong-answer capture
 * pipeline. The bridge is responsible for:
 *   - reading the just-graded attempt's error_entries
 *   - reading the matching test_answers (outcome=incorrect)
 *   - loading question / options / topic metadata
 *   - fanning out to runCapture() per wrong answer
 *   - returning per-question failures when lookup fails
 *
 * Failure isolation is the orchestrator's responsibility; the
 * bridge is a coordinator. The tests here cover the read-side
 * paths and the fan-out shape.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { runCaptureForAttempt } from '../attempt-capture-bridge';

const SUB = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const TEST_ID = '99999999-9999-4999-8999-999999999999';
const ERROR_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '00000000-0000-4000-8000-000000000001';
const TOPIC_ID = '77777777-7777-4777-8777-777777777777';
const ANSWER_ID = '88888888-8888-4888-8888-888888888888';

const NOW = new Date('2026-09-03T12:00:00.000Z');

function rows(client: ReturnType<typeof makeFakeSupabase>, table: string): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows(table);
}

function preloaded(seed: {
  errorEntries?: Array<Record<string, unknown>>;
  testAnswers?: Array<Record<string, unknown>>;
  questions?: Array<Record<string, unknown>>;
  options?: Array<Record<string, unknown>>;
  topics?: Array<Record<string, unknown>>;
  testAttempts?: Array<Record<string, unknown>>;
}): ReturnType<typeof makeFakeSupabase> {
  return makeFakeSupabase({
    tables: {
      error_entries: seed.errorEntries ?? [],
      test_answers: seed.testAnswers ?? [],
      questions: seed.questions ?? [],
      question_options: seed.options ?? [],
      topics: seed.topics ?? [],
      test_attempts: seed.testAttempts ?? [],
      // Capture pipeline writes:
      error_evidence: [],
      evidence_assets: [],
      review_schedules: [],
      event_outbox: [],
    },
  });
}

describe('runCaptureForAttempt — fan-out', () => {
  it('runs the capture pipeline for each incorrect answer in the attempt', async () => {
    const client = preloaded({
      testAttempts: [
        { id: ATTEMPT_ID, user_id: SUB, test_id: TEST_ID, status: 'submitted' },
      ],
      errorEntries: [
        {
          id: ERROR_ID,
          user_id: SUB,
          source_attempt_id: ATTEMPT_ID,
          question_id: QUESTION_ID,
          status: 'active',
          recurrence_count: 0,
        },
      ],
      testAnswers: [
        {
          id: ANSWER_ID,
          user_id: SUB,
          attempt_id: ATTEMPT_ID,
          question_id: QUESTION_ID,
          selected_option_ids: ['o3'],
          free_text: null,
          outcome: 'incorrect',
          duration_ms: 5000,
        },
      ],
      questions: [
        {
          id: QUESTION_ID,
          topic_id: TOPIC_ID,
          prompt: 'What is 2 + 2?',
          question_type: 'mcq',
          difficulty: 'easy',
        },
      ],
      options: [
        { id: 'o1', question_id: QUESTION_ID, display_order: 1, body: '3', is_correct: false, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
        { id: 'o2', question_id: QUESTION_ID, display_order: 2, body: '4', is_correct: true, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
        { id: 'o3', question_id: QUESTION_ID, display_order: 3, body: '5', is_correct: false, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
      ],
      topics: [
        { id: TOPIC_ID, name: 'Arithmetic' },
      ],
    });

    const result = await runCaptureForAttempt(client, {
      userId: SUB,
      attemptId: ATTEMPT_ID,
      storageBucket: 'error-evidence',
      aiProvider: null,
      now: NOW,
    });

    expect(result.incorrectCount).toBe(1);
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0]?.snapshotStatus).toBe('available');
    expect(result.failures).toHaveLength(0);

    // The pipeline wrote the evidence row and the asset.
    expect(rows(client, 'error_evidence')).toHaveLength(1);
    expect(rows(client, 'evidence_assets')).toHaveLength(1);
    // The bridge carries the real test_id (not the error_entry id)
    // into the orchestrator; we don't assert on the
    // outbox payload shape here, but we do assert that
    // the attempt.submitted / evidence.captured event lands
    // in the outbox, which means the runCapture path executed.
    const outbox = rows(client, 'event_outbox');
    const types = outbox.map((r) => r.event_type);
    expect(types).toContain('evidence.captured');
  });

  it('returns zero captures when the attempt has no error entries', async () => {
    const client = preloaded({
      testAttempts: [
        { id: ATTEMPT_ID, user_id: SUB, test_id: TEST_ID, status: 'submitted' },
      ],
      errorEntries: [],
    });
    const result = await runCaptureForAttempt(client, {
      userId: SUB,
      attemptId: ATTEMPT_ID,
      storageBucket: 'error-evidence',
      aiProvider: null,
      now: NOW,
    });
    expect(result.captures).toHaveLength(0);
    expect(result.incorrectCount).toBe(0);
    expect(result.failures).toHaveLength(0);
  });
});

describe('runCaptureForAttempt — read-side failure isolation', () => {
  it('skips error entries whose test_answers row is missing (records a failure)', async () => {
    const client = preloaded({
      testAttempts: [
        { id: ATTEMPT_ID, user_id: SUB, test_id: TEST_ID, status: 'submitted' },
      ],
      errorEntries: [
        {
          id: ERROR_ID,
          user_id: SUB,
          source_attempt_id: ATTEMPT_ID,
          question_id: QUESTION_ID,
          status: 'active',
          recurrence_count: 0,
        },
      ],
      testAnswers: [], // mismatched: error_entry points at a question with no test_answer
    });
    const result = await runCaptureForAttempt(client, {
      userId: SUB,
      attemptId: ATTEMPT_ID,
      storageBucket: 'error-evidence',
      aiProvider: null,
      now: NOW,
    });
    expect(result.incorrectCount).toBe(1);
    expect(result.captures).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.questionId).toBe(QUESTION_ID);
    expect(result.failures[0]?.error).toBe('test_answer missing');
  });
});
