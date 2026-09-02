/**
 * KRODEX API — analytics dimensions service tests.
 *
 * Per PHASE3_PLAN.md §7.1, the dimensions catalog is a static
 * JSON envelope served from
 * `apps/api/src/services/analytics-dimensions.ts`. It is
 * versioned via the `KRODEX_VERSION` constant + a `schemaVersion`
 * field. The catalog must:
 *
 *  - list exactly the 13 dimensions documented in the plan
 *    (12 ProgressDimension values + the 'composite' placeholder)
 *  - every dimension's `progressDimension` matches one of the
 *    documented ProgressDimension enum values, or is null
 *    (composite)
 *  - the `sourceTables` union is non-empty and contains the
 *    core evidence table
 *  - the `schemaVersion` and `krodexVersion` are present
 *
 * These tests are the schema validation gate for the read model
 * Phase 4 will build on top of.
 */

import { describe, expect, it } from 'vitest';
import { KRODEX_VERSION } from '@krodex/shared';
import { getAnalyticsDimensions } from '../analytics-dimensions';

describe('getAnalyticsDimensions', () => {
  it('returns the documented envelope shape', () => {
    const out = getAnalyticsDimensions();
    expect(out.schemaVersion).toBeTruthy();
    expect(out.krodexVersion).toBe(KRODEX_VERSION);
    expect(Array.isArray(out.dimensions)).toBe(true);
    expect(Array.isArray(out.sourceTables)).toBe(true);
    expect(typeof out.scheduleNote).toBe('string');
    expect(out.scheduleNote.length).toBeGreaterThan(0);
  });

  it('lists 13 dimensions: 12 ProgressDimension values + composite', () => {
    const out = getAnalyticsDimensions();
    expect(out.dimensions).toHaveLength(13);
    const keys = out.dimensions.map((d) => d.key);
    // The 12 ProgressDimension values are listed in the plan.
    for (const k of [
      'syllabus_coverage',
      'test_accuracy',
      'test_attempts',
      'errors_created',
      'errors_resolved',
      'errors_reopened',
      'review_completed',
      'planner_completion',
      'planner_backlog',
      'backlog_recovered',
      'consistency',
      'practice_volume',
    ]) {
      expect(keys).toContain(k);
    }
    // Plus the composite placeholder.
    expect(keys).toContain('composite');
  });

  it('every dimension has a label, description, and a valid progressDimension', () => {
    const out = getAnalyticsDimensions();
    const allowedProgressDimensions = new Set([
      'syllabus_coverage',
      'test_accuracy',
      'test_attempts',
      'errors_created',
      'errors_resolved',
      'errors_reopened',
      'review_completed',
      'planner_completion',
      'planner_backlog',
      'backlog_recovered',
      'consistency',
      'practice_volume',
      'other',
    ]);
    for (const d of out.dimensions) {
      expect(d.label).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(Array.isArray(d.sourceTables)).toBe(true);
      if (d.key === 'composite') {
        expect(d.progressDimension).toBeNull();
      } else {
        expect(allowedProgressDimensions.has(d.progressDimension as string)).toBe(true);
      }
    }
  });

  it('sourceTables union contains progress_evidence', () => {
    const out = getAnalyticsDimensions();
    expect(out.sourceTables).toContain('progress_evidence');
  });

  it('all dimension keys are unique', () => {
    const out = getAnalyticsDimensions();
    const seen = new Set<string>();
    for (const d of out.dimensions) {
      expect(seen.has(d.key)).toBe(false);
      seen.add(d.key);
    }
  });
});
