/**
 * KRODEX API — analytics dimensions service.
 *
 * Per PHASE3_PLAN.md §7.1 + PHASE4_PLAN.md §8, this is the
 * static catalog of dimensions the analytics read model knows
 * about. Phase 4 ships:
 *   - The schema version bump from 1.0.0 to 2.0.0 (append-only
 *     catalog rule from §2.2).
 *   - A `sourceClass` annotation per dimension, classifying
 *     each as 'A' (explicit source), 'B' (derived), or 'C'
 *     (approved product policy).
 *   - An updated scheduleNote reflecting the D-9 5-minute
 *     recompute cadence.
 *
 * The catalog is exported from `@krodex/shared` so that the
 * client SDK, the API server, and any other consumer agree on
 * the canonical key set. This service module is the API-side
 * wrapper that adds the `schemaVersion` envelope + the
 * `scheduleNote` field required by §7.1.
 *
 * The dimension list is locked at 13 to match the union in
 * `db/enums.ts` (ProgressDimension) plus a "composite"
 * placeholder for the Phase 4 composite score. The list is
 * append-only; existing keys keep their meaning.
 */

import { ANALYTICS_DIMENSIONS, KRODEX_VERSION } from '@krodex/shared';

export interface AnalyticsDimensionsResponse {
  /** Schema version. Bumped when a dimension is added, removed, or relabeled. */
  schemaVersion: string;
  /** Server build version that produced this response. */
  krodexVersion: string;
  dimensions: typeof ANALYTICS_DIMENSIONS;
  sourceTables: readonly string[];
  /**
   * The source class for each dimension key: 'A' (explicit source),
   * 'B' (derived), or 'C' (approved product policy). New in v2.0.0.
   */
  sourceClass: Readonly<Record<string, 'A' | 'B' | 'C'>>;
  scheduleNote: string;
}

/**
 * Phase 4 schema version. Bumped from '1.0.0' (Phase 3) because
 * we are now returning per-dimension `sourceClass` and the
 * `scheduleNote` text changed. Per §2.2 (append-only catalog),
 * the list of dimensions itself is unchanged; the response
 * envelope is extended.
 */
const SCHEMA_VERSION = '2.0.0';

/**
 * Per PHASE4_PLAN §8: source class per dimension. Every value
 * is documented in §8. Dimensions in the Phase 3 catalog keep
 * their original classification; 'composite' is the only
 * Phase-4-introduced key.
 */
const SOURCE_CLASS: Readonly<Record<string, 'A' | 'B' | 'C'>> = {
  // Phase 3 dimensions, classified per §8.
  tests_completed: 'A',
  study_sessions: 'A',
  errors_captured: 'A',
  errors_resolved: 'A',
  reviews_due: 'A',
  reviews_completed: 'A',
  reviews_overdue: 'A',
  streak_days: 'A',
  goals_active: 'A',
  goals_completed: 'A',
  cards_due: 'A',
  // Phase 3 cards_reviewed: kept as 'A' per §8.
  cards_reviewed: 'A',
  // Phase 4 additions.
  composite: 'C',
};

/**
 * Return the canonical dimensions catalog. The source table list
 * is the union of every dimension's sourceTables, deduplicated.
 * The scheduleNote is a human-readable string describing the
 * eventual-consistency contract for these read models.
 */
export function getAnalyticsDimensions(): AnalyticsDimensionsResponse {
  const sourceSet = new Set<string>();
  for (const d of ANALYTICS_DIMENSIONS) {
    for (const t of d.sourceTables) sourceSet.add(t);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    krodexVersion: KRODEX_VERSION,
    dimensions: ANALYTICS_DIMENSIONS,
    sourceTables: Array.from(sourceSet).sort(),
    sourceClass: SOURCE_CLASS,
    scheduleNote:
      'eventual; recomputed every 5 minutes (D-9, Class C — Approved Product Policy). Daily and weekly rollups live in analytics_daily_rollup and analytics_weekly_rollup.',
  };
}

