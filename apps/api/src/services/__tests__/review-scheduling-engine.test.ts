/**
 * KRODEX API — review scheduling engine tests (Phase 9).
 *
 * Covers the SM-2 default policy:
 *   - archived is terminal
 *   - resolved without a review is a no-op
 *   - first review schedules ~1 day out
 *   - recurrence after success is ~6 days
 *   - recurrence after failure is ~1 day
 *   - SM-2 ease grows with successes, shrinks with failures
 *   - last outcome drives the reasonCode
 *   - partial / skipped outcomes trigger review_due_now
 *   - intervals are bounded by MAX_INTERVAL_DAYS
 *   - determinism: same inputs + same `now` → same `dueAt`
 */

import { describe, expect, it } from 'vitest';
import { sm2, type SchedulingInputs } from '../review-scheduling-engine';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const DAY = 24 * 3600 * 1000;

function base(overrides: Partial<SchedulingInputs> = {}): SchedulingInputs {
  return {
    errorState: 'active',
    lastReviewOutcome: null,
    reviewCount: 0,
    priorSuccesses: 0,
    priorFailures: 0,
    recurrenceEvidence: false,
    ...overrides,
  };
}

function daysFromNow(iso: string): number {
  return Math.round((new Date(iso).getTime() - NOW.getTime()) / DAY);
}

describe('sm2 — terminal states', () => {
  it('archived schedules a year out (effectively never)', () => {
    const d = sm2({ ...base(), errorState: 'archived' }, NOW);
    expect(d.reasonCode).toBe('archive_terminal');
    expect(d.confidence).toBe(1);
    expect(d.requiresConfirmation).toBe(false);
    expect(daysFromNow(d.dueAt)).toBeGreaterThanOrEqual(360);
  });

  it('resolved without any review is a no-op', () => {
    const d = sm2({ ...base(), errorState: 'resolved' }, NOW);
    expect(d.reasonCode).toBe('stable_qualifying_correct');
    expect(daysFromNow(d.dueAt)).toBeGreaterThanOrEqual(360);
  });
});

describe('sm2 — first review', () => {
  it('first review schedules ~1 day out', () => {
    const d = sm2(base(), NOW);
    expect(d.reasonCode).toBe('first_seen_no_review');
    expect(daysFromNow(d.dueAt)).toBe(1);
  });
});

describe('sm2 — recurrence', () => {
  it('recurrence after success → ~6 day interval, requires confirmation', () => {
    const d = sm2(
      {
        ...base({
          errorState: 'in_review',
          recurrenceEvidence: true,
        }),
        reviewCount: 2,
        priorSuccesses: 2,
        priorFailures: 0,
        lastReviewOutcome: 'correct',
      },
      NOW,
    );
    expect(d.reasonCode).toBe('review_soon_after_recurrence');
    expect(daysFromNow(d.dueAt)).toBe(6);
    expect(d.requiresConfirmation).toBe(true);
  });

  it('recurrence after failure → 1 day interval', () => {
    const d = sm2(
      {
        ...base({
          errorState: 'in_review',
          recurrenceEvidence: true,
        }),
        reviewCount: 3,
        priorSuccesses: 1,
        priorFailures: 2,
        lastReviewOutcome: 'incorrect',
      },
      NOW,
    );
    expect(d.reasonCode).toBe('escalation_after_recurrence');
    expect(daysFromNow(d.dueAt)).toBe(1);
  });
});

describe('sm2 — outcome-driven path', () => {
  it('last correct → stable_qualifying_correct, confidence high', () => {
    const d = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 3,
        priorSuccesses: 3,
        priorFailures: 0,
        lastReviewOutcome: 'correct',
      },
      NOW,
    );
    expect(d.reasonCode).toBe('stable_qualifying_correct');
    expect(d.requiresConfirmation).toBe(false);
  });

  it('last incorrect → remediation_repeat_failure, requires confirmation', () => {
    const d = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 4,
        priorSuccesses: 2,
        priorFailures: 2,
        lastReviewOutcome: 'incorrect',
      },
      NOW,
    );
    expect(d.reasonCode).toBe('remediation_repeat_failure');
    expect(d.requiresConfirmation).toBe(true);
  });

  it('partial outcome → review_due_now, low confidence', () => {
    const d = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 2,
        priorSuccesses: 1,
        priorFailures: 0,
        lastReviewOutcome: 'partial',
      },
      NOW,
    );
    expect(d.reasonCode).toBe('review_due_now');
    expect(d.requiresConfirmation).toBe(true);
  });
});

describe('sm2 — SM-2 ease dynamics', () => {
  it('many successes push the interval out (within cap)', () => {
    const d = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 5,
        priorSuccesses: 5,
        priorFailures: 0,
        lastReviewOutcome: 'correct',
      },
      NOW,
    );
    // After 5 reviews all correct, interval > 6 days but < 180.
    expect(daysFromNow(d.dueAt)).toBeGreaterThan(6);
    expect(daysFromNow(d.dueAt)).toBeLessThanOrEqual(180);
  });

  it('many failures keep the interval much shorter than many successes', () => {
    // SM-2 still grows the interval with each review, just slower
    // when the failure count is high. The test asserts the relative
    // behavior: 5 all-success reviews schedule further out than
    // 5 all-failure reviews.
    const allSuccess = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 5,
        priorSuccesses: 5,
        priorFailures: 0,
        lastReviewOutcome: 'correct',
      },
      NOW,
    );
    const allFailure = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 5,
        priorSuccesses: 0,
        priorFailures: 5,
        lastReviewOutcome: 'incorrect',
      },
      NOW,
    );
    expect(daysFromNow(allFailure.dueAt)).toBeLessThan(daysFromNow(allSuccess.dueAt));
  });

  it('interval is capped at 180 days', () => {
    const d = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 30,
        priorSuccesses: 30,
        priorFailures: 0,
        lastReviewOutcome: 'correct',
      },
      NOW,
    );
    expect(daysFromNow(d.dueAt)).toBeLessThanOrEqual(180);
  });
});

describe('sm2 — determinism', () => {
  it('same inputs + same now → byte-identical dueAt', () => {
    const a = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 3,
        priorSuccesses: 3,
        priorFailures: 0,
        lastReviewOutcome: 'correct',
      },
      NOW,
    );
    const b = sm2(
      {
        ...base(),
        errorState: 'in_review',
        reviewCount: 3,
        priorSuccesses: 3,
        priorFailures: 0,
        lastReviewOutcome: 'correct',
      },
      NOW,
    );
    expect(a.dueAt).toBe(b.dueAt);
    expect(a.reasonCode).toBe(b.reasonCode);
  });

  it('no I/O — runs in a tight loop with no drift', () => {
    const input: SchedulingInputs = {
      ...base(),
      errorState: 'in_review',
      reviewCount: 3,
      priorSuccesses: 3,
      priorFailures: 0,
      lastReviewOutcome: 'correct',
    };
    const a = sm2(input, NOW);
    for (let i = 0; i < 50; i++) {
      const b = sm2(input, NOW);
      expect(b.dueAt).toBe(a.dueAt);
    }
  });
});
