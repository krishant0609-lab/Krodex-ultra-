/**
 * KRODEX API — error evidence service tests (Phase 9).
 *
 * Covers:
 *   - createErrorEvidence: success path emits evidence.captured
 *   - createErrorEvidence: idempotent on attempt_id (returns existing)
 *   - getErrorEvidence: ownership gate
 *   - listEvidenceForError: newest first, filtered by error
 *   - linkEvidenceToError: idempotent, sets error_entry_id
 *   - setAiClassification: pending → suggested
 *   - setStudentClassification: matches AI → confirmed, else → student_override
 *   - attachSnapshotRef: stores internal ref, NOT a public URL
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { ForbiddenError, NotFoundError } from '../../errors';
import {
  attachSnapshotRef,
  createErrorEvidence,
  getErrorEvidence,
  linkEvidenceToError,
  listEvidenceForError,
  setAiClassification,
  setStudentClassification,
  updateErrorEvidence,
} from '../error-evidence-service';

const SUB = '11111111-1111-4111-8111-111111111111';
const EVIDENCE = '44444444-4444-4444-8444-444444444444';
const ATTEMPT = '55555555-5555-4555-8555-555555555555';
const ERROR_ID = '22222222-2222-4222-8222-222222222222';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function outboxRows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('event_outbox');
}

function evidenceRows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('error_evidence');
}

describe('createErrorEvidence', () => {
  it('inserts with documented defaults and emits evidence.captured', async () => {
    const client = makeFakeSupabase({
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const row = await createErrorEvidence(client, SUB, {
      attempt_id: ATTEMPT,
      student_answer: '5',
      expected_answer: '4',
    });
    expect(row.user_id).toBe(SUB);
    expect(row.attempt_id).toBe(ATTEMPT);
    expect(row.classification_status).toBe('pending');
    expect(row.classification_source).toBe('ai');
    expect(row.student_answer).toBe('5');
    expect(row.expected_answer).toBe('4');
    expect(row.question_snapshot_url).toBeNull();
    const ob = outboxRows(client).find((r) => r.event_type === 'evidence.captured');
    expect(ob).toBeDefined();
    expect(evidenceRows(client)).toHaveLength(1);
  });

  it('records source_ids inside metadata', async () => {
    const client = makeFakeSupabase();
    const row = await createErrorEvidence(client, SUB, {
      attempt_id: ATTEMPT,
      source_ids: ['q-1', 'q-2'],
    });
    const meta = row.metadata as { source_ids: string[] };
    expect(meta.source_ids).toEqual(['q-1', 'q-2']);
  });

  it('is idempotent on attempt_id: returns existing without re-emitting', async () => {
    const client = makeFakeSupabase({
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const first = await createErrorEvidence(client, SUB, {
      attempt_id: ATTEMPT,
      student_answer: '5',
      expected_answer: '4',
    });
    const second = await createErrorEvidence(client, SUB, {
      attempt_id: ATTEMPT,
      student_answer: '6',  // different — should be ignored
      expected_answer: '4',
    });
    expect(second.id).toBe(first.id);
    // Only one outbox row should exist
    const ev = outboxRows(client).filter((r) => r.event_type === 'evidence.captured');
    expect(ev).toHaveLength(1);
  });
});

describe('getErrorEvidence', () => {
  it('returns the row on hit', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          { id: EVIDENCE, user_id: SUB, classification_status: 'pending' },
        ],
      },
    });
    const row = await getErrorEvidence(client, SUB, EVIDENCE);
    expect(row.id).toBe(EVIDENCE);
    expect(row.classification_status).toBe('pending');
  });

  it('throws NotFoundError on miss', async () => {
    const client = makeFakeSupabase();
    await expect(getErrorEvidence(client, SUB, EVIDENCE)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError on cross-tenant', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [{ id: EVIDENCE, user_id: 'other', classification_status: 'pending' }],
      },
    });
    await expect(getErrorEvidence(client, SUB, EVIDENCE)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('listEvidenceForError', () => {
  it('returns newest first, filtered by error_entry_id', async () => {
    const t1 = '2026-09-01T10:00:00Z';
    const t2 = '2026-09-01T11:00:00Z';
    const t3 = '2026-09-01T12:00:00Z';
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          { id: 'e1', user_id: SUB, error_entry_id: ERROR_ID, classification_status: 'pending', created_at: t1 },
          { id: 'e2', user_id: SUB, error_entry_id: ERROR_ID, classification_status: 'suggested', created_at: t2 },
          { id: 'e3', user_id: SUB, error_entry_id: 'other-error', classification_status: 'pending', created_at: t3 },
        ],
      },
    });
    const rows = await listEvidenceForError(client, SUB, ERROR_ID);
    expect(rows.map((r) => r.id)).toEqual(['e2', 'e1']);
  });
});

describe('linkEvidenceToError', () => {
  it('sets the error_entry_id on first link', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          { id: EVIDENCE, user_id: SUB, error_entry_id: null, classification_status: 'pending' },
        ],
      },
    });
    const row = await linkEvidenceToError(client, SUB, EVIDENCE, ERROR_ID);
    expect(row.error_entry_id).toBe(ERROR_ID);
  });

  it('is idempotent: re-linking the same id is a no-op', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          { id: EVIDENCE, user_id: SUB, error_entry_id: ERROR_ID, classification_status: 'pending' },
        ],
      },
    });
    const row = await linkEvidenceToError(client, SUB, EVIDENCE, ERROR_ID);
    expect(row.error_entry_id).toBe(ERROR_ID);
  });
});

describe('updateErrorEvidence', () => {
  it('updates only the patchable columns', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          {
            id: EVIDENCE,
            user_id: SUB,
            student_answer: '5',
            expected_answer: '4',
            classification_status: 'pending',
          },
        ],
      },
    });
    const row = await updateErrorEvidence(client, SUB, EVIDENCE, {
      classification_status: 'suggested',
      classification_category: 'calculation',
    });
    expect(row.classification_status).toBe('suggested');
    expect(row.classification_category).toBe('calculation');
    // student_answer / expected_answer are NOT in the patchable surface
    expect(row.student_answer).toBe('5');
    expect(row.expected_answer).toBe('4');
  });
});

describe('attachSnapshotRef', () => {
  it('stores an internal ref, not a public URL', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          { id: EVIDENCE, user_id: SUB, classification_status: 'pending' },
        ],
      },
    });
    const row = await attachSnapshotRef(
      client,
      SUB,
      EVIDENCE,
      'error-evidence/00000000-0000-4000-8000-000000000001/44444444-4444-4444-8444-444444444444/asset-1.png',
    );
    expect(row.question_snapshot_url).toMatch(/^error-evidence\//);
  });
});

describe('setAiClassification', () => {
  it('transitions pending → suggested', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          { id: EVIDENCE, user_id: SUB, classification_status: 'pending' },
        ],
      },
    });
    const row = await setAiClassification(client, SUB, EVIDENCE, 'concept');
    expect(row.classification_status).toBe('suggested');
    expect(row.classification_category).toBe('concept');
    expect(row.classification_source).toBe('ai');
  });
});

describe('setStudentClassification', () => {
  it('matches AI suggestion → status=confirmed', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          {
            id: EVIDENCE,
            user_id: SUB,
            classification_status: 'suggested',
            classification_category: 'calculation',
            classification_source: 'ai',
          },
        ],
      },
    });
    const row = await setStudentClassification(client, SUB, EVIDENCE, 'calculation');
    expect(row.classification_status).toBe('confirmed');
    expect(row.classification_source).toBe('student');
  });

  it('overrides AI suggestion → status=student_override', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          {
            id: EVIDENCE,
            user_id: SUB,
            classification_status: 'suggested',
            classification_category: 'calculation',
            classification_source: 'ai',
          },
        ],
      },
    });
    const row = await setStudentClassification(client, SUB, EVIDENCE, 'concept');
    expect(row.classification_status).toBe('student_override');
    expect(row.classification_category).toBe('concept');
  });

  it('first-time student classification (no AI suggestion) → student_override', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_evidence: [
          { id: EVIDENCE, user_id: SUB, classification_status: 'pending' },
        ],
      },
    });
    const row = await setStudentClassification(client, SUB, EVIDENCE, 'concept');
    expect(row.classification_status).toBe('student_override');
  });
});
