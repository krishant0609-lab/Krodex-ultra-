/**
 * KRODEX — shared helpers for the six pattern modules.
 *
 * Each module still owns its own formula (the score, the
 * direction, the sample-size definition), but the boring
 * bookkeeping is here:
 *
 *   - clamp01: keep a numeric score inside [0, 1]
 *   - isFiniteNumber: reject NaN / Infinity defensively
 *   - distinctDays: bucket timestamps to YYYY-MM-DD keys
 *   - emptyOutput: build a FeatureOutput for "no evidence"
 *   - directionFor: half-vs-half trend with the 0.05 threshold
 *
 * These helpers do NOT know about any specific table; they
 * are pure utility functions that take numbers and dates and
 * return numbers and dates. The pattern modules are responsible
 * for picking the right "value" series to feed them.
 */

import { classifySampleSize } from '../../analytics/thresholds';
import { trendDirection, type TrendPoint } from '../../analytics/trend';

/**
 * Clamp a number into [0, 1]. NaN and Infinity are treated as 0
 * (defensive — pattern modules should never produce non-finite
 * values, but if they do we don't want to corrupt the snapshot).
 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** True for finite, non-NaN numbers. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Bucket an ISO timestamp to a YYYY-MM-DD day key (UTC). The
 * pattern modules feed these into trendDirection, which requires
 * distinct day counts.
 */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Group rows by their UTC day key. Returns a Map from day -> rows.
 * Empty input yields an empty Map.
 */
export function groupByDay<T extends { captured_at?: string; due_date?: string; created_at?: string; updated_at?: string }>(
  rows: readonly T[],
  field: 'captured_at' | 'due_date' | 'created_at' | 'updated_at' = 'captured_at',
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const v = r[field];
    if (typeof v !== 'string' || v.length < 10) continue;
    const key = dayKey(v);
    const bucket = out.get(key);
    if (bucket) bucket.push(r);
    else out.set(key, [r]);
  }
  return out;
}

/**
 * Build a FeatureOutput for the "no evidence in window" case.
 * Score is 0 (worst), direction is insufficient_data, confidence
 * is 'limited' (D-2 ladder for sampleSize=0).
 */
export function emptyOutput<KEY extends import('@krodex/shared').StudentModelFeatureKey>(
  featureKey: KEY,
  windowDays: number,
): import('../types').FeatureOutput<KEY> {
  return {
    featureKey,
    score: 0,
    direction: 'insufficient_data',
    confidence: classifySampleSize(0),
    sampleSize: 0,
    evidenceWindowDays: windowDays,
  };
}

/**
 * Build a trend direction from a per-day value series. Returns
 * 'stable' when the value series is non-empty but does not
 * meet the 3-distinct-day threshold (the trend policy collapses
 * such series to 'insufficient_data' — this helper is a thin
 * pass-through so callers don't have to import the analytics
 * module directly).
 */
export function directionFor(series: readonly TrendPoint[]): 'improving' | 'declining' | 'stable' | 'insufficient_data' {
  return trendDirection(series) as 'improving' | 'declining' | 'stable' | 'insufficient_data';
}
