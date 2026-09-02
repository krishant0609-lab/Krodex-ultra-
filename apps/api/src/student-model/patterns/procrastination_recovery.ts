/**
 * KRODEX — procrastination + recovery pattern module (Phase 5, §25.2).
 *
 * The PRD groups these two features together because they share
 * the same evidence source (`review_schedules` rows in the
 * window) and are two views of the same behavior:
 *
 *   procrastination_score  — fraction of due reviews that were missed
 *                            (lower = better)
 *   recovery_score         — when overdue reviews ARE eventually
 *                            completed, how quickly (lower delay = better)
 *
 * Formula (PRD §25.2):
 *   late_count    = count where status='missed' in window
 *   total_count   = count where status in ('scheduled','missed') in window
 *   delay_days    = average of greatest(0, completed_at - due_date) for
 *                   completed rows (capped at 30 days each)
 *   procrastination = late_count / total_count     (0..1; 0 = no misses)
 *   recovery        = 1 - clamp(avg_delay / 30)   (0..1; 1 = prompt)
 *   direction       = half-vs-half trend on (a) per-day miss rate for
 *                     procrastination, (b) per-day avg delay for recovery.
 *
 * The two features have independent confidence because a user
 * can have many "scheduled" rows (good sample for procrastination)
 * but very few actually-completed overdue rows (sparse sample
 * for recovery). Per D-2 the two confidences may legitimately
 * differ.
 */

import { classifySampleSize } from '../../analytics/thresholds';
import type { TrendPoint } from '../../analytics/trend';
import type { StudentModelFeatureValue } from '@krodex/shared';

import type { FeatureOutput, PatternInput, ReviewScheduleRow } from '../types';
import { clamp01, dayKey, directionFor, emptyOutput } from './_helpers';

const PROCRASTINATION_KEY = 'procrastination_score' as const;
const RECOVERY_KEY = 'recovery_score' as const;

/** Maximum delay we count toward recovery (PRD §25.2 — 30 days). */
const MAX_DELAY_DAYS = 30;

export interface ProcrastinationRecoveryOutput {
  procrastination: FeatureOutput<typeof PROCRASTINATION_KEY>;
  recovery: FeatureOutput<typeof RECOVERY_KEY>;
}

/** Compute both scores over the same evidence. */
export async function compute(
  input: PatternInput,
): Promise<ProcrastinationRecoveryOutput> {
  const { evidence, windowDays } = input;
  const sched = evidence.reviewSchedules;

  if (sched.length === 0) {
    return {
      procrastination: emptyOutput(PROCRASTINATION_KEY, windowDays),
      recovery: emptyOutput(RECOVERY_KEY, windowDays),
    };
  }

  // procrastination denominators
  const lateCount = sched.filter((r) => r.status === 'missed').length;
  const denomForProcrastination = sched.filter(
    (r) => r.status === 'missed' || r.status === 'scheduled',
  ).length;
  const procrastinationScore =
    denomForProcrastination > 0 ? clamp01(lateCount / denomForProcrastination) : 0;

  // recovery — only completed rows with a real delay are informative
  const completed = sched.filter(
    (r): r is ReviewScheduleRow & { review_date: string } =>
      r.status === 'completed' && typeof r.review_date === 'string',
  );
  const delaysDays: number[] = [];
  for (const r of completed) {
    const due = Date.parse(r.due_date);
    const done = Date.parse(r.review_date);
    if (!Number.isFinite(due) || !Number.isFinite(done)) continue;
    const delayMs = Math.max(0, done - due);
    const days = delayMs / 86_400_000;
    if (days <= MAX_DELAY_DAYS) delaysDays.push(days);
  }
  const avgDelay =
    delaysDays.length > 0 ? delaysDays.reduce((s, v) => s + v, 0) / delaysDays.length : 0;
  const recoveryScore = clamp01(1 - avgDelay / MAX_DELAY_DAYS);

  // directions: per-day miss-rate for procrastination,
  // per-day avg delay for recovery.
  const missByDay = new Map<string, { late: number; due: number }>();
  for (const r of sched) {
    if (r.status !== 'missed' && r.status !== 'scheduled') continue;
    const key = dayKey(r.due_date);
    const acc = missByDay.get(key) ?? { late: 0, due: 0 };
    acc.due += 1;
    if (r.status === 'missed') acc.late += 1;
    missByDay.set(key, acc);
  }
  const procrastinationSeries: TrendPoint[] = [];
  for (const [day, { late, due }] of missByDay) {
    if (due > 0) procrastinationSeries.push({ day, value: late / due });
  }
  const procrastinationDirection = directionFor(procrastinationSeries);

  const delayByDay = new Map<string, number[]>();
  for (const r of completed) {
    const due = Date.parse(r.due_date);
    const done = Date.parse(r.review_date);
    if (!Number.isFinite(due) || !Number.isFinite(done)) continue;
    const days = Math.max(0, Math.min(MAX_DELAY_DAYS, (done - due) / 86_400_000));
    const key = dayKey(r.review_date);
    const arr = delayByDay.get(key) ?? [];
    arr.push(days);
    delayByDay.set(key, arr);
  }
  const recoverySeries: TrendPoint[] = [];
  for (const [day, arr] of delayByDay) {
    if (arr.length === 0) continue;
    recoverySeries.push({ day, value: arr.reduce((s, v) => s + v, 0) / arr.length });
  }
  const recoveryDirection = directionFor(recoverySeries);

  // Sample sizes:
  //   procrastination: number of days with a due review (miss or scheduled)
  //   recovery:        number of distinct days with a completed overdue review
  // The D-2 ladder applies to the count of "evidence units", which
  // we model as distinct days for both (matches the trend window).
  const procrastinationSampleSize = procrastinationSeries.length;
  const recoverySampleSize = recoverySeries.length;

  const procrastination: StudentModelFeatureValue & { featureKey: typeof PROCRASTINATION_KEY } = {
    featureKey: PROCRASTINATION_KEY,
    score: procrastinationScore,
    direction: procrastinationDirection,
    confidence: classifySampleSize(procrastinationSampleSize),
    sampleSize: procrastinationSampleSize,
    evidenceWindowDays: windowDays,
  };
  const recovery: StudentModelFeatureValue & { featureKey: typeof RECOVERY_KEY } = {
    featureKey: RECOVERY_KEY,
    score: recoveryScore,
    direction: recoveryDirection,
    confidence: classifySampleSize(recoverySampleSize),
    sampleSize: recoverySampleSize,
    evidenceWindowDays: windowDays,
  };
  return { procrastination, recovery };
}
