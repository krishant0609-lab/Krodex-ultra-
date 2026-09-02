/**
 * Unit tests for the composite service (D-1 + D-4).
 *
 * Per PHASE4_PLAN.md §7:
 *   - D-1: composite is a uniform mean of the six PRD §24 metrics
 *   - D-4: weights are 1/6 (uniform)
 */

import { describe, it, expect } from 'vitest';
import { computeComposite, COMPOSITE_INPUTS, COMPOSITE_WEIGHT } from '../composite';
import type { MetricValue } from '../metrics';

const ratio = (numerator: number, denominator: number, sampleSize: number): MetricValue => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  sampleSize,
  suppressed: false,
});

const suppressed = (sampleSize: number): MetricValue => ({
  value: null,
  numerator: 0,
  denominator: 0,
  sampleSize,
  suppressed: true,
});

describe('COMPOSITE_INPUTS / COMPOSITE_WEIGHT (D-4, Class A)', () => {
  it('uses 1/6 uniform weight', () => {
    expect(COMPOSITE_WEIGHT).toBeCloseTo(1 / 6);
  });

  it('includes exactly the six PRD §24 metric keys (D-1, Class A)', () => {
    expect([...COMPOSITE_INPUTS].sort()).toEqual([
      'correction_rate',
      'error_capture',
      'reopen_rate',
      'review_completion',
      'test_completion',
      'time_to_correction',
    ]);
  });
});

describe('computeComposite (D-1, D-4)', () => {
  it('returns null when no inputs have a value', () => {
    const out = computeComposite({
      test_completion: suppressed(2),
      error_capture: suppressed(2),
      review_completion: suppressed(2),
      correction_rate: suppressed(2),
      reopen_rate: suppressed(2),
      time_to_correction: suppressed(2),
    });
    expect(out.value).toBeNull();
    expect(out.inputsContributed).toBe(0);
  });

  it('averages the non-null input values uniformly', () => {
    const out = computeComposite({
      test_completion: ratio(80, 100, 100),    // 0.8
      error_capture: ratio(15, 30, 30),         // 0.5
      review_completion: ratio(7, 10, 10),      // 0.7
      correction_rate: ratio(9, 12, 12),        // 0.75
      reopen_rate: ratio(2, 20, 20),            // 0.1
      time_to_correction: ratio(1, 5, 5),       // 0.2 (numeric — kept as-is)
    });
    // Mean of [0.8, 0.5, 0.7, 0.75, 0.1, 0.2] = 3.05 / 6 = 0.50833…
    expect(out.value).toBeCloseTo(3.05 / 6);
    expect(out.inputsContributed).toBe(6);
  });

  it('excludes null-valued inputs from the mean', () => {
    const out = computeComposite({
      test_completion: ratio(80, 100, 100),  // 0.8
      error_capture: suppressed(2),          // null
      review_completion: ratio(7, 10, 10),   // 0.7
      correction_rate: suppressed(2),         // null
      reopen_rate: ratio(2, 20, 20),          // 0.1
      time_to_correction: suppressed(2),      // null
    });
    // Mean of [0.8, 0.7, 0.1] = 1.6 / 3
    expect(out.value).toBeCloseTo(1.6 / 3);
    expect(out.inputsContributed).toBe(3);
  });
});
