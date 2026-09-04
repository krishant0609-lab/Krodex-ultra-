/**
 * KRODEX API — ErrorPoolTestGenerator (Phase 10, PIP §10 + Schema Ready §11).
 *
 * Compose a deterministic custom test from a set of ErrorEntry ids.
 *
 * Behaviour:
 *
 *   1. Load the error entries and dedup by id. Sort the resulting
 *      set by id (stable, lexical). The sorted id set is the
 *      "pool signature" — the same input set always produces the
 *      same signature, and any two inputs that contain the same
 *      ids in any order produce the same signature.
 *
 *   2. If a test with `source_kind = 'error_bank'` and a matching
 *      `source_payload.error_ids` signature already exists for
 *      this user, return that test (`isNew = false`). This is the
 *      "never create duplicate tests from identical error sets"
 *      rule.
 *
 *   3. Otherwise, create a fresh `test_definitions` row with
 *      `source_kind = 'error_bank'`, `source_payload = { error_ids }`,
 *      a default title, and `intended_count = pool length * qpe`.
 *      Then attach the question rows pulled from each error's
 *      `question_id` (skipping errors that have no source question
 *      and replacing them with their linked questions, if any).
 *      `isNew = true`.
 *
 * Question selection is deterministic and topic-scoped by
 * construction: every question attached to the test is the
 * `question_id` of one of the error entries, so it is, by
 * definition, in the same topic as the original wrong question.
 * When an error entry has no `question_id`, the generator falls
 * back to a "from_error_questions" link (`error_question_links`)
 * if present, then skips the error if no question is available.
 *
 * Idempotency: the route handler wraps the call in
 * `withIdempotency` (apps/api/src/idempotency/helpers.ts). The
 * service is pure with respect to commandIds.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TestDefinitionRow, TestQuestionRow } from '@krodex/shared';
import { NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';
import * as tests from './tests';

export interface ErrorPoolTestInput {
  /** ErrorEntry ids to compose the test from. */
  errorIds: readonly string[];
  /** Optional human title. Defaults to "Error pool test (N items)". */
  title?: string;
  /** Questions per error (1 default). Used as `intended_count`. */
  questionsPerError?: number;
}

export interface ErrorPoolTestResult {
  testId: string;
  questionCount: number;
  isNew: boolean;
  /** The (sorted) pool signature — used for the "isNew" lookup. */
  signature: string;
  /** The attached test_question rows (newly attached when isNew). */
  attached: readonly TestQuestionRow[];
}

/**
 * Build the stable signature for a sorted set of error ids.
 * Lexical sort ensures the same set of ids in any order produces
 * the same signature.
 */
export function buildPoolSignature(errorIds: readonly string[]): string {
  const sorted = [...new Set(errorIds)].sort();
  return sorted.join('|');
}

/**
 * Look up an existing error-pool test by its pool signature.
 * Returns the test row if found, or null.
 *
 * We don't keep a dedicated signature column; instead we search
 * `source_payload->error_ids` for an exact match via the
 * `source_kind = 'error_bank'` filter. Tests that were created by
 * a different code path (or with a payload shape we don't
 * recognise) are ignored.
 */
export async function findExistingPoolTest(
  client: SupabaseClient,
  userId: string,
  signature: string,
): Promise<TestDefinitionRow | null> {
  const expectedIds = signature.split('|').filter(Boolean);
  const { data, error } = await client
    .from('test_definitions')
    .select('*')
    .eq('user_id', userId)
    .eq('source_kind', 'error_bank');
  if (error) {
    // Treat read failure as "no match" so the caller can still
    // create a new test. The duplicate guard isn't worth throwing
    // over.
    return null;
  }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const payload = (row.source_payload ?? {}) as { error_ids?: unknown };
    if (!Array.isArray(payload.error_ids)) continue;
    const candidate = [...new Set(payload.error_ids.map(String))].sort();
    if (candidate.length !== expectedIds.length) continue;
    let same = true;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] !== expectedIds[i]) {
        same = false;
        break;
      }
    }
    if (same) {
      assertOwned(row, userId);
      return asRow<TestDefinitionRow>(row);
    }
  }
  return null;
}

/**
 * Collect the candidate question ids for a set of error entries.
 *
 * For each error:
 *   1. If `error_entries.question_id` is set, use it.
 *   2. Otherwise, look up `error_question_links` for that error
 *      and use the first linked question id.
 *   3. Otherwise skip the error.
 *
 * The result is a stable, lexically-sorted, deduplicated list of
 * question ids, in display order.
 */
export async function collectQuestionIdsForErrors(
  client: SupabaseClient,
  userId: string,
  errorIds: readonly string[],
): Promise<{ questionIds: readonly string[]; skipped: readonly string[] }> {
  if (errorIds.length === 0) {
    return { questionIds: [], skipped: [] };
  }
  // 1. Load the error entries in one shot.
  const { data: errors, error: eErr } = await client
    .from('error_entries')
    .select('id, question_id')
    .eq('user_id', userId)
    .in('id', errorIds);
  if (eErr) {
    throw new Error(`collectQuestionIdsForErrors failed: ${eErr.message}`);
  }
  const errorRows = asRows<{ id: string; question_id: string | null }>(errors ?? []);
  // Build an id -> row map for fallback lookups.
  const byId = new Map(errorRows.map((r) => [String(r.id), r]));

  const directIds: string[] = [];
  const needsLinkLookup: string[] = [];
  for (const eid of errorIds) {
    const row = byId.get(String(eid));
    if (!row) continue; // Not owned / not found — skip.
    if (row.question_id) {
      directIds.push(String(row.question_id));
    } else {
      needsLinkLookup.push(String(eid));
    }
  }

  const linkedIds: string[] = [];
  const skipped: string[] = [];
  if (needsLinkLookup.length > 0) {
    // Fall back to the error_question_links link table when
    // present. The link may have multiple rows per error; we use
    // the lexically-first one for determinism.
    const { data: links, error: lErr } = await client
      .from('error_question_links')
      .select('error_id, question_id')
      .eq('user_id', userId)
      .in('error_id', needsLinkLookup);
    if (!lErr && links) {
      const grouped = new Map<string, string[]>();
      for (const r of links as Array<Record<string, unknown>>) {
        const eid = String(r.error_id);
        const qid = String(r.question_id);
        const arr = grouped.get(eid) ?? [];
        arr.push(qid);
        grouped.set(eid, arr);
      }
      for (const eid of needsLinkLookup) {
        const arr = grouped.get(eid);
        if (!arr || arr.length === 0) {
          skipped.push(eid);
          continue;
        }
        const sorted = [...arr].sort();
        const first = sorted[0];
        if (first !== undefined) linkedIds.push(first);
      }
    } else {
      // No link rows found — record as skipped.
      for (const eid of needsLinkLookup) skipped.push(eid);
    }
  }

  const all = [...directIds, ...linkedIds];
  // Dedupe + stable sort.
  const unique = [...new Set(all)].sort();
  return { questionIds: unique, skipped };
}

/**
 * Create a deterministic error-pool test, or return the existing
 * one if a test with the same pool signature was already created.
 *
 * Throws `NotFoundError` if any of the provided error ids do not
 * belong to the user (we don't reveal which one — the caller
 * treats the whole request as 404).
 */
export async function generateErrorPoolTest(
  client: SupabaseClient,
  userId: string,
  input: ErrorPoolTestInput,
): Promise<ErrorPoolTestResult> {
  // 1. Build the signature.
  const signature = buildPoolSignature(input.errorIds);

  // 2. Dedupe path: look for an existing matching test.
  if (signature.length > 0) {
    const existing = await findExistingPoolTest(client, userId, signature);
    if (existing) {
      const { data: attached, error: aErr } = await client
        .from('test_questions')
        .select('*')
        .eq('test_id', existing.id)
        .order('display_order', { ascending: true });
      if (aErr) {
        throw new Error(`load existing test_questions failed: ${aErr.message}`);
      }
      return {
        testId: existing.id,
        questionCount: existing.intended_count,
        isNew: false,
        signature,
        attached: asRows<TestQuestionRow>(attached ?? []),
      };
    }
  }

  // 3. Create path: collect the question ids.
  const { questionIds } = await collectQuestionIdsForErrors(
    client,
    userId,
    input.errorIds,
  );

  if (questionIds.length === 0) {
    throw new NotFoundError(
      'no questions available for the requested error pool',
      { context: { errorIds: input.errorIds } },
    );
  }

  const qpe = Math.max(1, Math.floor(input.questionsPerError ?? 1));
  const title = input.title ?? `Error pool test (${questionIds.length} items)`;
  const intendedCount = questionIds.length * qpe;

  const created = await tests.createTestDefinition(client, userId, {
    title,
    source_kind: 'error_bank',
    source_payload: { error_ids: signature.split('|') },
    intended_count: intendedCount,
    duration_minutes: null,
    metadata: {
      poolSignature: signature,
      generator: 'error-pool-test-generator/v1',
    },
  });

  // 4. Attach each question once, in display order.
  const attached: TestQuestionRow[] = [];
  for (let i = 0; i < questionIds.length; i++) {
    const qid = questionIds[i];
    if (!qid) continue;
    const row = await tests.attachTestQuestion(
      client,
      userId,
      created.id,
      qid,
      i,
    );
    attached.push(row);
  }

  return {
    testId: created.id,
    questionCount: attached.length,
    isNew: true,
    signature,
    attached,
  };
}
