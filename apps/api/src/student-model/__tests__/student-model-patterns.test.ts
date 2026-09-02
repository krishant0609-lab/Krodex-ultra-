/**
 * KRODEX API — student-model pattern module tests (Phase 5).
 *
 * Per PHASE5_PLAN §8, these tests assert the contract of each
 * of the six pattern modules with synthetic inputs. They do
 * NOT hit a real Supabase — they feed pre-built evidence
 * arrays into `PatternInput` directly.
 *
 * Coverage:
 *   - Each module returns the empty envelope for empty
 *     evidence (insufficient_data, score=0, limited).
 *   - Sparse evidence (1-2 distinct days) yields
 *     insufficient_data direction.
 *   - Normal evidence yields a non-null score in [0,1].
 *   - Improving / declining series feed through `directionFor`
 *     to the matching label.
 *   - `learning_trajectory.fuseDirection` covers the four-quadrant
 *     decision table.
 *
 * The helpers in `analytics/thresholds.ts` (D-2 ladder) and
 * `analytics/trend.ts` (D-3 trend) are pinned in their own test
 * files; here we only assert that the pattern modules wire them
 * correctly.
 */

import { describe, it, expect } from 'vitest';

import type {
  PatternInput,
  StudentModelEvidence,
  TestCompletionRow,
  ReviewScheduleRow,
  ErrorEntryRow,
  PlannerTaskRow,
} from '../types';

import * as consistencyMod from '../patterns/consistency';
import * as procrastinationMod from '../patterns/procrastination_recovery';
import * as errorRecurrenceMod from '../patterns/error_recurrence';
import * as reviewBehaviorMod from '../patterns/review_behavior';
import * as workloadMod from '../patterns/workload_pressure';
import {
  computeFromUpstream,
  fuseDirection,
} from '../patterns/learning_trajectory';
import { clamp01, emptyOutput } from '../patterns/_helpers';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const WINDOW_DAYS = 28;
const UNTIL = new Date('2026-09-02T12:00:00.000Z');

/** Helper: build a PatternInput with empty evidence. */
function emptyInput(): PatternInput {
  const evidence: StudentModelEvidence = {
    testCompletion: [],
    reviewSchedules: [],
    errorEntries: [],
    plannerTasks: [],
  };
  return {
    userId: USER_ID,
    until: UNTIL,
    windowDays: WINDOW_DAYS,
    evidence,
  };
}

/** Build a `progress_evidence` test_completion row on a given day. */
function tcRow(dayIso: string, num: number, den: number): TestCompletionRow {
  return {
    user_id: USER_ID,
    dimension: 'test_completion',
    ref_kind: 'test',
    ref_id: '00000000-0000-0000-0000-000000000001',
    captured_at: dayIso,
    numerator: num,
    denominator: den,
  };
}

/** Build a `review_schedules` row on a given day. */
function reviewRow(
  dueDate: string,
  reviewDate: string | null,
  status: ReviewScheduleRow['status'],
): ReviewScheduleRow {
  return {
    user_id: USER_ID,
    due_date: dueDate,
    review_date: reviewDate,
    status,
  };
}

/** Build an `error_entries` row on a given day. */
function errRow(dayIso: string, type: string): ErrorEntryRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: USER_ID,
    error_type: type,
    captured_at: dayIso,
  };
}

/** Build a `planner_tasks` row. */
function taskRow(
  createdAt: string,
  updatedAt: string,
  status: PlannerTaskRow['status'],
): PlannerTaskRow {
  return {
    user_id: USER_ID,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

// ---------------------------------------------------------------------------
// _helpers
// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('clamp01 clamps to [0, 1] and treats non-finite as 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('emptyOutput produces the documented empty envelope', () => {
    const out = emptyOutput('consistency_score', WINDOW_DAYS);
    expect(out).toEqual({
      featureKey: 'consistency_score',
      score: 0,
      direction: 'insufficient_data',
      confidence: 'limited',
      sampleSize: 0,
      evidenceWindowDays: WINDOW_DAYS,
    });
  });
});

// ---------------------------------------------------------------------------
// consistency
// ---------------------------------------------------------------------------

describe('consistency.compute', () => {
  it('returns the empty envelope when there is no test_completion evidence', async () => {
    const out = await consistencyMod.compute(emptyInput());
    expect(out.featureKey).toBe('consistency_score');
    expect(out.score).toBe(0);
    expect(out.direction).toBe('insufficient_data');
    expect(out.confidence).toBe('limited');
    expect(out.sampleSize).toBe(0);
    expect(out.evidenceWindowDays).toBe(WINDOW_DAYS);
  });

  it('returns insufficient_data for a single day of evidence', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        testCompletion: [tcRow('2026-09-01T10:00:00Z', 5, 10)],
      },
    };
    const out = await consistencyMod.compute(input);
    // stddev is undefined for n=1 → variance=0 → score=1, but
    // direction is still insufficient because we have <3
    // distinct days.
    expect(out.score).toBe(1);
    expect(out.direction).toBe('insufficient_data');
    expect(out.sampleSize).toBe(1);
    expect(out.confidence).toBe('limited');
  });

  it('returns insufficient_data for 2 distinct days', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        testCompletion: [
          tcRow('2026-08-31T10:00:00Z', 5, 10),
          tcRow('2026-09-01T10:00:00Z', 5, 10),
        ],
      },
    };
    const out = await consistencyMod.compute(input);
    expect(out.direction).toBe('insufficient_data');
    expect(out.sampleSize).toBe(2);
  });

  it('returns score=1 when all daily ratios are identical (stdDev=0)', async () => {
    // 5 distinct days, all 0.8 completion → zero variability.
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        testCompletion: [
          tcRow('2026-08-29T10:00:00Z', 8, 10),
          tcRow('2026-08-30T10:00:00Z', 8, 10),
          tcRow('2026-08-31T10:00:00Z', 8, 10),
          tcRow('2026-09-01T10:00:00Z', 8, 10),
          tcRow('2026-09-02T10:00:00Z', 8, 10),
        ],
      },
    };
    const out = await consistencyMod.compute(input);
    expect(out.score).toBe(1);
    // 5 samples is the boundary: 5 <= n < 20 → 'moderate'.
    expect(out.confidence).toBe('moderate');
  });

  it('returns a low score for high variability (alternating 1.0 and 0.0)', async () => {
    // Daily ratios: [1, 0, 1, 0, 1] → mean=0.6, stdDev≈0.55 → score≈0.45.
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        testCompletion: [
          tcRow('2026-08-29T10:00:00Z', 10, 10),
          tcRow('2026-08-30T10:00:00Z', 0, 10),
          tcRow('2026-08-31T10:00:00Z', 10, 10),
          tcRow('2026-09-01T10:00:00Z', 0, 10),
          tcRow('2026-09-02T10:00:00Z', 10, 10),
        ],
      },
    };
    const out = await consistencyMod.compute(input);
    expect(out.score).toBeLessThan(0.5);
    expect(out.sampleSize).toBe(5);
    expect(out.confidence).toBe('moderate');
  });

  it('detects "improving" direction when trailing half is meaningfully higher', async () => {
    // 6 distinct days: 0.3, 0.3, 0.3 then 0.7, 0.7, 0.7.
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        testCompletion: [
          tcRow('2026-08-28T10:00:00Z', 3, 10),
          tcRow('2026-08-29T10:00:00Z', 3, 10),
          tcRow('2026-08-30T10:00:00Z', 3, 10),
          tcRow('2026-08-31T10:00:00Z', 7, 10),
          tcRow('2026-09-01T10:00:00Z', 7, 10),
          tcRow('2026-09-02T10:00:00Z', 7, 10),
        ],
      },
    };
    const out = await consistencyMod.compute(input);
    expect(out.direction).toBe('improving');
  });
});

// ---------------------------------------------------------------------------
// procrastination + recovery
// ---------------------------------------------------------------------------

describe('procrastination_recovery.compute', () => {
  it('returns two empty envelopes when there is no review evidence', async () => {
    const out = await procrastinationMod.compute(emptyInput());
    expect(out.procrastination.featureKey).toBe('procrastination_score');
    expect(out.recovery.featureKey).toBe('recovery_score');
    expect(out.procrastination.score).toBe(0);
    expect(out.recovery.score).toBe(0);
    expect(out.procrastination.direction).toBe('insufficient_data');
    expect(out.recovery.direction).toBe('insufficient_data');
  });

  it('computes procrastination=0 when all reviews are scheduled (no misses)', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        reviewSchedules: [
          reviewRow('2026-08-30T00:00:00Z', null, 'scheduled'),
          reviewRow('2026-08-31T00:00:00Z', null, 'scheduled'),
          reviewRow('2026-09-01T00:00:00Z', null, 'scheduled'),
        ],
      },
    };
    const out = await procrastinationMod.compute(input);
    expect(out.procrastination.score).toBe(0);
    // No completed rows → avgDelay=0 → recovery score = 1.
    expect(out.recovery.score).toBe(1);
  });

  it('computes procrastination=1 when every review in the window is missed', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        reviewSchedules: [
          reviewRow('2026-08-30T00:00:00Z', null, 'missed'),
          reviewRow('2026-08-31T00:00:00Z', null, 'missed'),
          reviewRow('2026-09-01T00:00:00Z', null, 'missed'),
        ],
      },
    };
    const out = await procrastinationMod.compute(input);
    expect(out.procrastination.score).toBe(1);
  });

  it('computes recovery close to 1 for on-time completions', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        reviewSchedules: [
          reviewRow('2026-08-30T00:00:00Z', '2026-08-30T01:00:00Z', 'completed'),
          reviewRow('2026-08-31T00:00:00Z', '2026-08-31T01:00:00Z', 'completed'),
          reviewRow('2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z', 'completed'),
        ],
      },
    };
    const out = await procrastinationMod.compute(input);
    // Delay ≈ 23h = ~0.04 days → 1 - 0.04/30 ≈ 0.999
    expect(out.recovery.score).toBeGreaterThan(0.95);
  });

  it('computes recovery=0 for a 30-day delay (worst case)', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        reviewSchedules: [
          reviewRow('2026-07-01T00:00:00Z', '2026-07-31T00:00:00Z', 'completed'),
        ],
      },
    };
    const out = await procrastinationMod.compute(input);
    expect(out.recovery.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// error_recurrence
// ---------------------------------------------------------------------------

describe('error_recurrence.compute', () => {
  it('returns the empty envelope for fewer than 2 errors', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        errorEntries: [errRow('2026-09-01T10:00:00Z', 'concept')],
      },
    };
    const out = await errorRecurrenceMod.compute(input);
    expect(out.score).toBe(0);
    expect(out.direction).toBe('insufficient_data');
    expect(out.sampleSize).toBe(0); // emptyOutput reports 0
  });

  it('computes score=1 when all errors share a single type', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        errorEntries: [
          errRow('2026-08-30T10:00:00Z', 'concept'),
          errRow('2026-08-31T10:00:00Z', 'concept'),
          errRow('2026-09-01T10:00:00Z', 'concept'),
        ],
      },
    };
    const out = await errorRecurrenceMod.compute(input);
    expect(out.score).toBe(1);
  });

  it('computes score=0.5 when 2 of 4 errors share a type', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        errorEntries: [
          errRow('2026-08-29T10:00:00Z', 'concept'),
          errRow('2026-08-30T10:00:00Z', 'calculation'),
          errRow('2026-08-31T10:00:00Z', 'concept'),
          errRow('2026-09-01T10:00:00Z', 'method'),
        ],
      },
    };
    const out = await errorRecurrenceMod.compute(input);
    expect(out.score).toBe(0.5);
    expect(out.sampleSize).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// review_behavior
// ---------------------------------------------------------------------------

describe('review_behavior.compute', () => {
  it('returns the empty envelope when there is no review evidence', async () => {
    const out = await reviewBehaviorMod.compute(emptyInput());
    expect(out.featureKey).toBe('review_compliance_score');
    expect(out.score).toBe(0);
    expect(out.direction).toBe('insufficient_data');
  });

  it('returns compliance=1 when all closed-out reviews were completed', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        reviewSchedules: [
          reviewRow('2026-08-30T00:00:00Z', '2026-08-30T01:00:00Z', 'completed'),
          reviewRow('2026-08-31T00:00:00Z', '2026-08-31T01:00:00Z', 'completed'),
        ],
      },
    };
    const out = await reviewBehaviorMod.compute(input);
    expect(out.score).toBeGreaterThan(0.95);
  });

  it('returns compliance component=0 when every closed-out review was missed', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        reviewSchedules: [
          reviewRow('2026-08-30T00:00:00Z', null, 'missed'),
          reviewRow('2026-08-31T00:00:00Z', null, 'missed'),
        ],
      },
    };
    const out = await reviewBehaviorMod.compute(input);
    // compliance=0 (0 completed / 2 closed), timing=1 (no completed
    // rows → avgDelay=0 → timing=1). Combined = (0+1)/2 = 0.5.
    // The point of this test is that the module still produces
    // a valid non-null score; pure compliance=0 lives in the
    // module's internal formula and is not separately exposed.
    expect(out.score).toBe(0.5);
    expect(out.sampleSize).toBe(0); // no completed reviews
    expect(out.confidence).toBe('limited');
  });
});

// ---------------------------------------------------------------------------
// workload_pressure
// ---------------------------------------------------------------------------

describe('workload_pressure.compute', () => {
  it('returns the empty envelope when no tasks and no reviews', async () => {
    const out = await workloadMod.compute(emptyInput());
    expect(out.featureKey).toBe('workload_pressure_score');
    expect(out.score).toBe(0);
    expect(out.direction).toBe('insufficient_data');
  });

  it('falls back to review_schedules when fewer than 3 tasks are present', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        plannerTasks: [
          taskRow('2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z', 'active'),
        ],
        reviewSchedules: [
          reviewRow('2026-08-30T00:00:00Z', null, 'scheduled'),
          reviewRow('2026-08-31T00:00:00Z', null, 'scheduled'),
          reviewRow('2026-09-01T00:00:00Z', null, 'scheduled'),
        ],
      },
    };
    const out = await workloadMod.compute(input);
    // Fallback uses reviews → sample is 3 → score is
    // scheduled / max_per_day (=1) = 1.
    expect(out.score).toBe(1);
  });

  it('uses planner_tasks when there are 3+ rows in the window', async () => {
    const input: PatternInput = {
      ...emptyInput(),
      evidence: {
        ...emptyInput().evidence,
        plannerTasks: [
          taskRow('2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z', 'active'),
          taskRow('2026-08-31T00:00:00Z', '2026-08-31T00:00:00Z', 'active'),
          taskRow('2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 'completed'),
        ],
      },
    };
    const out = await workloadMod.compute(input);
    expect(out.score).toBe(1); // active / max = 2/2 = 1
    expect(out.sampleSize).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// learning_trajectory
// ---------------------------------------------------------------------------

describe('learning_trajectory.fuseDirection', () => {
  // The four-quadrant table from PRD §25.6.
  it('"improving" wins when either side is improving', () => {
    expect(fuseDirection('improving', 'improving')).toBe('improving');
    expect(fuseDirection('improving', 'declining')).toBe('improving');
    expect(fuseDirection('improving', 'stable')).toBe('improving');
    expect(fuseDirection('improving', 'insufficient_data')).toBe('improving');
    expect(fuseDirection('stable', 'improving')).toBe('improving');
    expect(fuseDirection('declining', 'improving')).toBe('improving');
    expect(fuseDirection('insufficient_data', 'improving')).toBe('improving');
  });

  it('"declining" wins when one side is declining and the other is not improving', () => {
    expect(fuseDirection('declining', 'declining')).toBe('declining');
    expect(fuseDirection('declining', 'stable')).toBe('declining');
    expect(fuseDirection('declining', 'insufficient_data')).toBe('declining');
    expect(fuseDirection('stable', 'declining')).toBe('declining');
    expect(fuseDirection('insufficient_data', 'declining')).toBe('declining');
  });

  it('"stable" wins when both sides are stable', () => {
    expect(fuseDirection('stable', 'stable')).toBe('stable');
  });

  it('"insufficient_data" returns when both sides are insufficient', () => {
    expect(fuseDirection('insufficient_data', 'insufficient_data')).toBe(
      'insufficient_data',
    );
  });
});

describe('learning_trajectory.computeFromUpstream', () => {
  it('returns the empty envelope when both upstreams are insufficient', async () => {
    const out = await computeFromUpstream({
      consistency: {
        featureKey: 'consistency_score',
        score: 0,
        direction: 'insufficient_data',
        confidence: 'limited',
        sampleSize: 0,
        evidenceWindowDays: WINDOW_DAYS,
      },
      errorRecurrence: {
        featureKey: 'error_recurrence_score',
        score: 0,
        direction: 'insufficient_data',
        confidence: 'limited',
        sampleSize: 0,
        evidenceWindowDays: WINDOW_DAYS,
      },
      windowDays: WINDOW_DAYS,
    });
    expect(out.featureKey).toBe('learning_trajectory');
    expect(out.score).toBe(0);
    expect(out.direction).toBe('insufficient_data');
  });

  it('declines when both upstreams decline (contradictory-signal scenario from plan)', async () => {
    const out = await computeFromUpstream({
      consistency: {
        featureKey: 'consistency_score',
        score: 0.3,
        direction: 'declining',
        confidence: 'moderate',
        sampleSize: 10,
        evidenceWindowDays: WINDOW_DAYS,
      },
      errorRecurrence: {
        featureKey: 'error_recurrence_score',
        score: 0.7,
        direction: 'declining',
        confidence: 'moderate',
        sampleSize: 10,
        evidenceWindowDays: WINDOW_DAYS,
      },
      windowDays: WINDOW_DAYS,
    });
    expect(out.direction).toBe('declining');
    // score = (0.3 * 2 + (1 - 0.7)) / 3 = (0.6 + 0.3) / 3 = 0.3
    expect(out.score).toBeCloseTo(0.3, 5);
    // confidence = min(moderate, moderate) = moderate
    expect(out.confidence).toBe('moderate');
  });

  it('improves when both upstreams improve', async () => {
    const out = await computeFromUpstream({
      consistency: {
        featureKey: 'consistency_score',
        score: 0.8,
        direction: 'improving',
        confidence: 'strong',
        sampleSize: 30,
        evidenceWindowDays: WINDOW_DAYS,
      },
      errorRecurrence: {
        featureKey: 'error_recurrence_score',
        score: 0.2,
        direction: 'improving',
        confidence: 'strong',
        sampleSize: 30,
        evidenceWindowDays: WINDOW_DAYS,
      },
      windowDays: WINDOW_DAYS,
    });
    expect(out.direction).toBe('improving');
    // score = (0.8 * 2 + (1 - 0.2)) / 3 = (1.6 + 0.8) / 3 = 0.8
    expect(out.score).toBeCloseTo(0.8, 5);
    expect(out.confidence).toBe('strong');
  });

  it('confidence is min of the two upstream confidences', async () => {
    const out = await computeFromUpstream({
      consistency: {
        featureKey: 'consistency_score',
        score: 0.8,
        direction: 'improving',
        confidence: 'strong',
        sampleSize: 30,
        evidenceWindowDays: WINDOW_DAYS,
      },
      errorRecurrence: {
        featureKey: 'error_recurrence_score',
        score: 0.2,
        direction: 'improving',
        confidence: 'limited',
        sampleSize: 2,
        evidenceWindowDays: WINDOW_DAYS,
      },
      windowDays: WINDOW_DAYS,
    });
    expect(out.confidence).toBe('limited');
    expect(out.sampleSize).toBe(2);
  });
});
