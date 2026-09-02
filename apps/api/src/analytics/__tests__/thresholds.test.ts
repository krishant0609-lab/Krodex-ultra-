/**
 * Unit tests for the threshold service (D-2 — Class C).
 *
 * Per PHASE4_PLAN.md §4, the ladder is:
 *   sample_size <  5   -> 'limited'
 *   5 <= sample_size < 20 -> 'moderate'
 *   sample_size >= 20  -> 'strong'
 *
 * These values are Class C — Approved Product Policy.
 */

import { describe, it, expect } from 'vitest';
import {
  THRESHOLD_LADDER,
  classifySampleSize,
  shouldSuppressValue,
} from '../thresholds';

describe('classifySampleSize (D-2 ladder, Class C — Approved Product Policy)', () => {
  it('returns "limited" for sampleSize < 5', () => {
    expect(classifySampleSize(0)).toBe('limited');
    expect(classifySampleSize(1)).toBe('limited');
    expect(classifySampleSize(2)).toBe('limited');
    expect(classifySampleSize(3)).toBe('limited');
    expect(classifySampleSize(4)).toBe('limited');
  });

  it('returns "moderate" for 5 <= sampleSize < 20', () => {
    expect(classifySampleSize(5)).toBe('moderate');
    expect(classifySampleSize(10)).toBe('moderate');
    expect(classifySampleSize(19)).toBe('moderate');
  });

  it('returns "strong" for sampleSize >= 20', () => {
    expect(classifySampleSize(20)).toBe('strong');
    expect(classifySampleSize(100)).toBe('strong');
    expect(classifySampleSize(10_000)).toBe('strong');
  });

  it('clamps non-finite and negative inputs to "limited"', () => {
    expect(classifySampleSize(-1)).toBe('limited');
    expect(classifySampleSize(Number.NaN)).toBe('limited');
    expect(classifySampleSize(Number.POSITIVE_INFINITY)).toBe('limited');
  });

  it('exports the exact boundary values used in the SQL migration', () => {
    expect(THRESHOLD_LADDER.LIMITED_MAX_EXCLUSIVE).toBe(5);
    expect(THRESHOLD_LADDER.MODERATE_MAX_EXCLUSIVE).toBe(20);
  });
});

describe('shouldSuppressValue', () => {
  it('suppresses for sampleSize < 5', () => {
    expect(shouldSuppressValue(0)).toBe(true);
    expect(shouldSuppressValue(4)).toBe(true);
  });

  it('does not suppress for sampleSize >= 5', () => {
    expect(shouldSuppressValue(5)).toBe(false);
    expect(shouldSuppressValue(20)).toBe(false);
    expect(shouldSuppressValue(100)).toBe(false);
  });
});
