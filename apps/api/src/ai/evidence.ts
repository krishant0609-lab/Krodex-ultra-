/**
 * KRODEX API — Phase 8 evidence assembler.
 *
 * The AI is non-authoritative. The orchestrator never hands the
 * model raw Supabase rows — it pre-digests the student-owned
 * data into a minimal, deterministic evidence payload:
 *
 *   - error id, status, current mistake_type, recurrence count
 *     (if any), remark (truncated to 200 chars)
 *   - the linked question's id, type, difficulty, topic name, and
 *     a 200-char excerpt of the prompt — never the full prompt,
 *     never the answer key, never the options.
 *   - the student's last 5 resolved errors for the same topic
 *     (just the mistake_type and outcome), so the classifier can
 *     spot a pattern.
 *
 * The assembler is the ONLY place that crosses the boundary from
 * Supabase rows to AI evidence. Tests can fake the supabase
 * client via `makeFakeSupabase`. The `now` parameter is a
 * dependency seam so tests can pin timestamps.
 *
 * Per Implementation Plan §3 and Phase 8 Plan §8: "The AI never
 * receives other students' data." Every read here is scoped by
 * the caller's `userId`; the routes that invoke this orchestrator
 * already have ownership enforced by the existing
 * `assertOwned(row, userId)` checks in the services.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ErrorEntryRow,
  MistakeType,
  QuestionRow,
  TopicRow,
} from '@krodex/shared';
import { asRow, asRows } from '../services/_row';
import { assertOwned } from '../auth/ownership';

export interface ClassificationEvidence {
  /** The error being classified (always present, asserted owned). */
  error: ErrorEntryRow;
  /** The linked question, if any. May be null. */
  question: QuestionRow | null;
  /** The topic the question belongs to, if resolvable. */
  topic: TopicRow | null;
  /** Other recent resolved errors for the same student (≤ 5). */
  recentByTopic: readonly ErrorEntryRow[];
  /** The ISO timestamp captured at evidence build time. */
  capturedAt: string;
}

export interface AssistantEvidenceBundle {
  errors: readonly ErrorEntryRow[];
  reviews: readonly { id: string; error_id: string; state: string; outcome: string | null }[];
  topics: readonly TopicRow[];
  capturedAt: string;
}

const REMAINING_EXCERPT_CHARS = 200;

/**
 * Build a single error's classification evidence. Throws via the
 * underlying services if the error is not found or not owned by
 * the caller. Returns null for the question/topic fields if the
 * error is unlinked.
 */
export async function buildClassificationEvidence(
  client: SupabaseClient,
  userId: string,
  errorId: string,
  now: () => Date = () => new Date(),
): Promise<ClassificationEvidence> {
  // 1) The error itself — owned-checked.
  const { data: errData, error: errError } = await client
    .from('error_entries')
    .select('*')
    .eq('id', errorId)
    .maybeSingle();
  if (errError) throw new Error(`buildClassificationEvidence: ${errError.message}`);
  if (!errData) {
    // Mirror the existing service behaviour — a missing error is
    // a domain "not found", not an AI-specific error.
    throw new Error(`error entry ${errorId} not found`);
  }
  const error = asRow<ErrorEntryRow>(errData);
  assertOwned(error, userId);

  // 2) The linked question, if any. We do not assert owned because
  // the questions table is global (RLS `to authenticated using
  // (true)` per the syllabus service).
  let question: QuestionRow | null = null;
  let topic: TopicRow | null = null;
  if (error.question_id) {
    const { data: qData, error: qError } = await client
      .from('questions')
      .select('*')
      .eq('id', error.question_id)
      .maybeSingle();
    if (qError) throw new Error(`buildClassificationEvidence: ${qError.message}`);
    if (qData) {
      question = asRow<QuestionRow>(qData);
      if (question.topic_id) {
        const { data: tData, error: tError } = await client
          .from('topics')
          .select('*')
          .eq('id', question.topic_id)
          .maybeSingle();
        if (tError) throw new Error(`buildClassificationEvidence: ${tError.message}`);
        if (tData) topic = asRow<TopicRow>(tData);
      }
    }
  }

  // 3) The student's other recent errors (resolved only) — used
  // to spot a recurring mistake-type pattern. Capped at 5, only
  // resolved, only owned by the caller.
  const { data: historyData, error: historyError } = await client
    .from('error_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'resolved')
    .neq('id', error.id)
    .order('resolved_at', { ascending: false })
    .limit(5);
  if (historyError) throw new Error(`buildClassificationEvidence: ${historyError.message}`);
  const recentByTopic: readonly ErrorEntryRow[] = asRows<ErrorEntryRow>(historyData ?? []).filter(
    (r) => r.question_id !== null,
  );

  return {
    error,
    question,
    topic,
    recentByTopic,
    capturedAt: now().toISOString(),
  };
}

/** Render the evidence as a compact, deterministic text block for the prompt. */
export function renderClassificationEvidenceForPrompt(
  ev: ClassificationEvidence,
): string {
  const lines: string[] = [];
  lines.push(`# Error ${ev.error.id}`);
  lines.push(`- status: ${ev.error.status}`);
  lines.push(`- current mistake_type: ${ev.error.mistake_type ?? 'null'}`);
  lines.push(`- recurrence_count: ${ev.error.recurrence_count}`);
  if (ev.error.remark) {
    lines.push(`- remark: ${truncate(ev.error.remark, REMAINING_EXCERPT_CHARS)}`);
  }

  if (ev.question) {
    lines.push('');
    lines.push(`# Linked question ${ev.question.id}`);
    lines.push(`- type: ${ev.question.question_type}`);
    lines.push(`- difficulty: ${ev.question.difficulty}`);
    if (ev.topic) lines.push(`- topic: ${ev.topic.name}`);
    lines.push(`- prompt_excerpt: ${truncate(ev.question.prompt, REMAINING_EXCERPT_CHARS)}`);
  } else {
    lines.push('');
    lines.push('# No linked question');
  }

  if (ev.recentByTopic.length > 0) {
    lines.push('');
    lines.push('# Recent resolved errors (own history, ≤5)');
    for (const r of ev.recentByTopic) {
      lines.push(`- ${r.id}: mistake_type=${r.mistake_type ?? 'null'} status=${r.status}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a generic evidence bundle for the assistant Q&A pipeline.
 * Cap is intentionally small: the AI sees a *sample* of the
 * student's records, not a dump.
 */
export async function buildAssistantEvidence(
  client: SupabaseClient,
  userId: string,
  options: { errorLimit?: number; reviewLimit?: number; topicLimit?: number } = {},
  now: () => Date = () => new Date(),
): Promise<AssistantEvidenceBundle> {
  const errorLimit = Math.min(options.errorLimit ?? 10, 25);
  const reviewLimit = Math.min(options.reviewLimit ?? 10, 25);
  const topicLimit = Math.min(options.topicLimit ?? 10, 25);

  const { data: errs, error: errErr } = await client
    .from('error_entries')
    .select('*')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false })
    .limit(errorLimit);
  if (errErr) throw new Error(`buildAssistantEvidence: ${errErr.message}`);
  const errors = asRows<ErrorEntryRow>(errs ?? []);

  const { data: revs, error: revErr } = await client
    .from('review_schedules')
    .select('id, error_id, state, outcome')
    .eq('user_id', userId)
    .order('due_at', { ascending: true })
    .limit(reviewLimit);
  if (revErr) throw new Error(`buildAssistantEvidence: ${revErr.message}`);
  const reviews = asRows<{
    id: string;
    error_id: string;
    state: string;
    outcome: string | null;
  }>(revs ?? []);

  // Topics are global; we still cap the list to keep the prompt small.
  const { data: tops, error: topErr } = await client
    .from('topics')
    .select('*')
    .order('display_order', { ascending: true })
    .limit(topicLimit);
  if (topErr) throw new Error(`buildAssistantEvidence: ${topErr.message}`);
  const topics = asRows<TopicRow>(tops ?? []);

  return {
    errors,
    reviews,
    topics,
    capturedAt: now().toISOString(),
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/** Re-export the shared MistakeType for callers that do not want to import @krodex/shared directly. */
export type { MistakeType };
