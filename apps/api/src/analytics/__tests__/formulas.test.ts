/**
 * Unit tests for the six PRD §24 metric formulas.
 *
 * The formulas are Class A — verbatim from PRD §24:938-948.
 * The suppression rule is D-2 (Class C — Approved Product
 * Policy): sampleSize < 5.
 */

import { describe, it, expect } from 'vitest';
import {
  testCompletionRate,
  errorCaptureRate,
  reviewCompletion,
  correctionRate,
  reopenRate,
  timeToCorrectionMedian,
  reduceWindow,
} from '../metrics';

describe('testCompletionRate (PRD §24:938, Class A)', () => {
  it('computes the ratio when sample is sufficient', () => {
    const m = testCompletionRate(80, 100, 100);
    expect(m.value).toBeCloseTo(0.8);
    expect(m.numerator).toBe(80);
    expect(m.denominator).toBe(100);
    expect(m.sampleSize).toBe(100);
    expect(m.suppressed).toBe(false);
  });

  it('suppresses to null when sample < 5 (D-2, Class C)', () => {
    const m = testCompletionRate(4, 4, 4);
    expect(m.value).toBeNull();
    expect(m.suppressed).toBe(true);
  });

  it('returns null value when denominator is zero (no division by zero)', () => {
    const m = testCompletionRate(0, 0, 0);
    expect(m.value).toBeNull();
    expect(m.denominator).toBe(0);
  });
});

describe('errorCaptureRate (PRD §24:940, Class A)', () => {
  it('computes correctly for a sufficient sample', () => {
    const m = errorCaptureRate(15, 30, 30);
    expect(m.value).toBeCloseTo(0.5);
    expect(m.sampleSize).toBe(30);
  });
});

describe('reviewCompletion (PRD §24:942, Class A)', () => {
  it('computes correctly for a sufficient sample', () => {
    const m = reviewCompletion(7, 10, 10);
    expect(m.value).toBeCloseTo(0.7);
  });
});

describe('correctionRate (PRD §24:944, Class A)', () => {
  it('computes correctly for a sufficient sample', () => {
    const m = correctionRate(9, 12, 12);
    expect(m.value).toBeCloseTo(0.75);
  });
});

describe('reopenRate (PRD §24:946, Class A)', () => {
  it('computes correctly for a sufficient sample', () => {
    const m = reopenRate(2, 20, 20);
    expect(m.value).toBeCloseTo(0.1);
  });
});

describe('timeToCorrectionMedian (PRD §24:948, Class A)', () => {
  it('returns the median of an odd-length array', () => {
    const m = timeToCorrectionMedian([10, 20, 30]);
    expect(m.value).toBe(20);
    expect(m.sampleSize).toBe(3);
  });

  it('returns the median of an even-length array', () => {
    const m = timeToCorrectionMedian([10, 20, 30, 40]);
    expect(m.value).toBe(25);
  });

  it('returns null for an empty array', () => {
    const m = timeToCorrectionMedian([]);
    expect(m.value).toBeNull();
    expect(m.sampleSize).toBe(0);
  });

  it('flags suppressed=true when sample < 5 (D-2, Class C)', () => {
    const m = timeToCorrectionMedian([10, 20, 30]);
    // The function reports the median + a `suppressed: true`
    // flag when sample < 5. The dashboard route translates
    // suppressed into the `evidenceThreshold` ("limited") and
    // hides the value at the call site; the function itself
    // always returns the computed median.
    expect(m.value).toBe(20);
    expect(m.suppressed).toBe(true);
  });
});

describe('reduceWindow (PRD §23 aggregation, Class A)', () => {
  it('sums numerators, denominators, and sample sizes across days', () => {
    const m = reduceWindow([
      { numerator: 5, denominator: 10, sampleSize: 10 },
      { numerator: 10, denominator: 20, sampleSize: 20 },
    ]);
    expect(m.numerator).toBe(15);
    expect(m.denominator).toBe(30);
    expect(m.sampleSize).toBe(30);
    expect(m.value).toBeCloseTo(0.5);
  });

  it('returns null for an empty array', () => {
    const m = reduceWindow([]);
    expect(m.value).toBeNull();
    expect(m.sampleSize).toBe(0);
  });
});
