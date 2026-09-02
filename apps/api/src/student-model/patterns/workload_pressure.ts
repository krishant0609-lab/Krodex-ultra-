/**
 * KRODEX — workload-pressure pattern module (Phase 5, §25.5).
 *
 * The PRD keys this pattern on `planner_tasks` rows. The
 * canonical signal is the (active + in_progress) backlog
 * versus completed-task throughput. The score is the active
 * backlog as a share of the largest backlog ever observed in
 * the window — high score = high pressure (a lot of open
 * work).
 *
 * Formula (PRD §25.5):
 *   active_count    = count of status in ('active','in_progress') in window
 *   completed_count = count of status='completed' in window
 *   max_seen        = max(active_count) seen in any single day in window
 *   pressure_score  = clamp(active_count / max_seen, 0, 1)
 *   direction       = trend(active_count daily)
 *   sampleSize      = active_count + completed_count
 *   confidence      = classifySampleSize(sampleSize)
 *
 * Fallback: when planner_tasks has fewer than 3 rows in the
 * window, the PRD §25.5 fallback is "review_schedules
 * scheduled count as workload proxy". The orchestrator
 * passes both arrays; the pattern module itself picks.
 */

import { classifySampleSize } from '../../analytics/thresholds';
import type { TrendPoint } from '../../analytics/trend';
import type { StudentModelFeatureValue } from '@krodex/shared';

import type { FeatureOutput, PatternInput } from '../types';
import { clamp01, dayKey, directionFor, emptyOutput } from './_helpers';

export const FEATURE_KEY = 'workload_pressure_score' as const;

/** Threshold below which we fall back to review_schedules. */
const FALLBACK_TASK_THRESHOLD = 3;

export const compute: PatternCompute_async = async (input: PatternInput) => {
  const { evidence, windowDays } = input;
  const tasks = evidence.plannerTasks;
  const reviews = evidence.reviewSchedules;

  // Fallback path: tasks table sparse, derive pressure from
  // the count of scheduled reviews in the window.
  if (tasks.length < FALLBACK_TASK_THRESHOLD) {
    return computeFromReviews(reviews, windowDays);
  }

  const active = tasks.filter(
    (r) => r.status === 'active' || r.status === 'in_progress',
  );
  const completed = tasks.filter((r) => r.status === 'completed');

  // Per-day active count for "max seen" and trend.
  const perDay = new Map<string, number>();
  for (const t of tasks) {
    if (t.status !== 'active' && t.status !== 'in_progress') continue;
    const key = dayKey(t.created_at);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  let maxSeen = 0;
  for (const n of perDay.values()) {
    if (n > maxSeen) maxSeen = n;
  }
  const activeCount = active.length;
  const pressureScore = maxSeen > 0 ? clamp01(activeCount / maxSeen) : 0;

  const series: TrendPoint[] = [];
  for (const [day, n] of perDay) series.push({ day, value: n });
  const direction = directionFor(series);

  const sampleSize = active.length + completed.length;
  const out: StudentModelFeatureValue & { featureKey: typeof FEATURE_KEY } = {
    featureKey: FEATURE_KEY,
    score: pressureScore,
    direction,
    confidence: classifySampleSize(sampleSize),
    sampleSize,
    evidenceWindowDays: windowDays,
  };
  return out;
};

function computeFromReviews(
  reviews: ReadonlyArray<{ status: string; due_date: string }>,
  windowDays: number,
): FeatureOutput<typeof FEATURE_KEY> {
  if (reviews.length === 0) {
    return emptyOutput(FEATURE_KEY, windowDays);
  }
  const scheduled = reviews.filter((r) => r.status === 'scheduled').length;
  const perDay = new Map<string, number>();
  for (const r of reviews) {
    if (r.status !== 'scheduled') continue;
    const key = dayKey(r.due_date);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  let maxSeen = 0;
  for (const n of perDay.values()) if (n > maxSeen) maxSeen = n;
  const pressureScore = maxSeen > 0 ? clamp01(scheduled / maxSeen) : 0;
  const series: TrendPoint[] = [];
  for (const [day, n] of perDay) series.push({ day, value: n });
  const out: StudentModelFeatureValue & { featureKey: typeof FEATURE_KEY } = {
    featureKey: FEATURE_KEY,
    score: pressureScore,
    direction: directionFor(series),
    confidence: classifySampleSize(scheduled),
    sampleSize: scheduled,
    evidenceWindowDays: windowDays,
  };
  return out;
}

type PatternCompute_async = (input: PatternInput) => Promise<FeatureOutput<typeof FEATURE_KEY>>;
