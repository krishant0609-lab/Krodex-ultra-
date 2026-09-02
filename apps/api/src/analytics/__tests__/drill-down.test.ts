/**
 * Unit tests for the drill-down service.
 *
 * Contract: TRD §18:737-740 (Class A). The shape is
 * `{ [metricName]: { numeratorIds, denominatorIds } }`.
 */

import { describe, it, expect } from 'vitest';
import { buildDrillDown } from '../drilldown';

describe('buildDrillDown (TRD §18:737-740, Class A)', () => {
  it('returns the canonical single-key shape', () => {
    const out = buildDrillDown('test_completion', ['a', 'b'], ['c', 'd']);
    expect(out).toEqual({
      test_completion: { numeratorIds: ['a', 'b'], denominatorIds: ['c', 'd'] },
    });
  });

  it('deduplicates repeated ids', () => {
    const out = buildDrillDown('correction_rate', ['a', 'a', 'b'], ['c', 'c', 'd']);
    expect(out.correction_rate!.numeratorIds).toEqual(['a', 'b']);
    expect(out.correction_rate!.denominatorIds).toEqual(['c', 'd']);
  });

  it('preserves the first-seen order', () => {
    const out = buildDrillDown('reopen_rate', ['z', 'a', 'z', 'b'], ['x', 'y']);
    expect(out.reopen_rate!.numeratorIds).toEqual(['z', 'a', 'b']);
  });

  it('handles empty arrays', () => {
    const out = buildDrillDown('error_capture', [], []);
    expect(out.error_capture!.numeratorIds).toEqual([]);
    expect(out.error_capture!.denominatorIds).toEqual([]);
  });
});
