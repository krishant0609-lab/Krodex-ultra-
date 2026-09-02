/**
 * KRODEX — review-behavior pattern module (Phase 5, §25.4).
 *
 * Distinct from procrastination/recovery (which keys on
 * *missed* reviews). Review-behavior keys on the *due* vs
 * *completed* completion rate of reviews, and on the timing
 * delta between `due_date` and `review_date` for completed
 * reviews.
 *
 * Formula (PRD §25.4):
 *   scheduled_count  = count of status='scheduled' in window
 *   completed_count  = count of status='completed' with review_date NOT NULL
 *   compliance_score = completed_count / (completed_count + missed_count)
 *                       — fraction of closed-out reviews that were
 *                       completed (rather than missed) on time
 *   timing_score     = 1 - clamp(avg_abs(review_date - due_date) / max_delay, 0, 1)
 *                       — on-time reviews score close to 1.0
 *   direction        = trend(compliance_score daily)
 *   sampleSize       = completed_count
 *   confidence       = classifySampleSize(completed_count)
 *
 * Why "scheduled" is excluded from the timing_score: a
 * review still in the future is not late, but it is also not
 * "on time" — we have no signal yet. Only completed reviews
 * are informative for timing. (The compliance_score still
 * uses scheduled + missed + completed as the denominator.)
 */

import { classifySampleSize } from '../../analytics/thresholds';
import type { TrendPoint } from '../../analytics/trend';
import type { StudentModelFeatureValue } from '@krodex/shared';

import type { FeatureOutput, PatternInput, ReviewScheduleRow } from '../types';
import { clamp01, dayKey, directionFor, emptyOutput } from './_helpers';

export const FEATURE_KEY = 'review_compliance_score' as const;

/** Cap on timing delay (days). Above this the timing score is 0. */
const MAX_TIMING_DELAY_DAYS = 14;

export const compute: PatternCompute_async = async (input: PatternInput) => {
  const { evidence, windowDays } = input;
  const sched = evidence.reviewSchedules;
  if (sched.length === 0) {
    return emptyOutput(FEATURE_KEY, windowDays);
  }
  const completed = sched.filter(
    (r): r is ReviewScheduleRow & { review_date: string } =>
      r.status === 'completed' && typeof r.review_date === 'string',
  );
  const missed = sched.filter((r) => r.status === 'missed').length;

  const completedCount = completed.length;
  const closedOut = completedCount + missed;
  const complianceScore = closedOut > 0 ? clamp01(completedCount / closedOut) : 0;

  // Timing: per-completed-review delay (days, capped at MAX).
  const delays: number[] = [];
  for (const r of completed) {
    const due = Date.parse(r.due_date);
    const done = Date.parse(r.review_date);
    if (!Number.isFinite(due) || !Number.isFinite(done)) continue;
    const days = Math.abs(done - due) / 86_400_000;
    delays.push(Math.min(MAX_TIMING_DELAY_DAYS, Math.max(0, days)));
  }
  const avgDelay = delays.length > 0 ? delays.reduce((s, v) => s + v, 0) / delays.length : 0;
  const timingScore = clamp01(1 - avgDelay / MAX_TIMING_DELAY_DAYS);

  // Combined score: average of compliance and timing. Both are
  // bounded 0..1. The PRD does not specify weights, so equal
  // weighting is the neutral default.
  const score = clamp01((complianceScore + timingScore) / 2);

  // Per-day compliance for the trend. The "day" is the
  // review_date (the day the student actually engaged).
  const perDay = new Map<string, { completed: number; closed: number }>();
  for (const r of sched) {
    if (r.status !== 'completed' && r.status !== 'missed') continue;
    const day = r.status === 'completed' && typeof r.review_date === 'string'
      ? dayKey(r.review_date)
      : dayKey(r.due_date);
    const acc = perDay.get(day) ?? { completed: 0, closed: 0 };
    acc.closed += 1;
    if (r.status === 'completed') acc.completed += 1;
    perDay.set(day, acc);
  }
  const series: TrendPoint[] = [];
  for (const [day, { completed: c, closed }] of perDay) {
    if (closed > 0) series.push({ day, value: c / closed });
  }
  const direction = directionFor(series);

  const out: StudentModelFeatureValue & { featureKey: typeof FEATURE_KEY } = {
    featureKey: FEATURE_KEY,
    score,
    direction,
    confidence: classifySampleSize(completedCount),
    sampleSize: completedCount,
    evidenceWindowDays: windowDays,
  };
  return out;
};

type PatternCompute_async = (input: PatternInput) => Promise<FeatureOutput<typeof FEATURE_KEY>>;
