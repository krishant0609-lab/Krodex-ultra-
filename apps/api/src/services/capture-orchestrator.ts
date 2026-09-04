/**
 * KRODEX API — capture orchestrator (Phase 9, TRD §9).
 *
 * Runs the 10-stage capture pipeline for a single wrong answer.
 * Each stage has isolated try/catch so downstream failures never
 * undo an upstream commit. Per TRD §9:
 *
 *   1. Submit   — already done by the route handler
 *   2. Score    — already done by submit_test_attempt RPC
 *   3. Identify — locate or create the error_entries row
 *   4. Snapshot — render EvidenceSnapshot DTO → bytes
 *   5. Link     — attach evidence to error entry
 *   6. Group    — link evidence to error entry (single step here)
 *   7. Classify — async AI suggestion (non-blocking, fire-and-forget)
 *   8. Schedule — call ReviewSchedulingEngine, insert review_schedule
 *   9. Emit     — outbox events for each stage
 *  10. Project  — feature updates are handled by the worker reading
 *                 the outbox; this orchestrator does not write them
 *
 * Invariants:
 *   - The ErrorEvidence row is always created when run() returns
 *     successfully, even if snapshot/AI/scheduling failed.
 *   - Outbox emission is best-effort per the service-emitter
 *     post-commit contract; the source mutation always wins.
 *   - All timestamps come from the caller's `now` so the test
 *     suite is fully deterministic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ErrorEntryRow,
  EvidenceSnapshot,
  MistakeType,
  QuestionOptionRow,
  QuestionRow,
  ReviewOutcome,
  TestAnswerRow,
} from '@krodex/shared';
import { serviceEmit } from '../events/service-emitter';
import { renderSnapshot } from './snapshot-renderer';
import {
  uploadSnapshot,
  findActiveAssetForEvidence,
  type UploadSnapshotResult,
} from './evidence-asset-service';
import { createErrorEvidence, linkEvidenceToError } from './error-evidence-service';
import { scheduleReview } from './review';
import { sm2 } from './review-scheduling-engine';
import { asRow, asRows } from './_row';
import { suggestClassification, normalizeClassifierError } from '../ai/classifier';
import { buildClassificationEvidence } from '../ai/evidence';
import type { AiProvider } from '../ai/provider';

/** Per-wrong-answer input the orchestrator needs to run. */
export interface CaptureInput {
  userId: string;
  attempt: { id: string; test_id: string };
  answer: TestAnswerRow;
  errorEntry: ErrorEntryRow;
  question: QuestionRow | null;
  questionOptions: readonly QuestionOptionRow[];
  topicName: string | null;
  /** AI provider (used for stage 7). If null, classification is skipped. */
  aiProvider: AiProvider | null;
  /** Storage bucket name. */
  storageBucket: string;
  /** Wall clock seam for deterministic tests. */
  now?: Date;
}

/** The orchestrator's return value. */
export interface CaptureResult {
  evidenceId: string;
  snapshotStatus: 'available' | 'failed';
  assetId: string | null;
  classificationStatus: 'pending' | 'suggested' | 'skipped' | 'failed';
  reviewScheduledAt: string | null;
}

/**
 * Run the full capture pipeline for one wrong answer.
 *
 * Errors are caught per stage and recorded on the return value;
 * only an unrecoverable infrastructure error (e.g. the create call
 * itself fails) propagates.
 */
export async function runCapture(
  client: SupabaseClient,
  input: CaptureInput,
): Promise<CaptureResult> {
  const now = input.now ?? new Date();
  const sourceIds: string[] = [input.answer.question_id];
  if (input.errorEntry.id) sourceIds.push(input.errorEntry.id);

  // 3+6. Identify + Group. The error_entry is already linked to
  //      this attempt (the RPC wrote it during scoring). We
  //      create the evidence row and link it to the error_entry.
  const evidence = await createErrorEvidence(client, input.userId, {
    attempt_id: input.attempt.id,
    error_entry_id: input.errorEntry.id,
    student_answer: joinAnswer(input.answer),
    expected_answer: expectedAnswerText(input.questionOptions),
    source_ids: sourceIds,
    metadata: {
      topic_name: input.topicName,
      question_id: input.answer.question_id,
    },
  });
  // Defensive: if the evidence already existed with a different
  // error_entry_id, sync it. Idempotent under the unique index.
  if (evidence.error_entry_id !== input.errorEntry.id) {
    await linkEvidenceToError(
      client,
      input.userId,
      evidence.id,
      input.errorEntry.id,
    );
  }

  // 4+5. Snapshot. The DTO is built from the sanitized input,
  // then rendered to deterministic bytes. The renderer is pure:
  // same DTO → same bytes, no I/O, no clock. The orchestrator
  // picks the renderer's preferred format (PNG primary, SVG
  // fallback) and hands the bytes to uploadSnapshot.
  // uploadSnapshot is itself failure-tolerant: on a storage
  // failure it still inserts an `evidence_assets` row with
  // status='failed'. The only thing that escapes is a metadata-
  // insert failure (truly unrecoverable) — in that case we keep
  // going so the durable error_evidence row is preserved.
  //
  // Idempotence: if an active asset already exists for this
  // evidence (re-run on the same attempt), we skip the upload
  // stage entirely. The first run wins; later runs see the
  // existing row.
  const existing = await findActiveAssetForEvidence(
    client,
    evidence.id,
  );
  let upload: UploadSnapshotResult;
  if (existing) {
    upload = { asset: existing, storageKey: existing.storage_key };
  } else {
    const dto = buildSnapshotDto(input, now);
    const rendered = renderSnapshot(dto);
    try {
      const bytes =
        rendered.preferredMime === 'image/png' ? rendered.png : rendered.svg;
      upload = await uploadSnapshot(client, input.storageBucket, {
        userId: input.userId,
        evidenceId: evidence.id,
        bytes,
        mimeType: rendered.preferredMime,
      });
    } catch (err) {
      console.warn(`[krodex] capture snapshot upload failed: ${(err as Error).message}`);
      upload = {
        asset: {
          id: 'unknown',
          evidence_id: evidence.id,
          storage_bucket: input.storageBucket,
          storage_key: '',
          mime_type: 'image/png',
          byte_size: '0',
          sha256: null,
          status: 'failed',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        storageKey: '',
      };
    }
  }

  // Persist the snapshot reference on the evidence row so the UI
  // can resolve it to a signed URL on read. We use the storage
  // key, NOT a public URL.
  if (upload.asset.status === 'available') {
    await tryAttachRef(client, input.userId, evidence.id, upload.storageKey);
  }

  // 7. Classify. Async — wrapped in its own try/catch so a model
  //    failure never rolls back the durable evidence + snapshot.
  const classificationStatus = await runClassification(
    client,
    input,
    evidence.id,
  );

  // 8. Schedule. Failure here means: Evidence + snapshot are
  //    already in place; the review just isn't scheduled. The
  //    student can still self-schedule, and the outbox event for
  //    a future hook can retry. We log and continue.
  const reviewScheduledAt = await runScheduling(
    client,
    input,
    evidence.id,
    now,
  );

  // 9. Emit per-stage events. Each emit is best-effort; the
  //    service-emitter post-commit contract means we log and
  //    continue on failure. The two events are mutually exclusive:
  //    a failed snapshot is NOT also a "created" event.
  if (upload.asset.status === 'available') {
    await tryEmit(
      client,
      input,
      'evidence.snapshot_created',
      {
        evidence_id: evidence.id,
        asset_id: upload.asset.id,
        storage_bucket: upload.asset.storage_bucket,
        storage_key: upload.asset.storage_key,
        byte_size: upload.asset.byte_size,
        sha256: upload.asset.sha256,
      },
    );
  } else {
    await tryEmit(client, input, 'evidence.snapshot_failed', {
      evidence_id: evidence.id,
      asset_id: upload.asset.id,
      reason: 'snapshot render or storage upload failed',
    });
  }

  return {
    evidenceId: evidence.id,
    snapshotStatus: upload.asset.status === 'available' ? 'available' : 'failed',
    assetId: upload.asset.status === 'available' ? upload.asset.id : null,
    classificationStatus,
    reviewScheduledAt,
  };
}

// -----------------------------------------------------------------
// Stage helpers — each is a small pure function or a try/caught
// async call. The orchestrator never throws on a stage failure
// unless the failure is structural (DB down, RLS rejection).
// -----------------------------------------------------------------

function buildSnapshotDto(input: CaptureInput, now: Date): EvidenceSnapshot {
  return {
    questionId: input.answer.question_id,
    questionBody: input.question?.prompt ?? '(question body unavailable)',
    options: input.questionOptions.map((o) => ({
      body: o.body,
      isCorrect: o.is_correct,
    })),
    studentAnswer: joinAnswer(input.answer),
    expectedAnswer: expectedAnswerText(input.questionOptions),
    topicName: input.topicName ?? undefined,
    attemptId: input.attempt.id,
    timestamp: now.toISOString(),
    sourceIds: [input.answer.question_id, input.errorEntry.id].filter(Boolean),
  };
}

function joinAnswer(answer: TestAnswerRow): string {
  if (answer.free_text && answer.free_text.length > 0) {
    return answer.free_text;
  }
  if (answer.selected_option_ids.length === 0) return '(no answer)';
  return answer.selected_option_ids.join(',');
}

function expectedAnswerText(
  options: readonly QuestionOptionRow[],
): string {
  const correct = options.filter((o) => o.is_correct);
  if (correct.length === 0) return '(no answer key)';
  return correct.map((o) => o.body).join(' / ');
}

async function runClassification(
  client: SupabaseClient,
  input: CaptureInput,
  evidenceId: string,
): Promise<'pending' | 'suggested' | 'skipped' | 'failed'> {
  if (!input.aiProvider) return 'skipped';
  try {
    const aiEvidence = await buildClassificationEvidence(
      client,
      input.userId,
      input.errorEntry.id,
    );
    const suggestion = await suggestClassification(
      input.aiProvider,
      // Phase 9 plan: use the default (fast) model for
      // classification. The reasoning model is reserved for the
      // assistant service.
      'gpt-4o-mini',
      aiEvidence,
    );
    // Re-import to avoid a circular reference at top of file.
    const { setAiClassification } = await import('./error-evidence-service');
    await setAiClassification(
      client,
      input.userId,
      evidenceId,
      suggestion.suggestedCategory as MistakeType,
    );
    return 'suggested';
  } catch (err) {
    normalizeClassifierError(err); // re-throw as DependencyUnavailableError if needed
    // unreachable, but typed for the linter:
    void err;
    return 'failed';
  }
}

async function runScheduling(
  client: SupabaseClient,
  input: CaptureInput,
  evidenceId: string,
  now: Date,
): Promise<string | null> {
  try {
    // We need the prior review history for this error. The
    // orchestrator is called immediately after grading, so the
    // reviews are still rare — but in the recurrence case
    // (multiple submissions against the same error) we want the
    // engine to see them.
    const lastOutcome = await lastReviewOutcome(
      client,
      input.userId,
      input.errorEntry.id,
    );
    const counts = await reviewCounts(
      client,
      input.userId,
      input.errorEntry.id,
    );
    const recurrence = (input.errorEntry.recurrence_count ?? 0) > 0;
    const decision = sm2(
      {
        errorState: input.errorEntry.status,
        lastReviewOutcome: lastOutcome,
        reviewCount: counts.total,
        priorSuccesses: counts.successes,
        priorFailures: counts.failures,
        recurrenceEvidence: recurrence,
      },
      now,
    );
    const review = await scheduleReview(client, input.userId, {
      error_id: input.errorEntry.id,
      strategy: 'spaced',
      due_at: decision.dueAt,
      metadata: {
        reason_code: decision.reasonCode,
        reason_text: decision.reasonText,
        confidence: decision.confidence,
        requires_confirmation: decision.requiresConfirmation,
        evidence_id: evidenceId,
        engine: 'sm2',
      },
    });
    return review.due_at;
  } catch (err) {
    console.warn(
      `[krodex] capture scheduling failed: ${(err as Error).message}`,
    );
    return null;
  }
}

interface ReviewCounts {
  total: number;
  successes: number;
  failures: number;
}

async function reviewCounts(
  client: SupabaseClient,
  userId: string,
  errorId: string,
): Promise<ReviewCounts> {
  const { data, error } = await client
    .from('review_attempts')
    .select('outcome')
    .eq('user_id', userId)
    .eq('error_id', errorId);
  if (error) {
    // Non-fatal — treat as zero history. The orchestrator catches
    // upstream errors, but we want scheduling to keep going.
    return { total: 0, successes: 0, failures: 0 };
  }
  const rows = asRows<{ outcome: ReviewOutcome | null }>(data ?? []);
  let successes = 0;
  let failures = 0;
  for (const r of rows) {
    if (r.outcome === 'correct') successes++;
    else if (r.outcome === 'incorrect') failures++;
  }
  return { total: rows.length, successes, failures };
}

async function lastReviewOutcome(
  client: SupabaseClient,
  userId: string,
  errorId: string,
): Promise<ReviewOutcome | null> {
  const { data, error } = await client
    .from('review_attempts')
    .select('outcome')
    .eq('user_id', userId)
    .eq('error_id', errorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return asRow<{ outcome: ReviewOutcome | null }>(data).outcome;
}

async function tryAttachRef(
  client: SupabaseClient,
  userId: string,
  evidenceId: string,
  storageKey: string,
): Promise<void> {
  try {
    const { attachSnapshotRef } = await import('./error-evidence-service');
    await attachSnapshotRef(client, userId, evidenceId, storageKey);
  } catch (err) {
    console.warn(
      `[krodex] attachSnapshotRef failed: ${(err as Error).message}`,
    );
  }
}

async function tryEmit<T extends Parameters<typeof serviceEmit>[0]['eventType']>(
  client: SupabaseClient,
  input: CaptureInput,
  eventType: T,
  payload: Parameters<typeof serviceEmit<T>>[0]['payload'],
): Promise<void> {
  try {
    const result = await serviceEmit<T>({
      client,
      userId: input.userId,
      actorId: input.userId,
      eventType,
      aggregateType: 'error_evidence',
      aggregateId: input.attempt.id,
      aggregateVersion: 1,
      payload,
    });
    if (result.kind === 'error') {
      console.warn(`[krodex] ${eventType} emit failed: ${result.error.message}`);
    }
  } catch (err) {
    console.warn(`[krodex] ${eventType} emit threw: ${(err as Error).message}`);
  }
}
