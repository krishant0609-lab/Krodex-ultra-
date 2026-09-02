/**
 * KRODEX API — analytics dimension explain service.
 *
 * Per PHASE4_PLAN.md §15, `GET /analytics/dashboards/dimension/:key/explain`
 * returns the explanation block for one dimension. The response
 * shape is a strict subset of the dimension dashboard
 * (no series, no drill-down IDs), optimized for "tooltip" / "why
 * is this number X?" UIs.
 *
 * The explanation is fully deterministic (D-10.b — Class A
 * fallback plus deterministic per-metric templates). The
 * `templateVersion` field is a string constant from the
 * `explanations` module (D-10) so a future revision can be
 * detected client-side.
 *
 * Class A: the per-metric policy that an explanation must
 * exist for every metric response (TRD §18:737-740). Class C —
 * Approved Product Policy: the template version string and
 * the per-metric template strings.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TrendDirection } from '../analytics/trend';
import type { EvidenceThreshold } from '../analytics/thresholds';
import { classifySampleSize } from '../analytics/thresholds';
import { explain, type Explanation } from '../analytics/explanations';
import {
  getDimensionDashboard,
  type DimensionKey,
} from './analytics-dimension-dashboard';

export interface DimensionExplain {
  key: DimensionKey;
  window: { label: '7 days'; since: string; until: string };
  value: number | null;
  trend: TrendDirection;
  evidenceThreshold: EvidenceThreshold;
  explanation: Explanation;
}

/**
 * Read the explain block for a single dimension. The read is
 * a strict subset of the dimension dashboard; we delegate the
 * heavy read to `getDimensionDashboard` and shape the response
 * here so the route stays thin.
 */
export async function getDimensionExplain(
  client: SupabaseClient,
  userId: string,
  key: DimensionKey,
  now: Date = new Date(),
): Promise<DimensionExplain> {
  const dash = await getDimensionDashboard(client, userId, key, now);
  // Recompute the threshold from the dashboard's sampleSize so
  // the explain block is self-consistent without an extra read.
  const evidenceThreshold: EvidenceThreshold = classifySampleSize(
    dash.metric.sampleSize,
  );
  const explanation: Explanation = explain({
    dimensionKey: key,
    metric: dash.metric,
    windowLabel: '7 days',
    trend: dash.trend,
  });
  return {
    key,
    window: dash.window,
    value: dash.metric.value,
    trend: dash.trend,
    evidenceThreshold,
    explanation,
  };
}
