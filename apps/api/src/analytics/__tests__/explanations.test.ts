/**
 * Unit tests for the explanation service (D-10).
 *
 * The empty-state string is the PRD-given example
 * "Take a test in this topic" (PRD §24:961-963, Class A).
 * The other templates are deterministic and versioned.
 */

import { describe, it, expect } from 'vitest';
import { TEMPLATE_VERSION, explain } from '../explanations';
import type { MetricValue } from '../metrics';

const ctx = (
  dimensionKey: string,
  metric: MetricValue,
  trend: 'improving' | 'declining' | 'flat' | 'insufficient_data' = 'flat',
  windowLabel = '30 days',
) => ({
  dimensionKey,
  metric,
  windowLabel,
  trend,
});

describe('TEMPLATE_VERSION is pinned (D-10)', () => {
  it('is 1.0.0', () => {
    expect(TEMPLATE_VERSION).toBe('1.0.0');
  });
});

describe('explain — empty-state strings (PRD §24:961-963, Class A)', () => {
  const empty: MetricValue = { value: null, numerator: 0, denominator: 0, sampleSize: 2, suppressed: true };

  it('uses the PRD-given example for test_completion', () => {
    const e = explain(ctx('test_completion', empty));
    expect(e.text.startsWith('Take a test in this topic')).toBe(true);
  });

  it('falls back to "Insufficient evidence" for the other metrics', () => {
    expect(explain(ctx('error_capture', empty)).text).toMatch(/^Insufficient evidence/);
    expect(explain(ctx('review_completion', empty)).text).toMatch(/^Insufficient evidence/);
    expect(explain(ctx('correction_rate', empty)).text).toMatch(/^Insufficient evidence/);
    expect(explain(ctx('reopen_rate', empty)).text).toMatch(/^Insufficient evidence/);
    expect(explain(ctx('time_to_correction', empty)).text).toMatch(/^Insufficient evidence/);
  });
});

describe('explain — value-present templates are deterministic', () => {
  const m: MetricValue = { value: 0.75, numerator: 75, denominator: 100, sampleSize: 100, suppressed: false };

  it('returns the same string for the same input', () => {
    const a = explain(ctx('test_completion', m, 'flat', '30 days'));
    const b = explain(ctx('test_completion', m, 'flat', '30 days'));
    expect(a.text).toBe(b.text);
    expect(a.templateId).toBe('test_completion');
    expect(a.templateVersion).toBe(TEMPLATE_VERSION);
  });

  it('formats percentages with one decimal place', () => {
    const e = explain(ctx('test_completion', m));
    expect(e.text).toContain('75.0%');
  });

  it('formats time-to-correction in seconds when below 60s', () => {
    const tm: MetricValue = { value: 45, numerator: 45, denominator: 10, sampleSize: 10, suppressed: false };
    const e = explain(ctx('time_to_correction', tm));
    expect(e.text).toMatch(/45s/);
  });

  it('formats composite text using the 1/6 framing', () => {
    const e = explain(ctx('composite', m));
    expect(e.text).toContain('uniform 1/6');
  });
});
