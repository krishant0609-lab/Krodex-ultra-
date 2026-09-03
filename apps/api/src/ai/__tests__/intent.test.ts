/**
 * KRODEX API — Phase 8 intent classifier tests.
 *
 * The classifier is pure rule-based: substring match on a
 * hand-curated pattern list. Each test pins one branch of the
 * matching so future refactors can't silently broaden or narrow
 * what counts as a "classify" or "recommendation" request.
 */

import { describe, expect, it } from 'vitest';
import { classifyIntent } from '../intent';

describe('classifyIntent', () => {
  it('classifies "classify this" / "what kind of mistake" as classify', () => {
    expect(classifyIntent('classify this error')).toBe('classify');
    expect(classifyIntent('What kind of mistake was that?')).toBe('classify');
    expect(classifyIntent('why did I get this wrong')).toBe('classify');
    expect(classifyIntent('mistake type?')).toBe('classify');
  });

  it('classifies "explain" / "why is X" as explanation', () => {
    expect(classifyIntent('explain the solution')).toBe('explanation');
    expect(classifyIntent('why is 1+1=2?')).toBe('explanation');
    expect(classifyIntent('how does the newton method work')).toBe('explanation');
    expect(classifyIntent('walk me through it step by step')).toBe('explanation');
  });

  it('classifies "what should i do" / "schedule a review" as recommendation', () => {
    expect(classifyIntent('what should I do next?')).toBe('recommendation');
    expect(classifyIntent('schedule a review for me')).toBe('recommendation');
    expect(classifyIntent('can you recommend a plan')).toBe('recommendation');
  });

  it('falls through to "other" when no rule matches', () => {
    expect(classifyIntent('hello there')).toBe('other');
    expect(classifyIntent('count the apples in the basket')).toBe('other');
  });

  it('returns "other" for empty input', () => {
    expect(classifyIntent('')).toBe('other');
    expect(classifyIntent('   ')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(classifyIntent('EXPLAIN this')).toBe('explanation');
    expect(classifyIntent('Classify My Error')).toBe('classify');
  });

  it('uses first-match-wins ordering: classify before explanation', () => {
    // The "classify" rule must come first so a question that
    // contains both "explain" and "classify this" routes to
    // classify (it's a classification ask that happens to
    // mention explanation).
    expect(classifyIntent('explain the right way to classify this')).toBe('classify');
  });
});
