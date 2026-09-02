/**
 * KRODEX — learning-trajectory pattern module (Phase 5, §25.6).
 *
 * This module does NOT read raw evidence rows. It is a
 * *derived* feature: the orchestrator passes the outputs of
 * the consistency and error_recurrence modules, and the
 * trajectory module fuses them into a single direction
 * ("improving" / "declining" / "stable" /
 * "insufficient_data") and a single score (a weighted
 * composite of mean completion and inverse error recurrence).
 *
 * Formula (PRD §25.6):
 *   let completion  = consistency_score (mean test_completion)
 *   let errors      = error_recurrence_score
 *   let completion_dir = consistency.direction
 *   let errors_dir     = error_recurrence.direction
 *
 *   direction map (completion_dir, errors_dir):
 *     ('improving', 'improving') → 'improving'
 *     ('improving', 'declining') → 'improving'
 *     ('improving', 'flat')      → 'improving'
 *     ('improving', 'insufficient_data') → 'improving'
 *     ('declining', 'declining') → 'declining'
 *     ('declining', 'improving') → 'declining'
 *     ('declining', 'flat')      → 'declining'
 *     ('declining', 'insufficient_data') → 'declining'
 *     ('flat', 'flat')           → 'stable'
 *     ('flat', 'improving')      → 'improving'  (errors are dropping)
 *     ('flat', 'declining')      → 'declining'  (errors are rising)
 *     ('flat', 'insufficient_data') → 'stable'
 *     ('insufficient_data', *)   → insufficient_data
 *     (*, 'insufficient_data' but completion present) → use completion_dir
 *
 *   score = clamp01((completion * 2 + (1 - errors)) / 3)
 *   confidence = min(confidence(completion), confidence(errors))
 *   sampleSize = min(sampleSize(completion), sampleSize(errors))
 *
 * The trajectory is the *only* feature whose direction does
 * not come from a direct trend call. The orchestrator passes
 * the already-computed `consistency` and `error_recurrence`
 * outputs; this module does the direction-fusion logic.
 */

import { classifySampleSize } from '../../analytics/thresholds';
import { trendDirectionForNullSeries } from '../../analytics/trend';
import type { StudentModelFeatureValue } from '@krodex/shared';

import type { FeatureOutput, PatternInput } from '../types';
import { clamp01, emptyOutput } from './_helpers';

export const FEATURE_KEY = 'learning_trajectory' as const;

/** Direction returned by the upstream pattern modules. */
type UpstreamDirection = 'improving' | 'declining' | 'stable' | 'insufficient_data';

export interface LearningTrajectoryInputs {
  consistency: FeatureOutput;
  errorRecurrence: FeatureOutput;
  windowDays: number;
}

export async function computeFromUpstream(
  inputs: LearningTrajectoryInputs,
): Promise<FeatureOutput<typeof FEATURE_KEY>> {
  const { consistency, errorRecurrence, windowDays } = inputs;

  // If consistency is insufficient, we have no basis for a
  // trajectory. The error direction alone (if present) can
  // still be informative, but the PRD requires both signals
  // to declare a trajectory direction.
  if (
    consistency.direction === 'insufficient_data' &&
    errorRecurrence.direction === 'insufficient_data'
  ) {
    return emptyOutput(FEATURE_KEY, windowDays);
  }

  const direction = fuseDirection(
    consistency.direction as UpstreamDirection,
    errorRecurrence.direction as UpstreamDirection,
  );

  // Score is a weighted composite: completion counts double
  // (it's the more direct performance signal); error
  // recurrence is inverted (low recurrence = good).
  // (1 - errors) inverts: errors=0.2 (low recurrence) → 0.8
  const score = clamp01(
    (consistency.score * 2 + (1 - errorRecurrence.score)) / 3,
  );

  // Confidence is the worst of the two upstream confidences
  // — we cannot claim stronger evidence than the weakest
  // input feature.
  const confidenceRank: Record<StudentModelFeatureValue['confidence'], number> = {
    limited: 0,
    moderate: 1,
    strong: 2,
  };
  const inverseRank: Record<number, StudentModelFeatureValue['confidence']> = {
    0: 'limited',
    1: 'moderate',
    2: 'strong',
  };
  const minRank = Math.min(
    confidenceRank[consistency.confidence] ?? 0,
    confidenceRank[errorRecurrence.confidence] ?? 0,
  );

  // Sample size is the min of the two upstream sample sizes.
  const sampleSize = Math.min(consistency.sampleSize, errorRecurrence.sampleSize);

  const out: StudentModelFeatureValue & { featureKey: typeof FEATURE_KEY } = {
    featureKey: FEATURE_KEY,
    score,
    direction,
    confidence: inverseRank[minRank] ?? classifySampleSize(sampleSize),
    sampleSize,
    evidenceWindowDays: windowDays,
  };
  return out;
}

/**
 * The orchestrator's primary entry point. We keep the
 * `PatternInput` shape for symmetry with the other modules
 * (so the orchestrator can call all six uniformly), but we
 * require the caller to have already computed consistency
 * and error_recurrence. This module reads the corresponding
 * evidence directly and recomputes the upstream features on
 * the fly. The orchestrator may also pass a precomputed
 * cache via the input; for the pure-pattern-module path we
 * just use the evidence.
 */
export const compute: PatternCompute_async = async (input: PatternInput) => {
  // For the pure-from-evidence path, recompute the two
  // upstream signals here. The orchestrator normally calls
  // `computeFromUpstream` instead with cached results.
  const { compute: computeConsistency } = await import('./consistency');
  const { compute: computeErrorRecurrence } = await import('./error_recurrence');
  const [consistency, errorRecurrence] = await Promise.all([
    computeConsistency(input),
    computeErrorRecurrence(input),
  ]);
  return computeFromUpstream({
    consistency,
    errorRecurrence,
    windowDays: input.windowDays,
  });
};

/**
 * Direction fusion table — see module header for the full
 * map. The rule is: if EITHER upstream is improving, the
 * trajectory is improving; if EITHER is declining (and
 * neither is improving), the trajectory is declining; if
 * both are stable, the trajectory is stable. Insufficient_data
 * on one side falls through to the other side's verdict.
 */
export function fuseDirection(
  completion: UpstreamDirection,
  errors: UpstreamDirection,
): 'improving' | 'declining' | 'stable' | 'insufficient_data' {
  // Either side improving wins.
  if (completion === 'improving' || errors === 'improving') return 'improving';
  // Either side declining, neither improving, wins declining.
  if (completion === 'declining' || errors === 'declining') return 'declining';
  // Both stable.
  if (completion === 'stable' && errors === 'stable') return 'stable';
  // One side stable, other insufficient → stable
  if (completion === 'stable' || errors === 'stable') return 'stable';
  // Both insufficient (caller already short-circuited the
  // obvious case, but be safe).
  if (completion === 'insufficient_data' && errors === 'insufficient_data') {
    // trendDirectionForNullSeries returns 'insufficient_data'
    // (the analytics enum's "flat" value is our "stable" — we
    // normalize via this cast).
    return trendDirectionForNullSeries() as 'insufficient_data';
  }
  return 'stable';
}

type PatternCompute_async = (input: PatternInput) => Promise<FeatureOutput<typeof FEATURE_KEY>>;
