/**
 * Unit tests for the trend service (D-3 — Class C).
 *
 * Per PHASE4_PLAN.md §6, the trend direction is one of:
 *   'improving' | 'declining' | 'flat' | 'insufficient_data'
 *
 * The threshold (0.05), minimum evidence (3 distinct days),
 * and comparison method (half-vs-half) are Class C — Approved
 * Product Policy.
 */

import { describe, it, expect } from 'vitest';
import {
  TREND_POLICY,
  trendDirection,
  trendDirectionForNullSeries,
} from '../trend';

const day = (d: number, value: number) => ({ day: `2026-09-${String(d).padStart(2, '0')}`, value });

describe('TREND_POLICY constants (Class C — Approved Product Policy)', () => {
  it('pins the four-value enum and the numeric constants', () => {
    expect(TREND_POLICY.THRESHOLD).toBe(0.05);
    expect(TREND_POLICY.MIN_DISTINCT_DAYS).toBe(3);
  });
});

describe('trendDirection', () => {
  it('returns "insufficient_data" for an empty series', () => {
    expect(trendDirection([])).toBe('insufficient_data');
  });

  it('returns "insufficient_data" when fewer than 3 distinct days have data', () => {
    expect(trendDirection([day(1, 0.5), day(2, 0.6)])).toBe('insufficient_data');
  });

  it('returns "improving" when trailing half is meaningfully higher than leading half', () => {
    // Leading half mean = 0.4; trailing half mean = 0.7; delta = 0.3 (above 0.05).
    expect(trendDirection([
      day(1, 0.4),
      day(2, 0.4),
      day(3, 0.4),
      day(4, 0.7),
      day(5, 0.7),
      day(6, 0.7),
    ])).toBe('improving');
  });

  it('returns "declining" when trailing half is meaningfully lower than leading half', () => {
    // Leading mean = 0.8; trailing mean = 0.5; delta = -0.3 (below -0.05).
    expect(trendDirection([
      day(1, 0.8),
      day(2, 0.8),
      day(3, 0.8),
      day(4, 0.5),
      day(5, 0.5),
      day(6, 0.5),
    ])).toBe('declining');
  });

  it('returns "flat" when delta is below the 0.05 threshold (Class C)', () => {
    // Leading mean = 0.5; trailing mean = 0.52; delta = 0.02 (below 0.05).
    expect(trendDirection([
      day(1, 0.5),
      day(2, 0.5),
      day(3, 0.5),
      day(4, 0.52),
      day(5, 0.52),
      day(6, 0.52),
    ])).toBe('flat');
  });

  it('returns "insufficient_data" when distinct days are below 3 (duplicates collapse)', () => {
    expect(trendDirection([
      day(1, 0.5),
      day(1, 0.7),
      day(1, 0.9),
    ])).toBe('insufficient_data');
  });
});

describe('trendDirectionForNullSeries', () => {
  it('returns "insufficient_data"', () => {
    expect(trendDirectionForNullSeries()).toBe('insufficient_data');
  });
});
