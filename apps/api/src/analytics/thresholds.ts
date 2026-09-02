/**
 * KRODEX API — analytics threshold service.
 *
 * Per PHASE4_PLAN.md §4 (Decision Point D-2), this module maps a
 * sample size to the three evidence-threshold labels. The PRD
 * §23:914-917 names the *policy* ("limited evidence", "small
 * sample", "insufficient evidence") in prose but does NOT name
 * the numeric threshold. The TRD §18 (line 733) says "apply
 * thresholds" but does not name them either.
 *
 * The numeric ladder below is therefore **Class C — Approved
 * Product Policy**, NOT a value documented in the PRD, TRD, or
 * Implementation Plan. The values were approved by the user as
 * a Phase 4 product decision (D-2.a).
 *
 * Ladder (Class C — Approved Product Policy):
 *   sample_size < 5       -> 'limited'
 *   5 <= sample_size < 20 -> 'moderate'
 *   sample_size >= 20     -> 'strong'
 *
 * Do not change these numbers without re-approving D-2.
 */

export type EvidenceThreshold = 'limited' | 'moderate' | 'strong';

/**
 * The numeric boundary values. They are exported as constants so
 * tests can pin them and the SQL function in migration 12 can
 * stay aligned with the TypeScript ladder.
 *
 * Classification: **Class C — Approved Product Policy.**
 */
export const THRESHOLD_LADDER = {
  LIMITED_MAX_EXCLUSIVE: 5,
  MODERATE_MAX_EXCLUSIVE: 20,
} as const;

/**
 * Classify a sample size. Pure / deterministic. Negative or
 * non-integer sample sizes are clamped to 0 (returns 'limited').
 */
export function classifySampleSize(sampleSize: number): EvidenceThreshold {
  if (!Number.isFinite(sampleSize) || sampleSize < THRESHOLD_LADDER.LIMITED_MAX_EXCLUSIVE) {
    return 'limited';
  }
  if (sampleSize < THRESHOLD_LADDER.MODERATE_MAX_EXCLUSIVE) {
    return 'moderate';
  }
  return 'strong';
}

/**
 * Per PHASE4_PLAN §3.2 rule 1 (PRD §23:914-917) and TRD §18, a
 * metric's value is suppressed to `null` when the sample size is
 * too small to present a meaningful number. The exact cut-off
 * is a Class C policy (D-2.a); we suppress when
 * `sampleSize < LIMITED_MAX_EXCLUSIVE` (i.e. 'limited').
 *
 * This is the only place in the read path that decides "is this
 * value trustworthy enough to render". It is called from every
 * metric formula in `metrics.ts`.
 */
export function shouldSuppressValue(sampleSize: number): boolean {
  return sampleSize < THRESHOLD_LADDER.LIMITED_MAX_EXCLUSIVE;
}
