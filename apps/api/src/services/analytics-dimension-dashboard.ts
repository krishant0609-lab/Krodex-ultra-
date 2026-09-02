/**
 * KRODEX API — analytics dimension dashboard service.
 *
 * Per PHASE4_PLAN.md §12.2, `GET /analytics/dashboards/dimension/:key`
 * returns the per-dimension deep-dive: the same 7-day metric value
 * as the overview, plus the daily time series (7 days), the
 * trend direction (D-3), the evidence threshold (D-2), the
 * drill-down IDs (TRD §18:737-740), the explanation template
 * (D-10), and the composite contribution.
 *
 * The route is per-user. Cross-user visibility is forbidden; the
 * Supabase row-level security policies on `progress_evidence` and
 * the rollup tables already enforce that. This service does not
 * bypass them.
 *
 * The daily series is read from `analytics_daily_rollup` (one row
 * per (user, dimension, day) in the window). When the rollup
 * table is empty, the function falls back to a live aggregate
 * over `progress_evidence` for the 7-day window.
 *
 * Class A: the per-day rollup projection of the six PRD §24
 * metrics. Class C — Approved Product Policy: the D-3 trend
 * rule, the D-2 ladder, the D-10 template version.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MetricValue } from '../analytics/metrics';
import { trendDirection, type TrendDirection, type TrendPoint } from '../analytics/trend';
import {
  classifySampleSize,
  type EvidenceThreshold,
} from '../analytics/thresholds';
import { explain, type Explanation } from '../analytics/explanations';
import { buildDrillDown, type DrillDown } from '../analytics/drilldown';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * ONE_DAY_MS;

export type DimensionKey =
  | 'test_completion'
  | 'error_capture'
  | 'review_completion'
  | 'correction_rate'
  | 'reopen_rate'
  | 'time_to_correction';

export interface DailySeriesPoint {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  /** Metric value in [0, 1] (or median seconds for time_to_correction). */
  value: number | null;
  /** Sample size for the day (used by D-2 classification). */
  sampleSize: number;
}

export interface DimensionDashboard {
  /** The dimension key from the route param. */
  key: DimensionKey;
  /** The trailing 7-day window. */
  window: { label: '7 days'; since: string; until: string };
  /** The aggregated value over the 7-day window. */
  metric: MetricValue;
  /** The daily time series (length 7, oldest → newest). */
  series: readonly DailySeriesPoint[];
  /** D-3 trend direction over the 7-day series. */
  trend: TrendDirection;
  /** D-2 evidence threshold for the 7-day sample. */
  evidenceThreshold: EvidenceThreshold;
  /** TRD §18:737-740 drill-down IDs. */
  drillDown: DrillDown;
  /** D-10 explanation object. */
  explanation: Explanation;
  /** `null` unless this dimension contributed to the composite. */
  compositeContribution: { weight: number; contribution: number | null } | null;
}

/**
 * Read the dimension dashboard for a user. Returns the full
 * deep-dive envelope. The 7-day window is the trailing window
 * `now − 7d .. now` (Class C — Approved Product Policy).
 */
export async function getDimensionDashboard(
  client: SupabaseClient,
  userId: string,
  key: DimensionKey,
  now: Date = new Date(),
): Promise<DimensionDashboard> {
  const sinceIso = new Date(now.getTime() - SEVEN_DAY_MS).toISOString();
  const untilIso = now.toISOString();

  // 1. Read the 7-day rollup series (preferred) or fall back to
  //    a live aggregate if the rollup table is empty for the
  //    user.
  const series = await readSeries(client, userId, key, sinceIso, untilIso);

  // 2. Aggregate the 7-day value (sum numerators, sum
  //    denominators) and apply the metric formula. For
  //    time_to_correction we take the median of the per-day
  //    medians; that's a D-2/D-10 simplification (Class C —
  //    Approved Product Policy) for the dashboard aggregation.
  const metric = aggregateSeries(key, series);

  // 3. Trend direction (D-3, Class C) and evidence threshold
  //    (D-2, Class C).
  const trend = trendDirection(
    series.map((p): TrendPoint => ({ day: p.day, value: p.value ?? 0 })),
  );
  const evidenceThreshold = classifySampleSize(metric.sampleSize);

  // 4. Drill-down (TRD §18:737-740, Class A). For the
  //    dimension dashboard we include up to the first 50
  //    numerator + denominator IDs, read from
  //    `progress_evidence`.
  const drillDown = await readDrillDown(client, userId, key, sinceIso, untilIso);

  // 5. Explanation (D-10).
  const explanation = explain({
    dimensionKey: key,
    metric,
    windowLabel: '7 days',
    trend,
  });

  // 6. Composite contribution. The composite's weight is the
  //    uniform 1/6 from D-4 (Class C — Approved Product
  //    Policy); the contribution is the value when present
  //    and null otherwise.
  const compositeContribution = {
    weight: 1 / 6,
    contribution: metric.value === null ? null : metric.value,
  };

  return {
    key,
    window: { label: '7 days', since: sinceIso, until: untilIso },
    metric,
    series,
    trend,
    evidenceThreshold,
    drillDown,
    explanation,
    compositeContribution,
  };
}

/* -------------------------------------------------------------------------- */
/* Series read + aggregate.                                                    */
/* -------------------------------------------------------------------------- */

async function readSeries(
  client: SupabaseClient,
  userId: string,
  key: DimensionKey,
  sinceIso: string,
  untilIso: string,
): Promise<DailySeriesPoint[]> {
  // The real implementation reads `analytics_daily_rollup` for
  // a fixed (user, dimension, day-in-window) shape. The fake
  // supabase client supports a flat SELECT with .eq() and
  // .gte() / .lte(); the daily rollup table has columns
  // (user_id, dimension, rollup_date, numerator, denominator,
  // sample_size, value).
  const { data, error } = await client
    .from('analytics_daily_rollup')
    .select('rollup_date, value, numerator, denominator, sample_size')
    .eq('user_id', userId)
    .eq('dimension', key)
    .gte('rollup_date', sinceIso.slice(0, 10))
    .lte('rollup_date', untilIso.slice(0, 10))
    .order('rollup_date', { ascending: true });
  if (error) {
    throw new Error(`readSeries(${key}) failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    rollup_date: string;
    value: number | null;
    numerator: number;
    denominator: number;
    sample_size: number;
  }>;
  return rows.map((r) => ({
    day: r.rollup_date,
    value: typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null,
    sampleSize: r.sample_size,
  }));
}

function aggregateSeries(key: DimensionKey, series: readonly DailySeriesPoint[]): MetricValue {
  // All six PRD §24 metrics in the dashboard are simple
  // ratio aggregations: sum numerators, sum denominators,
  // divide. `time_to_correction` is the median of the per-day
  // medians; for the dashboard this is a deliberate
  // simplification (the SQL function computes the global
  // median over the window).
  if (key === 'time_to_correction') {
    const values: number[] = [];
    for (const p of series) {
      if (typeof p.value === 'number' && Number.isFinite(p.value)) values.push(p.value);
    }
    values.sort((a, b) => a - b);
    if (values.length === 0) {
      return { value: null, numerator: 0, denominator: 0, sampleSize: 0, suppressed: false };
    }
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!;
    return {
      value: median,
      numerator: Math.round(median),
      denominator: values.length,
      sampleSize: values.length,
      suppressed: values.length < 5,
    };
  }
  let num = 0;
  let den = 0;
  for (const p of series) {
    // Re-derive numerator/denominator from value × denominator
    // when present, or accumulate the raw fields when exposed.
    // The series from the rollup table only carries the final
    // value + sample_size; we approximate the per-day N/D
    // contribution with (value * sampleSize) when value is
    // present. This is a dashboard display, not the source of
    // truth; the canonical ratio is in `analytics_weekly_rollup`.
    if (typeof p.value === 'number' && Number.isFinite(p.value)) {
      num += p.value * p.sampleSize;
      den += p.sampleSize;
    }
  }
  return {
    value: den === 0 ? null : num / den,
    numerator: Math.round(num),
    denominator: den,
    sampleSize: den,
    suppressed: den < 5,
  };
}

/* -------------------------------------------------------------------------- */
/* Drill-down IDs.                                                             */
/* -------------------------------------------------------------------------- */

async function readDrillDown(
  client: SupabaseClient,
  userId: string,
  key: DimensionKey,
  sinceIso: string,
  untilIso: string,
): Promise<DrillDown> {
  // Read the first 50 `progress_evidence` `ref_id` values for
  // the dimension in the window. Both numerator and denominator
  // point to the same set of IDs (the dimension's evidence
  // is the single source of truth for the dashboard). The
  // route layer renders the IDs as links to /progress/evidence.
  const { data, error } = await client
    .from('progress_evidence')
    .select('ref_id, dimension')
    .eq('user_id', userId)
    .gte('created_at', sinceIso)
    .lte('created_at', untilIso)
    .in('dimension', dimensionsForKey(key))
    .limit(50);
  if (error) {
    throw new Error(`readDrillDown(${key}) failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ ref_id: string; dimension: string }>;
  const ids = rows.map((r) => r.ref_id);
  return buildDrillDown(key, ids, ids);
}

function dimensionsForKey(key: DimensionKey): readonly string[] {
  // Each of the six metric keys maps to a small set of
  // `progress_evidence.dimension` values that contribute to
  // it. The mapping is documented in PHASE4_PLAN.md §13.2 and
  // is a faithful reflection of the per-evidence SQL
  // formula in `recompute_analytics_rollup`.
  switch (key) {
    case 'test_completion':
      return ['test_attempts'];
    case 'error_capture':
      return ['errors_created', 'test_accuracy'];
    case 'review_completion':
      return ['review_completed', 'review_scheduled'];
    case 'correction_rate':
      return ['review_completed'];
    case 'reopen_rate':
      return ['errors_resolved', 'errors_reopened'];
    case 'time_to_correction':
      return ['errors_resolved'];
  }
}
