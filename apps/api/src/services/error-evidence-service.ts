/**
 * KRODEX API — error evidence service (Phase 9).
 *
 * Owns the per-attempt evidence record. Per TRD §9, the
 * `error_evidence` row is created whenever a wrong answer is
 * submitted; snapshot, classification, and review scheduling are
 * non-blocking follow-ups.
 *
 * Invariants (per PIP §370–382):
 *   - create() must succeed even when the snapshot or classification
 *     is unavailable. The downstream stages run inside CaptureOrchestrator
 *     and write to the same row by id.
 *   - get() and list() gate on `user_id` via assertOwned.
 *   - update() only mutates the columns that downstream stages
 *     are allowed to set: `classification_status`,
 *     `classification_category`, `classification_source`,
 *     `question_snapshot_url`, `metadata`. The student-facing
 *     `student_answer` / `expected_answer` are set on create
 *     and never re-edited.
 *
 * The 'evidence.captured' event is emitted exactly once, on the
 * first create() for a given attempt. Re-inserts for the same
 * attempt are blocked by the unique index on `attempt_id`; if a
 * caller tries to create a duplicate, the function returns the
 * existing row without emitting another event.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ClassificationStatus,
  ErrorEvidenceInsert,
  ErrorEvidenceRow,
  ErrorEvidenceUpdate,
  Json,
  MistakeType,
} from '@krodex/shared';
import { assertOwned } from '../auth/ownership';
import { serviceEmit } from '../events/service-emitter';
import { NotFoundError } from '../errors';
import { asRow, asRows } from './_row';

export interface CreateErrorEvidenceInput {
  attempt_id?: string | null;
  error_entry_id?: string | null;
  student_answer?: string | null;
  expected_answer?: string | null;
  /** Per-snapshot DTO content already on the renderer. Optional at this layer. */
  source_ids?: readonly string[];
  /** Free-form bag, surfaced to the in-app history. */
  metadata?: Record<string, unknown>;
}

/**
 * Idempotent create: if a row already exists for this attempt, it
 * is returned and the event is NOT re-emitted. The unique index on
 * `error_evidence.attempt_id` makes the underlying insert safe to
 * retry; the service surfaces the existing row instead of throwing
 * on the unique-violation error.
 */
export async function createErrorEvidence(
  client: SupabaseClient,
  userId: string,
  input: CreateErrorEvidenceInput,
): Promise<ErrorEvidenceRow> {
  // Fast path: an evidence row for this attempt already exists.
  if (input.attempt_id) {
    const existing = await findByAttempt(client, userId, input.attempt_id);
    if (existing) return existing;
  }

  const insert: ErrorEvidenceInsert = {
    user_id: userId,
    attempt_id: input.attempt_id ?? null,
    error_entry_id: input.error_entry_id ?? null,
    classification_status: 'pending',
    classification_source: 'ai',
    student_answer: input.student_answer ?? null,
    expected_answer: input.expected_answer ?? null,
    question_snapshot_url: null,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.source_ids && input.source_ids.length > 0
        ? { source_ids: [...input.source_ids] }
        : {}),
    },
  };
  const { data, error } = await client
    .from('error_evidence')
    .insert(insert)
    .select('*')
    .single();
  if (error || !data) {
    // Unique-violation retry race: another concurrent attempt won
    // the insert. Resolve to the existing row.
    if (error && input.attempt_id) {
      const existing = await findByAttempt(client, userId, input.attempt_id);
      if (existing) return existing;
    }
    throw new Error(
      `createErrorEvidence failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  assertOwned(data, userId);
  const row = asRow<ErrorEvidenceRow>(data);

  const result = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'evidence.captured',
    aggregateType: 'error_evidence',
    aggregateId: row.id,
    aggregateVersion: 1,
    payload: {
      evidence_id: row.id,
      error_entry_id: row.error_entry_id,
      attempt_id: row.attempt_id,
      classification_status: row.classification_status,
    },
  });
  if (result.kind === 'error') {
    console.warn(`[krodex] evidence.captured emit failed: ${result.error.message}`);
  }
  return row;
}

/**
 * Link an evidence row to an error entry. Idempotent: re-linking
 * the same pair is a no-op. Used by CaptureOrchestrator stage 6
 * after the orchestrator decides whether to group the new attempt
 * with an existing error or create a fresh error_entry first.
 *
 * Note: `error_entry_id` is not in the standard patch surface
 * because students cannot move evidence between errors. The
 * orchestrator is the only caller and uses this dedicated setter.
 */
export async function linkEvidenceToError(
  client: SupabaseClient,
  userId: string,
  evidenceId: string,
  errorEntryId: string,
): Promise<ErrorEvidenceRow> {
  const before = await getErrorEvidence(client, userId, evidenceId);
  if (before.error_entry_id === errorEntryId) return before;
  const { data, error } = await client
    .from('error_evidence')
    .update({ error_entry_id: errorEntryId })
    .eq('id', evidenceId)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(
      `linkEvidenceToError failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  assertOwned(data, userId);
  return asRow<ErrorEvidenceRow>(data);
}

/**
 * Read a single evidence row by id. Throws NotFoundError if the
 * row does not exist; throws ForbiddenError if it exists but is
 * owned by someone else.
 */
export async function getErrorEvidence(
  client: SupabaseClient,
  userId: string,
  evidenceId: string,
): Promise<ErrorEvidenceRow> {
  const { data, error } = await client
    .from('error_evidence')
    .select('*')
    .eq('id', evidenceId)
    .maybeSingle();
  if (error) throw new Error(`getErrorEvidence failed: ${error.message}`);
  if (!data) throw new NotFoundError('error evidence not found');
  assertOwned(data, userId);
  return asRow<ErrorEvidenceRow>(data);
}

/**
 * List evidence rows for a given error entry, newest first. Used
 * by the in-app error detail page to show the snapshot history.
 */
export async function listEvidenceForError(
  client: SupabaseClient,
  userId: string,
  errorEntryId: string,
  limit = 25,
): Promise<readonly ErrorEvidenceRow[]> {
  const { data, error } = await client
    .from('error_evidence')
    .select('*')
    .eq('user_id', userId)
    .eq('error_entry_id', errorEntryId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listEvidenceForError failed: ${error.message}`);
  return asRows<ErrorEvidenceRow>(data ?? []);
}

/**
 * List all evidence rows owned by this user, newest first. Used
 * by the review queue surfaces.
 */
export async function listErrorEvidence(
  client: SupabaseClient,
  userId: string,
  filter: { classification_status?: ClassificationStatus } = {},
  limit = 50,
): Promise<readonly ErrorEvidenceRow[]> {
  let q = client
    .from('error_evidence')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (filter.classification_status) {
    q = q.eq('classification_status', filter.classification_status);
  }
  const { data, error } = await q;
  if (error) throw new Error(`listErrorEvidence failed: ${error.message}`);
  return asRows<ErrorEvidenceRow>(data ?? []);
}

/**
 * Patchable fields are restricted on purpose. The student-facing
 * answer columns are immutable; the orchestration layer only
 * fills in classification + snapshot_url + metadata.
 */
export interface UpdateErrorEvidenceInput {
  classification_status?: ClassificationStatus;
  classification_category?: MistakeType | null;
  classification_source?: 'ai' | 'student' | 'system';
  question_snapshot_url?: string | null;
  metadata?: Json;
}

export async function updateErrorEvidence(
  client: SupabaseClient,
  userId: string,
  evidenceId: string,
  patch: UpdateErrorEvidenceInput,
): Promise<ErrorEvidenceRow> {
  await getErrorEvidence(client, userId, evidenceId);
  const update: ErrorEvidenceUpdate = { ...patch };
  const { data, error } = await client
    .from('error_evidence')
    .update(update)
    .eq('id', evidenceId)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(
      `updateErrorEvidence failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  assertOwned(data, userId);
  return asRow<ErrorEvidenceRow>(data);
}

/**
 * Mark the evidence row as carrying a snapshot. The renderer
 * calls this with the storage key the upload produced. The URL is
 * NOT a public link — it is the internal reference the in-app
 * viewer resolves to an authorized signed URL at read time.
 */
export async function attachSnapshotRef(
  client: SupabaseClient,
  userId: string,
  evidenceId: string,
  snapshotRef: string,
): Promise<ErrorEvidenceRow> {
  return updateErrorEvidence(client, userId, evidenceId, {
    question_snapshot_url: snapshotRef,
  });
}

/**
 * Record the AI classification suggestion. Transitions the row
 * from 'pending' → 'suggested'. The user may later confirm or
 * override — those are recorded by `setStudentClassification`.
 */
export async function setAiClassification(
  client: SupabaseClient,
  userId: string,
  evidenceId: string,
  category: MistakeType,
): Promise<ErrorEvidenceRow> {
  return updateErrorEvidence(client, userId, evidenceId, {
    classification_status: 'suggested',
    classification_category: category,
    classification_source: 'ai',
  });
}

/**
 * Record a student-driven classification (confirm AI suggestion
 * or override it). Transitions to 'confirmed' or
 * 'student_override' depending on whether it matches the
 * existing AI-suggested category.
 */
export async function setStudentClassification(
  client: SupabaseClient,
  userId: string,
  evidenceId: string,
  category: MistakeType,
): Promise<ErrorEvidenceRow> {
  const before = await getErrorEvidence(client, userId, evidenceId);
  const matchesAi =
    before.classification_status === 'suggested' &&
    before.classification_category === category;
  return updateErrorEvidence(client, userId, evidenceId, {
    classification_status: matchesAi ? 'confirmed' : 'student_override',
    classification_category: category,
    classification_source: 'student',
  });
}

/**
 * Locate an evidence row by attempt id. Returns null if none
 * exists. Internal helper — used by the idempotent create path.
 */
async function findByAttempt(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<ErrorEvidenceRow | null> {
  const { data, error } = await client
    .from('error_evidence')
    .select('*')
    .eq('user_id', userId)
    .eq('attempt_id', attemptId)
    .maybeSingle();
  if (error) throw new Error(`findByAttempt failed: ${error.message}`);
  if (!data) return null;
  return asRow<ErrorEvidenceRow>(data);
}
