/**
 * KRODEX — error-recurrence pattern module (Phase 5, §25.3).
 *
 * The PRD defines "recurrence" as the share of a student's
 * errors that come from their most-repeated error type. A
 * student with 10 errors, all of the same type, has a
 * recurrence score of 1.0 (the same error keeps coming back).
 * A student with 10 errors spanning 10 distinct types has a
 * score of 0.1 (errors are diverse, not recurrent).
 *
 * Formula (PRD §25.3):
 *   distinct_error_types = count(distinct error_type) in window
 *   total_errors         = count(*) in window
 *   max_recurrence       = max(count(*) per error_type) in window
 *   score                = max_recurrence / total_errors
 *                          if total_errors > 1 else null
 *   direction            = trend(total_errors per day)
 *   sampleSize           = total_errors
 *   confidence           = classifySampleSize(total_errors)
 *
 * The score is the share of errors attributable to the worst
 * type. We deliberately do NOT invert it: a low score means
 * "errors are diverse" (good — the student is not stuck on a
 * single mistake), and a high score means "stuck" (the same
 * error keeps reappearing). The PRD labels are
 * "error_recurrence_score" — high = more recurrent.
 *
 * When total_errors is 0 or 1, the recurrence ratio is
 * undefined (division by zero or no second error to compare
 * against). We collapse those to the empty envelope.
 */

import { classifySampleSize } from '../../analytics/thresholds';
import type { TrendPoint } from '../../analytics/trend';
import type { StudentModelFeatureValue } from '@krodex/shared';

import type { FeatureOutput, PatternInput } from '../types';
import { dayKey, directionFor, emptyOutput } from './_helpers';

export const FEATURE_KEY = 'error_recurrence_score' as const;

export const compute: PatternCompute_async = async (input: PatternInput) => {
  const { evidence, windowDays } = input;
  const errors = evidence.errorEntries;
  if (errors.length < 2) {
    return emptyOutput(FEATURE_KEY, windowDays);
  }
  const totalErrors = errors.length;
  const counts = new Map<string, number>();
  for (const e of errors) {
    counts.set(e.error_type, (counts.get(e.error_type) ?? 0) + 1);
  }
  let maxRecurrence = 0;
  for (const c of counts.values()) {
    if (c > maxRecurrence) maxRecurrence = c;
  }
  // maxRecurrence / totalErrors is in [1/totalErrors, 1]. A
  // well-distributed student has maxRecurrence close to 1; a
  // diverse student has maxRecurrence close to 1/totalErrors.
  const score = maxRecurrence / totalErrors;

  const errorsByDay = new Map<string, number>();
  for (const e of errors) {
    const key = dayKey(e.captured_at);
    errorsByDay.set(key, (errorsByDay.get(key) ?? 0) + 1);
  }
  const series: TrendPoint[] = [];
  for (const [day, count] of errorsByDay) {
    series.push({ day, value: count });
  }
  const direction = directionFor(series);

  const out: StudentModelFeatureValue & { featureKey: typeof FEATURE_KEY } = {
    featureKey: FEATURE_KEY,
    score,
    direction,
    confidence: classifySampleSize(totalErrors),
    sampleSize: totalErrors,
    evidenceWindowDays: windowDays,
  };
  return out;
};

// Local re-declaration of the contract to avoid pulling types
// into the file header. The orchestrator uses the exported
// `compute` function; this alias just makes the call signature
// visible at the top of the file.
type PatternCompute_async = (input: PatternInput) => Promise<FeatureOutput<typeof FEATURE_KEY>>;
