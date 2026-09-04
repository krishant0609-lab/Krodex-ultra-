/**
 * KRODEX API — review scheduling engine (Phase 9, TRD §12).
 *
 * Owns the 7-input scoring function that turns a captured error
 * into a ReviewSchedulingDecision. The engine is policy-pluggable
 * but ships with a single default: SM-2.
 *
 * Inputs (per TRD §12):
 *   1. errorState                  — current status of the error
 *   2. lastReviewOutcome           — last review outcome, if any
 *   3. reviewCount                 — number of prior reviews
 *   4. priorSuccesses / priorFailures
 *   5. recurrenceEvidence          — has the same error been seen
 *      again since the last review (i.e. recurrence_count > 0)
 *   6. studentPreferences          — DEFERRED to a later phase per
 *      the Phase 9 plan. Accepted as a parameter shape for
 *      forward compatibility, but unused by the SM-2 default.
 *   7. configuredPolicy            — overrides the default. The
 *      application layer chooses which policy to use; the engine
 *      does not look it up itself.
 *
 * Output (Decision):
 *   - dueAt                       — ISO timestamp of next review
 *   - reasonCode                  — short, machine-readable code
 *   - reasonText                  — human-readable explanation
 *   - confidence                  — 0.0–1.0
 *   - requiresConfirmation        — true if the caller should
 *                                    surface a confirmation UI
 *                                    (low confidence / override)
 *
 * Determinism: SM-2 is a closed-form function of its inputs. The
 * engine never reads the wall clock; the caller passes a `now`
 * timestamp so the same input set always yields the same `dueAt`.
 */

import type { ErrorEntryStatus, ReviewOutcome } from '@krodex/shared';

/** All seven TRD §12 inputs. */
export interface SchedulingInputs {
  /** Current status of the error entry. */
  errorState: ErrorEntryStatus;
  /** Last recorded review outcome, or null if never reviewed. */
  lastReviewOutcome: ReviewOutcome | null;
  /** How many reviews have already been recorded against this error. */
  reviewCount: number;
  /** Count of successful reviews (qualifying correct). */
  priorSuccesses: number;
  /** Count of failed reviews. */
  priorFailures: number;
  /** Has the error been seen (re-attempted) since the last review? */
  recurrenceEvidence: boolean;
  /**
   * Forward-compat slot. The Phase 9 plan defers student-preference
   * storage to a later phase; SM-2 ignores this field. A future
   * student-preference-aware policy can read it.
   */
  studentPreferences?: Readonly<Record<string, unknown>> | null;
}

/** Possible return codes. */
export type SchedulingReasonCode =
  | 'first_seen_no_review'
  | 'review_soon_after_recurrence'
  | 'escalation_after_recurrence'
  | 'stable_qualifying_correct'
  | 'review_due_now'
  | 'remediation_repeat_failure'
  | 'archive_terminal';

/** Final decision: when to schedule the next review, and why. */
export interface SchedulingDecision {
  dueAt: string;
  reasonCode: SchedulingReasonCode;
  reasonText: string;
  confidence: number;
  requiresConfirmation: boolean;
}

/** SM-2 policy constants. */
const SM2 = {
  /** Initial interval (days) after the first successful review. */
  INITIAL_INTERVAL_DAYS: 1,
  /** Second interval (days) after a second consecutive success. */
  SECOND_INTERVAL_DAYS: 6,
  /** Default ease factor when none has been computed yet. */
  INITIAL_EASE: 2.5,
  /** Minimum ease factor — never go below this. */
  MIN_EASE: 1.3,
  /** Multiplier applied to ease on each successful review. */
  EASE_DELTA: 0.1,
  /** Subtract this from ease on a failed review. */
  EASE_FAIL_DELTA: 0.2,
  /** Soft cap on the next interval (days) — never schedule further out. */
  MAX_INTERVAL_DAYS: 180,
} as const;

/**
 * SM-2 scheduler. Pure function of inputs + `now`. No I/O.
 *
 * Mapping from inputs to a decision:
 *   - errorState in {archived, resolved}  → archive_terminal (or
 *     stable_qualifying_correct for resolved with no further work)
 *   - first review (reviewCount===0)      → first_seen_no_review
 *   - recurrence with prior success      → review_soon_after_recurrence
 *   - recurrence with prior failure      → escalation_after_recurrence
 *   - last outcome was correct            → stable_qualifying_correct
 *   - last outcome was incorrect         → remediation_repeat_failure
 *   - last outcome was partial / skipped → review_due_now
 */
export function sm2(
  inputs: SchedulingInputs,
  now: Date,
): SchedulingDecision {
  // 1. Terminal states. ARCHIVED is terminal in Phase 9. RESOLVED
  //    with no follow-up work is also a no-op: the engine returns a
  //    far-future dueAt so no scheduler will surface it.
  if (inputs.errorState === 'archived') {
    return {
      dueAt: new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString(),
      reasonCode: 'archive_terminal',
      reasonText: 'Error is archived; no review scheduled.',
      confidence: 1,
      requiresConfirmation: false,
    };
  }
  if (inputs.errorState === 'resolved' && inputs.reviewCount === 0) {
    // Resolved without ever being reviewed: nothing to schedule.
    return {
      dueAt: new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString(),
      reasonCode: 'stable_qualifying_correct',
      reasonText: 'Resolved; no follow-up review needed.',
      confidence: 0.9,
      requiresConfirmation: false,
    };
  }

  // 2. First time we are scheduling for this error.
  if (inputs.reviewCount === 0) {
    const due = addDays(now, SM2.INITIAL_INTERVAL_DAYS);
    return {
      dueAt: due.toISOString(),
      reasonCode: 'first_seen_no_review',
      reasonText: 'First review scheduled ~1 day out.',
      confidence: 0.85,
      requiresConfirmation: false,
    };
  }

  // 3. Recurrence: the error was seen again after the last review.
  //    Reset the SM-2 interval to the second-interval mark and
  //    reduce the ease factor.
  if (inputs.recurrenceEvidence) {
    if (inputs.priorSuccesses > inputs.priorFailures) {
      const due = addDays(now, SM2.SECOND_INTERVAL_DAYS);
      return {
        dueAt: due.toISOString(),
        reasonCode: 'review_soon_after_recurrence',
        reasonText: 'Recurrence after success; ~6 day interval.',
        confidence: 0.7,
        requiresConfirmation: true,
      };
    }
    // Many failures + recurrence: short remediation interval.
    const due = addDays(now, 1);
    return {
      dueAt: due.toISOString(),
      reasonCode: 'escalation_after_recurrence',
      reasonText: 'Recurrence after failure; review tomorrow.',
      confidence: 0.6,
      requiresConfirmation: true,
    };
  }

  // 4. Walk the SM-2 chain off the recorded outcomes.
  const ease = clampEase(
    SM2.INITIAL_EASE +
      inputs.priorSuccesses * SM2.EASE_DELTA -
      inputs.priorFailures * SM2.EASE_FAIL_DELTA,
  );
  const n = inputs.reviewCount; // reviews so far
  // Standard SM-2: I(1)=1, I(2)=6, I(n)=I(n-1)*ease
  const baseDays =
    n === 1
      ? SM2.INITIAL_INTERVAL_DAYS
      : n === 2
      ? SM2.SECOND_INTERVAL_DAYS
      : SM2.SECOND_INTERVAL_DAYS * Math.pow(ease, n - 2);
  const intervalDays = Math.min(baseDays, SM2.MAX_INTERVAL_DAYS);
  const due = addDays(now, Math.max(1, Math.round(intervalDays)));

  // 5. Decide the reason code from the most recent outcome.
  if (inputs.lastReviewOutcome === 'correct') {
    return {
      dueAt: due.toISOString(),
      reasonCode: 'stable_qualifying_correct',
      reasonText: `Stable after qualifying correct; ~${Math.round(intervalDays)} day interval.`,
      confidence: 0.85,
      requiresConfirmation: false,
    };
  }
  if (inputs.lastReviewOutcome === 'incorrect') {
    return {
      dueAt: due.toISOString(),
      reasonCode: 'remediation_repeat_failure',
      reasonText: `Recent failure; ~${Math.round(intervalDays)} day interval.`,
      confidence: 0.7,
      requiresConfirmation: true,
    };
  }
  return {
    dueAt: due.toISOString(),
    reasonCode: 'review_due_now',
    reasonText: 'Last review was inconclusive; review again now.',
    confidence: 0.5,
    requiresConfirmation: true,
  };
}

/** The default policy handle — used by CaptureOrchestrator. */
export const defaultPolicy = sm2;

/** Add `days` (rounded) to `now`. Pure; no wall-clock read. */
function addDays(now: Date, days: number): Date {
  const ms = days * 24 * 3600 * 1000;
  return new Date(now.getTime() + ms);
}

/** Clamp the SM-2 ease factor into [MIN_EASE, ∞). */
function clampEase(ease: number): number {
  return Math.max(SM2.MIN_EASE, ease);
}
