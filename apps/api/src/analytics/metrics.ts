/**
 * KRODEX API — analytics metrics service.
 *
 * Per PHASE4_PLAN.md §3, the six PRD §24 metrics are the only
 * ratios Phase 4 ships. Their formulas are quoted verbatim from
 * PRD §24:938-948 (the same table appears in PRD §37:1390-1400).
 * Every formula in this file is **Class A — explicit source.**
 *
 * Per the Phase 4 plan §3.2, every metric response always
 * includes `{ value, numerator, denominator, sampleSize }`
 * (TRD §18:733-734). When the sample is too small or the
 * denominator is zero, the `value` is `null` rather than 0 or
 * NaN.
 *
 * Per D-2 (Class C — Approved Product Policy), the suppression
 * cut-off is the `limited` ladder: `sampleSize < 5`. See
 * `thresholds.ts`.
 *
 * The formulas are deterministic pure functions of the input
 * numbers. They are unit-tested in `__tests__/formulas.test.ts`.
 */

import { shouldSuppressValue } from './thresholds';

/** Standard metric response shape. */
export interface MetricValue {
  /** Numeric value in [0, 1] for ratios, or any non-negative
   *  number for counts. `null` when the sample is too small or
   *  the denominator is zero. */
  value: number | null;
  numerator: number;
  denominator: number;
  sampleSize: number;
  /** True when the value was suppressed due to small sample
   *  size (per D-2 Class C). */
  suppressed: boolean;
}

/**
 * Internal helper. Builds the canonical MetricValue from raw
 * counts. If the sample is below the suppression threshold or
 * the denominator is zero, the value is forced to null.
 */
function toMetricValue(
  numerator: number,
  denominator: number,
  sampleSize: number,
): MetricValue {
  if (denominator === 0 || shouldSuppressValue(sampleSize)) {
    return { value: null, numerator, denominator, sampleSize, suppressed: denominator === 0 ? false : true };
  }
  return {
    value: numerator / denominator,
    numerator,
    denominator,
    sampleSize,
    suppressed: false,
  };
}

/* -------------------------------------------------------------------------- */
/* The six PRD §24 metric formulas. Class A — verbatim from PRD §24:938-948.  */
/* -------------------------------------------------------------------------- */

/**
 * Metric 1 — Test completion rate.
 * PRD §24:938 (verbatim): "Submitted attempts / started attempts".
 * Class A.
 */
export function testCompletionRate(
  submitted: number,
  started: number,
  sampleSize: number,
): MetricValue {
  return toMetricValue(submitted, started, sampleSize);
}

/**
 * Metric 2 — Error capture rate.
 * PRD §24:940 (verbatim): "Eligible incorrect answers with
 * evidence / eligible incorrect answers". Class A.
 */
export function errorCaptureRate(
  captured: number,
  eligible: number,
  sampleSize: number,
): MetricValue {
  return toMetricValue(captured, eligible, sampleSize);
}

/**
 * Metric 3 — Review completion.
 * PRD §24:942 (verbatim): "Completed reviews / due reviews".
 * Class A.
 */
export function reviewCompletion(
  completed: number,
  due: number,
  sampleSize: number,
): MetricValue {
  return toMetricValue(completed, due, sampleSize);
}

/**
 * Metric 4 — Correction rate.
 * PRD §24:944 (verbatim): "Qualifying correct outcomes /
 * completed reviews". Class A.
 */
export function correctionRate(
  qualifyingCorrect: number,
  completedReviews: number,
  sampleSize: number,
): MetricValue {
  return toMetricValue(qualifyingCorrect, completedReviews, sampleSize);
}

/**
 * Metric 5 — Reopen rate.
 * PRD §24:946 (verbatim): "Reopened errors / resolved errors".
 * Class A.
 */
export function reopenRate(
  reopened: number,
  resolved: number,
  sampleSize: number,
): MetricValue {
  return toMetricValue(reopened, resolved, sampleSize);
}

/**
 * Metric 6 — Time to correction (median across the window).
 * PRD §24:948 (verbatim): "Resolution timestamp − Error creation
 * timestamp (per-error; aggregate is the median across resolved
 * errors in the window)". Class A.
 *
 * The unit is seconds. We accept an array of per-error
 * resolution deltas (already in seconds) and return the median.
 * When the input is empty, the value is null.
 */
export function timeToCorrectionMedian(
  perErrorSeconds: readonly number[],
): MetricValue {
  const n = perErrorSeconds.length;
  if (n === 0) {
    return { value: null, numerator: 0, denominator: 0, sampleSize: 0, suppressed: false };
  }
  const sorted = [...perErrorSeconds].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
  return {
    value: median,
    numerator: Math.round(median),
    denominator: n,
    sampleSize: n,
    suppressed: shouldSuppressValue(n),
  };
}

/* -------------------------------------------------------------------------- */
/* Window aggregations. The 7/14/30-day rollups (Class A per PRD §23:924-927).*/
/* -------------------------------------------------------------------------- */

/** A single (numerator, denominator) pair for a window. */
export interface WindowCounts {
  /** Number of numerator events in the window. */
  numerator: number;
  /** Number of denominator events in the window. */
  denominator: number;
  /** Total evidence rows contributing to the metric. */
  sampleSize: number;
}

/**
 * Reduce an array of per-(day) WindowCounts into a single metric
 * for the whole window. Sum numerators and denominators across
 * days; sample size is also summed. Class A — direct
 * interpretation of "aggregation across the window" in PRD §23.
 */
export function reduceWindow(
  perDay: readonly WindowCounts[],
): MetricValue {
  let numerator = 0;
  let denominator = 0;
  let sampleSize = 0;
  for (const w of perDay) {
    numerator += w.numerator;
    denominator += w.denominator;
    sampleSize += w.sampleSize;
  }
  return toMetricValue(numerator, denominator, sampleSize);
}
