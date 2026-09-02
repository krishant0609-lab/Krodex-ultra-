/**
 * KRODEX — Student Model pattern-module contract (Phase 5).
 *
 * The six pattern modules in this directory share the same input
 * shape, the same output envelope, and the same invariants. They
 * are pure functions: given the same evidence rows, they return
 * the same `FeatureOutput` — no randomness, no Date.now, no I/O.
 *
 * The orchestrator (`computeFeatures.ts`) loads the evidence
 * once, fans out to all six pattern modules in parallel, and
 * composes the final `StudentModelSnapshotPayload`.
 *
 * Contract (PRD §25):
 *   - score is 0..1 continuous (0.0 = worst, 1.0 = best). The
 *     meaning of "worst"/"best" is module-specific (e.g. low
 *     procrastination_score = few late reviews = good). Callers
 *     MUST NOT invert the score; they must surface it as-is.
 *   - direction is the half-vs-half trend over the window
 *     (3+ distinct days required to qualify as improving /
 *     declining / flat; otherwise 'insufficient_data').
 *   - confidence is the D-2 ladder from analytics/thresholds.ts:
 *     'limited' (<5), 'moderate' (5..19), 'strong' (>=20).
 *   - sampleSize is the raw count the module saw. Modules MUST
 *     use the value that drives `confidence` (not a proxy).
 *   - evidenceWindowDays is the window the module ran against
 *     (default 28, max 90). The orchestrator passes the same
 *     value to every module in a single run.
 */

import type {
  StudentModelFeatureKey,
  StudentModelFeatureValue,
} from '@krodex/shared';

/**
 * Shared pattern input. The orchestrator passes the same
 * `windowDays` to every module so that the trend, confidence,
 * and sample-size signals are comparable across features.
 */
export interface PatternInput {
  userId: string;
  /** Window end, inclusive. */
  until: Date;
  /** Window length in days (e.g. 28). */
  windowDays: number;
  /**
   * Pre-loaded evidence rows. Each module reads only the keys
   * it cares about. Keys missing from the object mean "no
   * evidence of this kind was loaded"; modules MUST treat
   * missing arrays as empty (sampleSize=0 → insufficient_data).
   */
  evidence: StudentModelEvidence;
}

/** Pre-loaded evidence grouped by source table. */
export interface StudentModelEvidence {
  /** progress_evidence rows where dimension = 'test_completion'. */
  testCompletion: ReadonlyArray<TestCompletionRow>;
  /** review_schedules rows (any status) in the window. */
  reviewSchedules: ReadonlyArray<ReviewScheduleRow>;
  /** error_entries rows in the window. */
  errorEntries: ReadonlyArray<ErrorEntryRow>;
  /**
   * planner_tasks rows in the window. Empty array is fine —
   * workload_pressure.ts will fall back to review_schedules
   * scheduled count when tasks are sparse.
   */
  plannerTasks: ReadonlyArray<PlannerTaskRow>;
}

/** Mirror of progress_evidence columns used by consistency.ts. */
export interface TestCompletionRow {
  user_id: string;
  dimension: string;
  ref_kind: string;
  ref_id: string;
  captured_at: string;
  numerator: number;
  denominator: number;
}

/** Mirror of review_schedules columns used by review_behavior.ts. */
export interface ReviewScheduleRow {
  user_id: string;
  due_date: string;
  review_date: string | null;
  status: 'scheduled' | 'completed' | 'missed' | 'rescheduled';
}

/** Mirror of error_entries columns used by error_recurrence.ts. */
export interface ErrorEntryRow {
  id: string;
  user_id: string;
  error_type: string;
  captured_at: string;
}

/** Mirror of planner_tasks columns used by workload_pressure.ts. */
export interface PlannerTaskRow {
  user_id: string;
  status: 'active' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

/**
 * Output of a single pattern module. Same shape as
 * `StudentModelFeatureValue`; the difference is that
 * `featureKey` is the typed literal for the module.
 */
export type FeatureOutput<KEY extends StudentModelFeatureKey = StudentModelFeatureKey> =
  StudentModelFeatureValue & { featureKey: KEY };

/**
 * Every pattern module exports a pure function with this
 * signature. The orchestrator calls them via Promise.all; the
 * function is synchronous in spirit (no I/O), so the async
 * shape is just a uniform contract.
 */
export type PatternCompute = (input: PatternInput) => Promise<FeatureOutput>;
