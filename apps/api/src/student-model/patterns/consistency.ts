/**
 * KRODEX — consistency pattern module (Phase 5, §25.1).
 *
 * Measures how steady a student is in completing tests. The
 * evidence source is `progress_evidence` rows with
 * `dimension = 'test_completion'`. Each row carries a
 * `(numerator, denominator)` pair captured at a specific day;
 * the daily ratio `numerator / denominator` is the per-day
 * value. A student who completes a steady 0.8 of their tests
 * every day has higher consistency than one who alternates
 * between 1.0 and 0.0.
 *
 * Formula (PRD §25.1):
 *   daily_ratios  = per-day test_completion ratio (0.0..1.0, null = no day)
 *   mean_ratio    = mean(daily_ratios)             — overall tendency
 *   std_dev       = stddev_samp(daily_ratios)      — variability
 *   score         = clamp(1 - std_dev, 0, 1)       — high consistency → 1.0
 *   direction     = trend(daily_ratios)            — half-vs-half
 *   sampleSize    = count(daily_ratios)
 *   confidence    = classifySampleSize(sampleSize) — D-2 ladder
 *
 * The score is on the variability axis: even a student who
 * consistently fails (mean_ratio ≈ 0) is more "consistent" than
 * one who sometimes passes and sometimes fails. The PRD is
 * explicit that the consistency axis is independent of the
 * average performance axis (which lives in `error_recurrence`
 * and `learning_trajectory`).
 */

import { classifySampleSize } from '../../analytics/thresholds';
import type { StudentModelFeatureValue } from '@krodex/shared';

import type { FeatureOutput, PatternCompute, PatternInput } from '../types';
import { clamp01, dayKey, directionFor, emptyOutput } from './_helpers';

export const FEATURE_KEY = 'consistency_score' as const;

/** Compute the consistency score over the given evidence. */
export const compute: PatternCompute = async (input: PatternInput): Promise<FeatureOutput<'consistency_score'>> => {
  const { evidence, windowDays } = input;

  // Filter to test_completion rows. Other dimensions exist on
  // progress_evidence (errors_created, reviews_completed, etc.)
  // but they belong to other pattern modules.
  const relevant = evidence.testCompletion.filter((r) => r.dimension === 'test_completion');

  if (relevant.length === 0) {
    return emptyOutput(FEATURE_KEY, windowDays);
  }

  // Group by day, compute per-day ratio. Skip days with
  // denominator=0 (no attempts that day) — they are not
  // informative on the variability axis.
  const perDay = new Map<string, { num: number; den: number }>();
  for (const r of relevant) {
    const key = dayKey(r.captured_at);
    const acc = perDay.get(key) ?? { num: 0, den: 0 };
    acc.num += r.numerator;
    acc.den += r.denominator;
    perDay.set(key, acc);
  }
  const dailyRatios: number[] = [];
  for (const { num, den } of perDay.values()) {
    if (den > 0) dailyRatios.push(clamp01(num / den));
  }

  if (dailyRatios.length === 0) {
    return emptyOutput(FEATURE_KEY, windowDays);
  }

  // mean
  const mean = dailyRatios.reduce((s, v) => s + v, 0) / dailyRatios.length;
  // sample standard deviation
  const variance =
    dailyRatios.length < 2
      ? 0
      : dailyRatios.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyRatios.length - 1);
  const stdDev = Math.sqrt(variance);

  // Score is 1 - clamp(stdDev). stdDev=0 → score=1 (perfectly
  // consistent); stdDev>=1 → score=0 (max variability). We use
  // clamp01 in case stdDev is slightly > 1 due to numeric noise.
  const score = clamp01(1 - stdDev);

  const direction = directionFor(
    [...perDay.entries()]
      .filter(([, { num, den }]) => den > 0)
      .map(([day, { num, den }]) => ({ day, value: num / den })),
  );

  const sampleSize = dailyRatios.length;
  const confidence = classifySampleSize(sampleSize);

  const out: StudentModelFeatureValue & { featureKey: 'consistency_score' } = {
    featureKey: FEATURE_KEY,
    score,
    direction,
    confidence,
    sampleSize,
    evidenceWindowDays: windowDays,
  };
  return out;
};
