/**
 * KRODEX — Phase 4 audit-fix regression tests for the analytics
 * rollup migration (20260901164346_12_analytics_rollup.sql).
 *
 * These tests guard against recurrence of the four hard blockers
 * identified in the Phase 4 completion audit (B1/B2/B3) and the
 * Phase 4 Remediation #2 audit (B4):
 *
 *   B1. The SQL `recompute_analytics_rollup` function previously
 *       referenced `pe.observed_at`, which does not exist on the
 *       `progress_evidence` table. The authoritative column is
 *       `captured_at` (per migration 03). The function would fail
 *       on first execution against a real database. Regression:
 *       assert that the migration does NOT reference `observed_at`
 *       and DOES reference `captured_at`.
 *
 *   B2. The `time_to_correction` aggregation previously used
 *       `avg(extract(epoch from (...)))`, which is a mean. The
 *       PRD §24:948 contract is a MEDIAN. Regression: assert
 *       that the migration uses `percentile_cont(0.5) within
 *       group (order by ...)` for time-to-correction.
 *
 *   B3. The `test_completion` / `error_capture` /
 *       `review_completion` daily rollups previously stored a raw
 *       `count(*)` in `value_numeric`. The PRD §24:938/940/942
 *       contract is a RATIO. Regression: assert that the
 *       per-day value for these three metrics is computed as a
 *       ratio (numerator / denominator), not a count.
 *
 *   B4. (Phase 4 Remediation #2 — see PHASE4_REPORT §5.7.) The
 *       `days` CTE previously iterated over distinct
 *       (pe.dimension, day) pairs from progress_evidence. The
 *       dimension values there are event-level names
 *       ('test_attempts', 'errors_created', etc.) but the metric
 *       CASE branches key on metric-level names ('test_completion',
 *       'error_capture', etc.). The case always fell through to
 *       `else null` and the rollup table was never populated.
 *       Regression: assert that the `days` CTE produces
 *       metric-level dimension labels (not event-level
 *       progress_evidence dimension names), and that those labels
 *       are exactly the six PRD §24 metric names.
 *
 * Like `migrations.test.ts`, this test is OFFLINE. It does not
 * need a live database. The live-DB coverage that would
 * actually execute the SQL function is gated on LIVE_DB=1
 * (see `live.test.ts`).
 *
 * If you add a new metric, update the ratios-by-dimension list
 * and the median-by-dimension list to match the new contract.
 */

import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..');
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20260901164346_12_analytics_rollup.sql',
);

function readMigration(): string {
  if (!existsSync(migrationPath)) {
    throw new Error(`Migration file missing: ${migrationPath}`);
  }
  return readFileSync(migrationPath, 'utf8');
}

// Slice of the migration containing the recompute function body.
// We extract the function definition so the assertions below are
// scoped to the recompute logic, not to the comments at the top of
// the file.
function extractFunctionBody(sql: string): string {
  const start = sql.indexOf('create or replace function public.recompute_analytics_rollup');
  if (start < 0) {
    throw new Error('recompute_analytics_rollup not found in migration');
  }
  // The function body ends at the next `$$;` after the `as $$` opener.
  const opener = sql.indexOf('as $$', start);
  if (opener < 0) throw new Error('`as $$` opener not found');
  const closer = sql.indexOf('$$;', opener);
  if (closer < 0) throw new Error('`$$;` closer not found');
  return sql.slice(start, closer + 3);
}

describe('Phase 4 analytics rollup migration — audit-fix regression (B1/B2/B3)', () => {
  describe('B1 — observed_at does not exist on progress_evidence; use captured_at', () => {
    it('the function body does NOT reference the non-existent observed_at column in code', () => {
      const body = extractFunctionBody(readMigration());
      // The AUDIT-FIX comment block at the top of the function body
      // legitimately mentions the string `observed_at` in prose to
      // document the B1 fix; that text is documentation, not code.
      // The regression we are guarding against is the buggy code form
      // `pe.observed_at` / `pe2.observed_at` / `pe_created.observed_at`
      // which references a column that does not exist on
      // `progress_evidence`. Assert the SQL does not qualify
      // `observed_at` against any evidence-alias.
      expect(body).not.toMatch(/\bpe(?:2|_created)?\.observed_at\b/);
      // Also assert no bare alias.observed_at reference exists in
      // code (a non-aliased `observed_at` would also be invalid).
      const lines = body.split('\n');
      const codeLines = lines.filter(
        (l) => !/^\s*--/.test(l) && !/^\s*$/.test(l),
      );
      for (const line of codeLines) {
        expect(line).not.toMatch(/\bobserved_at\b/);
      }
    });

    it('the function body references the authoritative captured_at column on progress_evidence', () => {
      const body = extractFunctionBody(readMigration());
      // The function should filter on captured_at both in the
      // `days` CTE (the distinct (dimension, day) pairs) and in
      // every per-metric subquery. We assert a minimum count.
      const matches = body.match(/\bpe(?:2|_created)?\.captured_at\b/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('B2 — time_to_correction must be the MEDIAN, not the mean', () => {
    it('the function uses percentile_cont(0.5) for the time_to_correction value', () => {
      const body = extractFunctionBody(readMigration());
      // The median aggregation appears at least twice: once for
      // value_numeric and once for the (rounded) numerator.
      const matches = body.match(/percentile_cont\(0\.5\)\s+within\s+group/mg) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('the function does NOT use avg(extract(epoch from ...)) for time-to-correction', () => {
      const body = extractFunctionBody(readMigration());
      // The previous buggy SQL wrapped the delta extraction in
      // `avg(...)`. A regression here would re-introduce the mean.
      expect(body).not.toMatch(/avg\s*\(\s*extract\s*\(\s*epoch\s+from/i);
    });
  });

  describe('B3 — test_completion, error_capture, review_completion must store RATIOS', () => {
    it('the test_completion daily value is the ratio submitted/started, not a count', () => {
      const body = extractFunctionBody(readMigration());
      // Find the test_completion case branch. The value must be a
      // ratio (1.0::numeric when there are attempts, NULL when not),
      // NOT a `count(*)` expression.
      // Match the `when 'test_completion' then` branch.
      const re = /when\s+'test_completion'\s+then([\s\S]*?)(?=when\s+'error_capture')/i;
      const branch = body.match(re);
      expect(branch, 'test_completion branch not found').toBeTruthy();
      expect(branch![1]).not.toMatch(/count\s*\(\s*\*\s*\)/);
    });

    it('the error_capture daily value is the ratio captured/eligible, not a count', () => {
      const body = extractFunctionBody(readMigration());
      const re = /when\s+'error_capture'\s+then([\s\S]*?)(?=when\s+'review_completion')/i;
      const branch = body.match(re);
      expect(branch, 'error_capture branch not found').toBeTruthy();
      // The value must contain at least one division `/` operator.
      expect(branch![1]).toMatch(/\//);
    });

    it('the review_completion daily value is the ratio completed/due, not a count', () => {
      const body = extractFunctionBody(readMigration());
      const re = /when\s+'review_completion'\s+then([\s\S]*?)(?=when\s+'correction_rate')/i;
      const branch = body.match(re);
      expect(branch, 'review_completion branch not found').toBeTruthy();
      expect(branch![1]).toMatch(/\//);
    });

    it('the weekly aggregation uses sum(numerator)/sum(denominator) for all five ratio metrics', () => {
      const body = extractFunctionBody(readMigration());
      // Find the weekly aggregation case expression. The new code
      // makes the default branch (everything except
      // time_to_correction) use the ratio aggregation.
      const re = /case\s+when\s+w\.dimension\s*=\s*'time_to_correction'\s+then[\s\S]*?else([\s\S]*?)\s*end\s+as\s+value_numeric/i;
      const weeklyValueExpr = body.match(re);
      expect(weeklyValueExpr, 'weekly value_numeric case not found').toBeTruthy();
      // The else branch must contain the ratio formula.
      expect(weeklyValueExpr![1]).toMatch(/sum\s*\(\s*dr\.numerator\s*\)\s*\/\s*sum\s*\(\s*dr\.denominator\s*\)/i);
    });
  });

  describe('B4 — days CTE must emit metric-level rollup labels, not event-level evidence dimensions', () => {
    // Per PHASE4_PLAN §2 / §11.3 and PHASE4_REPORT §5.7, the
    // `progress_evidence` table is the canonical event-level
    // evidence stream. The six PRD §24 metric names live ONLY in
    // the rollup table as aggregation labels. The function must
    // therefore emit (day, metric) pairs where `metric` is one of
    // the six PRD §24 names — NOT a `pe.dimension` value.
    it('the days CTE does NOT key on progress_evidence.dimension', () => {
      const body = extractFunctionBody(readMigration());
      // The buggy form was: `select distinct pe.dimension, ... from
      // public.progress_evidence pe`. The fix uses a CROSS JOIN of
      // a generate_series(calendar) and a VALUES list of the six
      // metric names. Assert the function does NOT pull
      // `pe.dimension` from the days CTE source.
      // Look for a SELECT-from-progress_evidence that uses
      // `pe.dimension` as a selected column (i.e. projecting it
      // out), and confirm it's NOT inside a "days as" CTE.
      const buggyPattern =
        /with\s+days\s+as\s*\(\s*[\s\S]*?select\s+distinct[\s\S]*?pe\.dimension\s+as\s+\w+[\s\S]*?from\s+public\.progress_evidence\s+pe\b/i;
      expect(body).not.toMatch(buggyPattern);
    });

    it('the days CTE enumerates exactly the six PRD §24 metric names', () => {
      const body = extractFunctionBody(readMigration());
      // The fix uses a VALUES list: ('test_completion'),
      // ('error_capture'), ('review_completion'),
      // ('correction_rate'), ('reopen_rate'),
      // ('time_to_correction'). The literal strings must each
      // appear inside a VALUES (...) block in the days CTE.
      const required = [
        'test_completion',
        'error_capture',
        'review_completion',
        'correction_rate',
        'reopen_rate',
        'time_to_correction',
      ];
      // Slice to the days CTE. The days CTE is the first CTE
      // in the daily rollup loop, immediately following the
      // `with days as (` opener.
      const daysOpen = body.indexOf('with days as (');
      expect(daysOpen, 'days CTE opener not found').toBeGreaterThanOrEqual(0);
      // The days CTE body ends at the first `),` that closes
      // the with list — the simplest pattern is to find the
      // matching close via balance tracking.
      let depth = 0;
      let i = daysOpen;
      let started = false;
      for (; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '(') {
          depth += 1;
          started = true;
        } else if (ch === ')') {
          depth -= 1;
          if (started && depth === 0) {
            break;
          }
        }
      }
      const daysBody = body.slice(daysOpen, i + 1);
      for (const m of required) {
        expect(daysBody, `metric ${m} missing from days CTE`).toContain(`'${m}'`);
      }
    });

    it('the days CTE scopes by activity (only days with progress_evidence or review_schedules rows)', () => {
      const body = extractFunctionBody(readMigration());
      const daysOpen = body.indexOf('with days as (');
      expect(daysOpen, 'days CTE opener not found').toBeGreaterThanOrEqual(0);
      let depth = 0;
      let i = daysOpen;
      let started = false;
      for (; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '(') {
          depth += 1;
          started = true;
        } else if (ch === ')') {
          depth -= 1;
          if (started && depth === 0) break;
        }
      }
      const daysBody = body.slice(daysOpen, i + 1);
      // The days CTE must filter to days where the user has any
      // activity. The pattern: an EXISTS subquery over
      // progress_evidence or review_schedules.
      expect(daysBody).toMatch(/exists\s*\(/i);
      expect(daysBody).toMatch(/progress_evidence/i);
      expect(daysBody).toMatch(/review_schedules/i);
    });
  });
});
