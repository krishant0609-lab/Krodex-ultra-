/**
 * KRODEX API — analytics explanation templates.
 *
 * Per PHASE4_PLAN.md §15 and Decision Point D-10, the
 * `explanation` field on every metric response is a one-sentence
 * human-readable string. The PRD §24:955-958 names the *policy*
 * ("Every generated insight should be explainable in one
 * sentence and drillable to source records") and the TRD §18
 * (lines 737-740) names the *drill-down contract* (Class A).
 * The PRD does NOT name a catalog of strings; the only
 * documented example is "Take a test in this topic" (PRD
 * §24:961-963).
 *
 * Per D-10.b (Class A — PRD example + deterministic fallback),
 * this module ships:
 *   - The single PRD-given example string for the
 *     "empty/insufficient-evidence" case.
 *   - A deterministic template per metric for the "value
 *     present" case, parameterized by `numerator`,
 *     `denominator`, and the metric label.
 *
 * Per D-10, the templates are **versioned** (this file's
 * `TEMPLATE_VERSION` constant) so future revisions can be
 * reviewed and the API can return a `templateVersion` field on
 * every response (the dimension route does this).
 *
 * Drill-down IDs are constructed in `drilldown.ts`.
 */

import type { MetricValue } from './metrics';
import type { TrendDirection } from './trend';

/** Bump whenever an explanation string changes. */
export const TEMPLATE_VERSION = '1.0.0';

export interface ExplanationContext {
  dimensionKey: string;
  metric: MetricValue;
  windowLabel: string;
  trend: TrendDirection;
}

export interface Explanation {
  /** A single human-readable sentence explaining the metric. */
  text: string;
  /** The literal template identifier (for testing and audit). */
  templateId: string;
  /** The current template version. */
  templateVersion: typeof TEMPLATE_VERSION;
}

/** The one PRD-given example (PRD §24:961-963). Class A. */
const PRD_EXAMPLE_EMPTY = 'Take a test in this topic';

/**
 * The per-metric templates. The keys are the six PRD §24
 * metric names plus `'composite'`. Each template is a function
 * of the context that returns the explanation text.
 *
 * The strings are Class A in policy (explanations must exist)
 * and Class C in template (the actual strings are not
 * PRD-documented). They are determinstic so two runs with the
 * same inputs produce the same string.
 */
const TEMPLATES: Record<string, (ctx: ExplanationContext) => string> = {
  test_completion: (ctx) =>
    ctx.metric.value === null
      ? `${PRD_EXAMPLE_EMPTY} (insufficient evidence: ${ctx.metric.sampleSize} samples)`
      : `Test completion: ${formatPct(ctx.metric.value)} across ${ctx.metric.denominator} attempts in the last ${ctx.windowLabel}.`,

  error_capture: (ctx) =>
    ctx.metric.value === null
      ? `Insufficient evidence to compute error capture rate (${ctx.metric.sampleSize} samples).`
      : `Error capture: ${formatPct(ctx.metric.value)} of eligible incorrect answers produced an Error Bank entry.`,

  review_completion: (ctx) =>
    ctx.metric.value === null
      ? `Insufficient evidence to compute review completion (${ctx.metric.sampleSize} samples).`
      : `Review completion: ${formatPct(ctx.metric.value)} of due reviews completed.`,

  correction_rate: (ctx) =>
    ctx.metric.value === null
      ? `Insufficient evidence to compute correction rate (${ctx.metric.sampleSize} samples).`
      : `Correction rate: ${formatPct(ctx.metric.value)} of completed reviews produced qualifying correct outcomes.`,

  reopen_rate: (ctx) =>
    ctx.metric.value === null
      ? `Insufficient evidence to compute reopen rate (${ctx.metric.sampleSize} samples).`
      : `Reopen rate: ${formatPct(ctx.metric.value)} of resolved errors were subsequently reopened.`,

  time_to_correction: (ctx) =>
    ctx.metric.value === null
      ? `Insufficient evidence to compute time to correction (${ctx.metric.sampleSize} samples).`
      : `Time to correction: median of ${formatSeconds(ctx.metric.value)} across ${ctx.metric.denominator} resolved errors.`,

  composite: (ctx) =>
    ctx.metric.value === null
      ? `Insufficient evidence to compute the composite score (${ctx.metric.sampleSize} samples).`
      : `Composite score: ${formatPct(ctx.metric.value)} (uniform 1/6 mean of the six PRD §24 metrics).`,
};

/**
 * Build the explanation for one dimension. Pure / deterministic.
 */
export function explain(ctx: ExplanationContext): Explanation {
  const tmpl = TEMPLATES[ctx.dimensionKey] ?? TEMPLATES.composite!;
  return {
    text: tmpl(ctx),
    templateId: ctx.dimensionKey,
    templateVersion: TEMPLATE_VERSION,
  };
}

/* ---------------------- internal formatters ---------------------------- */

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatSeconds(v: number): string {
  if (v < 60) return `${v.toFixed(0)}s`;
  if (v < 3600) return `${(v / 60).toFixed(1)}m`;
  if (v < 86400) return `${(v / 3600).toFixed(1)}h`;
  return `${(v / 86400).toFixed(1)}d`;
}
