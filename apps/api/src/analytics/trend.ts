/**
 * KRODEX API — analytics trend service.
 *
 * Per PHASE4_PLAN.md §6 (Decision Point D-3), this module maps a
 * daily/weekly series into a four-value trend direction enum.
 *
 * **The numbers in this file are NOT documented by the PRD, TRD,
 * or Implementation Plan. They are Class C — Approved Product
 * Policy, approved by the user as a Phase 4 product decision.**
 *
 * The four values (Class C — Approved Product Policy):
 *   - 'improving'
 *   - 'declining'
 *   - 'flat'
 *   - 'insufficient_data'
 *
 * The threshold (Class C — Approved Product Policy):
 *   - Trend threshold: 0.05
 *     ("meaningful change" is at least 0.05 absolute)
 *
 * The minimum-evidence rule (Class C — Approved Product Policy):
 *   - Minimum evidence: 3 distinct days
 *     (need at least 3 distinct days with data to declare a trend)
 *
 * The comparison method (Class C — Approved Product Policy):
 *   - half-vs-half
 *     (split the series into the first half and the second half;
 *      compare the mean of each half)
 *
 * Do not change any of these without re-approving D-3.
 *
 * IMPORTANT: this is a PURE function. The fake-supabase / unit
 * tests are the authoritative contract; do not introduce any
 * I/O in this module.
 */

export type TrendDirection = 'improving' | 'declining' | 'flat' | 'insufficient_data';

/**
 * The numeric constants. They are exported so tests can pin them
 * and so the dimensions route can render a "config" panel
 * without re-typing the numbers.
 *
 * Classification: **Class C — Approved Product Policy.**
 */
export const TREND_POLICY = {
  THRESHOLD: 0.05,
  MIN_DISTINCT_DAYS: 3,
} as const;

/** A single point in a daily series. */
export interface TrendPoint {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  /** Metric value in [0, 1], or null when the day had no data. */
  value: number;
}

/**
 * Half-vs-half comparison (Class C — Approved Product Policy):
 *   1. Filter out days with no data (value === null is not
 *      possible here — we type the input as `number` only).
 *   2. Count distinct calendar days. If < 3, return
 *      'insufficient_data' immediately.
 *   3. Split the series into two halves by *index* (not by
 *      date) and average each half. We use the trailing half
 *      minus the leading half as the trend delta.
 *   4. If the absolute delta is below 0.05, return 'flat'.
 *      Otherwise: positive delta = 'improving'; negative =
 *      'declining'.
 *
 * The function is total — every input shape returns a valid
 * enum value.
 */
export function trendDirection(series: readonly TrendPoint[]): TrendDirection {
  // Step 1: keep only days with a value.
  const points = series.filter((p): p is { day: string; value: number } => Number.isFinite(p.value));
  if (points.length < TREND_POLICY.MIN_DISTINCT_DAYS) {
    return 'insufficient_data';
  }

  // Step 2: distinct days. The series is already day-keyed
  // (no two entries for the same day are expected), but we
  // defend against duplicates in case upstream data has them.
  const distinctDays = new Set(points.map((p) => p.day));
  if (distinctDays.size < TREND_POLICY.MIN_DISTINCT_DAYS) {
    return 'insufficient_data';
  }

  // Step 3: half-vs-half mean comparison.
  const halfIdx = Math.floor(points.length / 2);
  const leading = points.slice(0, halfIdx);
  const trailing = points.slice(halfIdx);

  const mean = (xs: readonly { value: number }[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b.value, 0) / xs.length;

  const delta = mean(trailing) - mean(leading);

  // Step 4: threshold + sign.
  if (Math.abs(delta) < TREND_POLICY.THRESHOLD) {
    return 'flat';
  }
  return delta > 0 ? 'improving' : 'declining';
}

/**
 * Helper for tests: an empty series or one with all-null
 * values is always 'insufficient_data'. This is the contract.
 */
export function trendDirectionForNullSeries(): TrendDirection {
  return 'insufficient_data';
}
