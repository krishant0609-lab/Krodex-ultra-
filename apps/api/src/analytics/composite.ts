/**
 * KRODEX API — analytics composite service.
 *
 * Per PHASE4_PLAN.md §7, the composite is a uniform mean of the
 * six PRD §24 metrics (D-1.b + D-4.a). The weights are Class A
 * (uniform 1/6) and the input shape is Class A (the six PRD
 * metrics). The decision to ship a composite at all is the
 * answer to D-1; the uniform 1/6 weight is the answer to D-4.
 *
 * D-1 (Class A — uniform composite of 6): the user accepted the
 *   six PRD §24 metrics as the only authoritative inputs.
 * D-4 (Class A — uniform 1/6 weights): the user accepted
 *   uniform 1/6 weighting.
 *
 * Per PHASE4_PLAN §2.2, the Phase 3 catalog is preserved
 * (append-only). The composite metric is one of the six inputs;
 * the other five (test_completion, error_capture, review_completion,
 * correction_rate, reopen_rate) are the remaining five.
 *
 * The composite's `value` is the mean of the six inputs'
 * `value`s. Inputs with `value === null` (suppressed or
 * zero-denominator) are excluded from the mean. If no inputs
 * have a value, the composite's value is `null`.
 */

import type { MetricValue } from './metrics';

export const COMPOSITE_WEIGHT = 1 / 6;
export const COMPOSITE_INPUTS = [
  'test_completion',
  'error_capture',
  'review_completion',
  'correction_rate',
  'reopen_rate',
  'time_to_correction',
] as const;

export type CompositeInputKey = typeof COMPOSITE_INPUTS[number];

/**
 * The composite response. Shape is identical to MetricValue
 * (TRD §18:733-734 requires `numerator`/`denominator`/
 * `sampleSize`; for the composite the `numerator` is the sum of
 * the input numerators and `denominator` is the sum of the
 * input denominators, both weighted by 1/6).
 */
export interface CompositeValue {
  value: number | null;
  numerator: number;
  denominator: number;
  sampleSize: number;
  /** The 1/6-weighted mean of the six input values. */
  suppressed: boolean;
  /** How many of the six inputs contributed a non-null value. */
  inputsContributed: number;
}

/**
 * Compute the uniform 1/6 composite. Pure / deterministic.
 *
 * `inputs` is a map of the six metric keys to their MetricValue
 * responses. The composite value is the mean of the non-null
 * `value`s.
 */
export function computeComposite(
  inputs: Readonly<Record<CompositeInputKey, MetricValue>>,
): CompositeValue {
  let sumValue = 0;
  let contributed = 0;
  let numerator = 0;
  let denominator = 0;
  let sampleSize = 0;
  for (const key of COMPOSITE_INPUTS) {
    const m = inputs[key];
    if (m.value === null) continue;
    sumValue += m.value;
    contributed += 1;
    numerator += m.numerator;
    denominator += m.denominator;
    sampleSize += m.sampleSize;
  }
  if (contributed === 0) {
    return {
      value: null,
      numerator: 0,
      denominator: 0,
      sampleSize: 0,
      suppressed: false,
      inputsContributed: 0,
    };
  }
  return {
    value: sumValue / contributed,
    numerator,
    denominator,
    sampleSize,
    suppressed: false,
    inputsContributed: contributed,
  };
}
