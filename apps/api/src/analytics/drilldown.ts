/**
 * KRODEX API — analytics drill-down service.
 *
 * Per PHASE4_PLAN.md §15, the `drillDown` block on every
 * dimension response carries the source-entity IDs that the
 * UI can use to navigate from a metric to its supporting
 * records. The contract is Class A — TRD §18:737-740:
 *
 *   "Every insight response should include source entity IDs
 *   or query parameters sufficient for the UI to navigate to
 *   supporting records."
 *
 * The shape is the canonical `{ metricName: { numeratorIds,
 * denominatorIds } }` map from the plan. The IDs are real
 * UUIDs from the source tables — the `progress_evidence`
 * `ref_id` values for the relevant rows. This module is
 * pure / deterministic.
 */

export interface DrillDownIds {
  /** Source-row IDs contributing to the numerator. */
  numeratorIds: readonly string[];
  /** Source-row IDs contributing to the denominator. */
  denominatorIds: readonly string[];
}

export interface DrillDown {
  /** Map of metric key -> { numeratorIds, denominatorIds }. */
  [metricKey: string]: DrillDownIds;
}

/**
 * Build the drill-down block from raw evidence rows. Pure.
 *
 * `rows` is the per-day evidence relevant to the metric;
 * `numerator` is the set of `ref_id`s that contributed to the
 * numerator of the metric; `denominator` is the set of
 * `ref_id`s that contributed to the denominator.
 *
 * Returns the canonical DrillDown shape, single-keyed by
 * `metricName`.
 */
export function buildDrillDown(
  metricName: string,
  numeratorIds: readonly string[],
  denominatorIds: readonly string[],
): DrillDown {
  return {
    [metricName]: {
      numeratorIds: dedupe(numeratorIds),
      denominatorIds: dedupe(denominatorIds),
    },
  };
}

function dedupe(xs: readonly string[]): readonly string[] {
  return Array.from(new Set(xs));
}
