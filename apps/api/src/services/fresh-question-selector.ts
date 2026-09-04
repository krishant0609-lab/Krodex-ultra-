/**
 * KRODEX API — Fresh Question Selector (Phase 10, PRD §18).
 *
 * Selects a fresh verification question for a review session. The
 * question must be:
 *
 *   1. Distinct from the original wrong question (the one that
 *      produced the error).
 *   2. Distinct from every question already used as a verification
 *      question for this error (i.e. present in
 *      `verification_questions` for this `error_id`).
 *   3. From the same topic (or a parent topic) as the original
 *      question.
 *   4. Same or lower difficulty than the original question
 *      (numerical, ordered 1=easy → 5=olympiad).
 *
 * Selection is purely deterministic: the same input set always
 * returns the same question id. AI is advisory only and may
 * suggest a difficulty tier; the selector never lets the AI pick
 * the question itself.
 *
 * Difficulty ordinal:
 *   1 = easy, 2 = medium, 3 = hard, 4 = olympiad, 5 = extreme
 * (the canonical mapping is defined in `_difficulty.ts`.)
 *
 * "No suitable question" is a real, expected outcome — when the
 * topic pool is exhausted, the selector returns `null` so the UI
 * can show "no verification question available."
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Mapping from the `Difficulty` enum (which is qualitative) to
 * the numerical ordinal we use for same-or-lower comparisons.
 * Kept here (not in shared) because the mapping is implementation
 * detail for the selector.
 */
const DIFFICULTY_ORDINAL: Readonly<Record<string, number>> = {
  easy: 1,
  medium: 2,
  hard: 3,
  olympiad: 4,
  extreme: 5,
};

export function difficultyOrdinal(d: string | null | undefined): number {
  if (!d) return 3; // default to "hard" if unknown
  return DIFFICULTY_ORDINAL[d] ?? 3;
}

export interface FreshQuestionInput {
  errorId: string;
  originalQuestionId: string;
  /** Additional question ids to exclude beyond what's in verification_questions. */
  excludeQuestionIds?: readonly string[];
  /** Hard cap on difficulty. Defaults to the original question's difficulty. */
  maxDifficulty?: number;
}

export interface FreshQuestionResult {
  questionId: string;
  source: 'verification_questions' | 'question_pool';
  difficulty: number;
}

export interface OriginalQuestionInfo {
  id: string;
  topic_id: string | null;
  sub_topic_id: string | null;
  difficulty: string | null;
}

export type FreshQuestionOutcome =
  | { kind: 'found'; result: FreshQuestionResult }
  | { kind: 'none' };

/**
 * Pure deterministic selector. Given the original question info
 * and the list of question rows in the eligible pool, pick the
 * first question (sorted by id) that satisfies:
 *   - distinct from the original
 *   - distinct from the exclude set
 *   - same or lower difficulty (≤ maxDifficulty)
 *   - shares a topic with the original (topic_id OR sub_topic_id match)
 *
 * Returns `{ kind: 'none' }` if the pool is empty after filtering.
 *
 * The function is exported separately from the service that calls
 * the database so it can be unit-tested with mock data.
 */
export function selectFromPool(
  original: OriginalQuestionInfo,
  pool: readonly OriginalQuestionInfo[],
  excludeQuestionIds: readonly string[],
  maxDifficulty: number,
): FreshQuestionOutcome {
  const originalTopic = original.topic_id;
  const originalSubTopic = original.sub_topic_id;
  const exclude = new Set<string>([original.id, ...excludeQuestionIds]);

  // Topic / sub-topic match + difficulty ceiling + exclusion.
  const eligible = pool.filter((q) => {
    if (exclude.has(q.id)) return false;
    if (difficultyOrdinal(q.difficulty) > maxDifficulty) return false;
    if (originalTopic) {
      const topicMatch = q.topic_id === originalTopic;
      const subTopicMatch = originalSubTopic
        ? q.sub_topic_id === originalSubTopic
        : false;
      if (!topicMatch && !subTopicMatch) return false;
    } else if (originalSubTopic && q.sub_topic_id !== originalSubTopic) {
      return false;
    }
    return true;
  });

  // Stable-sort by id; pick the first.
  const sorted = [...eligible].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = sorted[0];
  if (!first) return { kind: 'none' };
  return {
    kind: 'found',
    result: {
      questionId: first.id,
      source: 'question_pool',
      difficulty: difficultyOrdinal(first.difficulty),
    },
  };
}

/**
 * I/O wrapper. Loads the original question info, the existing
 * verification_questions exclusions, the topic-scoped question
 * pool, and calls `selectFromPool`. Persists the chosen
 * verification question (so future reviews skip it) and returns
 * the result.
 */
export async function selectFreshQuestion(
  client: SupabaseClient,
  userId: string,
  input: FreshQuestionInput,
): Promise<FreshQuestionOutcome> {
  // 1. Load the original question (the one that produced the error).
  const original = await loadQuestion(client, input.originalQuestionId);
  if (!original) return { kind: 'none' };

  // 2. Load the exclusion set from verification_questions for this error.
  const excludeSet = await loadExclusions(client, input.errorId, input.excludeQuestionIds ?? []);

  // 3. Build the candidate pool from the same topic.
  const maxDifficulty = input.maxDifficulty ?? difficultyOrdinal(original.difficulty);
  const pool = await loadPool(client, original, maxDifficulty);

  // 4. Pick deterministically.
  const outcome = selectFromPool(original, pool, excludeSet, maxDifficulty);
  if (outcome.kind === 'none') return outcome;

  // 5. Record the choice so future selections skip it. Failure
  //    here is non-fatal: the selector result is returned even if
  //    the bookkeeping write fails (the next session will just
  //    re-consider the same question).
  const { error: vqErr } = await client.from('verification_questions').insert({
    question_id: outcome.result.questionId,
    error_id: input.errorId,
    difficulty: outcome.result.difficulty,
    verified_at: new Date().toISOString(),
  });
  if (vqErr) {
    console.warn(
      `[krodex] verification_questions insert failed: ${vqErr.message}`,
    );
  }

  return outcome;
}

async function loadQuestion(
  client: SupabaseClient,
  questionId: string,
): Promise<OriginalQuestionInfo | null> {
  const { data, error } = await client
    .from('questions')
    .select('id, topic_id, sub_topic_id, difficulty')
    .eq('id', questionId)
    .maybeSingle();
  if (error) {
    console.warn(`[krodex] loadQuestion failed: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return {
    id: String(data.id),
    topic_id: data.topic_id ?? null,
    sub_topic_id: data.sub_topic_id ?? null,
    difficulty: data.difficulty ?? null,
  };
}

async function loadExclusions(
  client: SupabaseClient,
  errorId: string,
  additional: readonly string[],
): Promise<readonly string[]> {
  const { data, error } = await client
    .from('verification_questions')
    .select('question_id')
    .eq('error_id', errorId);
  if (error) {
    console.warn(`[krodex] loadExclusions failed: ${error.message}`);
    return [...additional];
  }
  const fromTable = (data ?? []).map((r) => String(r.question_id));
  return [...fromTable, ...additional];
}

async function loadPool(
  client: SupabaseClient,
  original: OriginalQuestionInfo,
  maxDifficulty: number,
): Promise<readonly OriginalQuestionInfo[]> {
  // Map ordinal back to a list of qualitative difficulties. If the
  // cap is N, the pool includes easy..(N). We don't filter at the
  // SQL level because the mapping is implementation detail; we
  // filter post-fetch in `selectFromPool` against the same ordinal.
  const { data, error } = await client
    .from('questions')
    .select('id, topic_id, sub_topic_id, difficulty')
    .eq('is_active', true)
    .limit(500);
  if (error) {
    console.warn(`[krodex] loadPool failed: ${error.message}`);
    return [];
  }
  return (data ?? []).map((q) => ({
    id: String(q.id),
    topic_id: q.topic_id ?? null,
    sub_topic_id: q.sub_topic_id ?? null,
    difficulty: q.difficulty ?? null,
  }));
}
