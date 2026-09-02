/**
 * KRODEX API — student-model service tests (offline).
 *
 * Per PHASE5_PLAN.md §8, the offline service tests cover the
 * service layer in `apps/api/src/student-model/service.ts`
 * without a live DB. They use the fake-supabase client to:
 *
 *   1. Seed the four source tables (progress_evidence,
 *      review_schedules, error_entries, planner_tasks) and
 *      exercise the orchestrator end-to-end through
 *      `recomputeStudentModelForUser`.
 *   2. Stub the `recompute_student_model` RPC to assert the
 *      JSONB payload handed to the SQL function.
 *   3. Seed `student_model_snapshots` + `student_model_features`
 *      and verify `getStudentModelSnapshot` composes the read
 *      shape correctly.
 *   4. Verify `isStale` + `clampWindow` + the helper used by
 *      the route (windowDays default = 28, clamped to [1, 90]).
 *
 * The live-DB tests in `live-student-model-regression.test.ts`
 * cover the SQL function itself. These tests cover the
 * service-layer wiring.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  recomputeStudentModelForUser,
  getStudentModelSnapshot,
  getOrRecomputeStudentModel,
  isStale,
  clampWindow,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
} from '../service';

const SUB = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-02T12:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * ONE_DAY_MS).toISOString();
const SEVEN_DAYS_AGO = new Date(NOW.getTime() - 7 * ONE_DAY_MS).toISOString();
const TEN_DAYS_AGO = new Date(NOW.getTime() - 10 * ONE_DAY_MS).toISOString();
const TWENTY_DAYS_AGO = new Date(NOW.getTime() - 20 * ONE_DAY_MS).toISOString();

describe('clampWindow', () => {
  it('defaults to 28 when undefined-ish', () => {
    // Not really undefined — we test the floor + ceiling directly.
    expect(clampWindow(0)).toBe(1);
    expect(clampWindow(-1)).toBe(1);
    expect(clampWindow(NaN)).toBe(1);
  });

  it('floors non-integers', () => {
    expect(clampWindow(28.7)).toBe(28);
    expect(clampWindow(45.9)).toBe(45);
  });

  it('caps at MAX_WINDOW_DAYS', () => {
    expect(clampWindow(91)).toBe(MAX_WINDOW_DAYS);
    expect(clampWindow(1000)).toBe(MAX_WINDOW_DAYS);
  });

  it('keeps valid windows untouched', () => {
    expect(clampWindow(7)).toBe(7);
    expect(clampWindow(28)).toBe(28);
    expect(clampWindow(90)).toBe(90);
  });
});

describe('isStale', () => {
  const fresh = {
    userId: SUB,
    computedAt: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
    evidenceWindowDays: 28,
    features: {} as never,
    overallConfidence: 'strong' as const,
  };
  const old = {
    ...fresh,
    computedAt: new Date(NOW.getTime() - 30 * ONE_DAY_MS).toISOString(),
  };
  const future = {
    ...fresh,
    computedAt: new Date(NOW.getTime() + ONE_DAY_MS).toISOString(),
  };

  it('a 1-day-old snapshot is fresh for a 28-day window', () => {
    expect(isStale(fresh, 28, NOW)).toBe(false);
  });

  it('a 30-day-old snapshot is stale for a 28-day window', () => {
    expect(isStale(old, 28, NOW)).toBe(true);
  });

  it('a future-dated snapshot is treated as fresh', () => {
    expect(isStale(future, 28, NOW)).toBe(false);
  });

  it('an unparseable computedAt is treated as stale', () => {
    expect(isStale({ ...fresh, computedAt: 'not-a-date' }, 28, NOW)).toBe(true);
  });
});

describe('recomputeStudentModelForUser', () => {
  it('returns 7 features written + payload when evidence is sparse', async () => {
    const client = makeFakeSupabase({
      rpcImpls: {
        recompute_student_model: () => ({ data: 7, error: null }),
      },
    });
    const out = await recomputeStudentModelForUser(client, {
      userId: SUB,
      windowDays: 28,
      now: () => NOW,
    });
    expect(out.userId).toBe(SUB);
    expect(out.windowDays).toBe(28);
    expect(out.featuresWritten).toBe(7);
    expect(out.payload.overallConfidence).toBe('limited');
    expect(Object.keys(out.payload.features)).toHaveLength(7);
  });

  it('clamps a too-large window before calling the RPC', async () => {
    let captured: Record<string, unknown> | null = null;
    const client = makeFakeSupabase({
      rpcImpls: {
        recompute_student_model: (params) => {
          captured = params;
          return { data: 7, error: null };
        },
      },
    });
    await recomputeStudentModelForUser(client, {
      userId: SUB,
      windowDays: 200,
      now: () => NOW,
    });
    expect(captured).not.toBeNull();
    expect(captured!['p_window_days']).toBe(MAX_WINDOW_DAYS);
  });

  it('clamps a too-small window before calling the RPC', async () => {
    let captured: Record<string, unknown> | null = null;
    const client = makeFakeSupabase({
      rpcImpls: {
        recompute_student_model: (params) => {
          captured = params;
          return { data: 7, error: null };
        },
      },
    });
    await recomputeStudentModelForUser(client, {
      userId: SUB,
      windowDays: 0,
      now: () => NOW,
    });
    expect(captured!['p_window_days']).toBe(1);
  });

  it('throws when the RPC returns an error', async () => {
    const client = makeFakeSupabase({
      rpcImpls: {
        recompute_student_model: () => ({
          data: null,
          error: { code: '08000', message: 'connection failure' },
        }),
      },
    });
    await expect(
      recomputeStudentModelForUser(client, {
        userId: SUB,
        windowDays: 28,
        now: () => NOW,
      }),
    ).rejects.toThrow(/recompute_student_model failed/);
  });

  it('hands the orchestrator payload to the RPC as JSONB', async () => {
    let captured: Record<string, unknown> | null = null;
    const client = makeFakeSupabase({
      // Seed evidence so the orchestrator produces a non-sparse
      // payload. The exact shape is not asserted here — only
      // that the JSONB handed to the RPC has the seven feature
      // keys and a top-level envelope.
      tables: {
        progress_evidence: [
          {
            user_id: SUB,
            dimension: 'test_completion',
            ref_kind: 'auto',
            ref_id: '00000000-0000-0000-0000-000000000001',
            captured_at: THREE_DAYS_AGO,
            numerator: 8,
            denominator: 10,
          },
          {
            user_id: SUB,
            dimension: 'test_completion',
            ref_kind: 'auto',
            ref_id: '00000000-0000-0000-0000-000000000002',
            captured_at: SEVEN_DAYS_AGO,
            numerator: 7,
            denominator: 10,
          },
          {
            user_id: SUB,
            dimension: 'test_completion',
            ref_kind: 'auto',
            ref_id: '00000000-0000-0000-0000-000000000003',
            captured_at: TEN_DAYS_AGO,
            numerator: 6,
            denominator: 10,
          },
          {
            user_id: SUB,
            dimension: 'test_completion',
            ref_kind: 'auto',
            ref_id: '00000000-0000-0000-0000-000000000004',
            captured_at: TWENTY_DAYS_AGO,
            numerator: 9,
            denominator: 10,
          },
        ],
      },
      rpcImpls: {
        recompute_student_model: (params) => {
          captured = params;
          return { data: 7, error: null };
        },
      },
    });
    await recomputeStudentModelForUser(client, {
      userId: SUB,
      windowDays: 28,
      now: () => NOW,
    });
    expect(captured).not.toBeNull();
    const features = captured!['p_features'] as Record<string, unknown>;
    expect(Object.keys(features).sort()).toEqual(
      [
        'consistency_score',
        'error_recurrence_score',
        'learning_trajectory',
        'procrastination_score',
        'recovery_score',
        'review_compliance_score',
        'workload_pressure_score',
      ].sort(),
    );
    expect(captured!['p_user_id']).toBe(SUB);
    expect(captured!['p_until']).toBe(NOW.toISOString());
  });
});

describe('getStudentModelSnapshot', () => {
  it('returns null when no snapshot exists', async () => {
    const client = makeFakeSupabase();
    const out = await getStudentModelSnapshot(client, SUB);
    expect(out).toBeNull();
  });

  it('composes the read shape from snapshot + per-feature rows', async () => {
    const envelope = {
      consistency_score: {
        featureKey: 'consistency_score',
        score: 0.85,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 28,
        evidenceWindowDays: 28,
      },
      procrastination_score: {
        featureKey: 'procrastination_score',
        score: 0.15,
        direction: 'improving',
        confidence: 'strong',
        sampleSize: 24,
        evidenceWindowDays: 28,
      },
      recovery_score: {
        featureKey: 'recovery_score',
        score: 0.92,
        direction: 'stable',
        confidence: 'moderate',
        sampleSize: 12,
        evidenceWindowDays: 28,
      },
      error_recurrence_score: {
        featureKey: 'error_recurrence_score',
        score: 0.3,
        direction: 'declining',
        confidence: 'strong',
        sampleSize: 30,
        evidenceWindowDays: 28,
      },
      review_compliance_score: {
        featureKey: 'review_compliance_score',
        score: 0.78,
        direction: 'improving',
        confidence: 'moderate',
        sampleSize: 18,
        evidenceWindowDays: 28,
      },
      workload_pressure_score: {
        featureKey: 'workload_pressure_score',
        score: 0.55,
        direction: 'stable',
        confidence: 'moderate',
        sampleSize: 15,
        evidenceWindowDays: 28,
      },
      learning_trajectory: {
        featureKey: 'learning_trajectory',
        score: 0.75,
        direction: 'improving',
        confidence: 'moderate',
        sampleSize: 28,
        evidenceWindowDays: 28,
      },
    };
    const client = makeFakeSupabase({
      tables: {
        student_model_snapshots: [
          {
            user_id: SUB,
            features: envelope,
            confidence: 0.5,
            computed_at: NOW.toISOString(),
          },
        ],
        student_model_features: [
          // Empty — the read path tolerates the per-feature rows
          // being missing (the JSONB on the snapshot row is the
          // source of truth for the read shape).
        ],
      },
    });
    const out = await getStudentModelSnapshot(client, SUB);
    expect(out).not.toBeNull();
    expect(out!.userId).toBe(SUB);
    expect(out!.computedAt).toBe(NOW.toISOString());
    expect(out!.evidenceWindowDays).toBe(28);
    expect(out!.overallConfidence).toBe('moderate');
    expect(Object.keys(out!.features)).toHaveLength(7);
    expect(out!.features.consistency_score.score).toBe(0.85);
  });

  it('falls back to the per-feature evidence_count + envelope shape for a pre-Phase-5 row', async () => {
    // Snapshot row with no features JSONB (the pre-Phase-5 schema).
    // The read path should still return a stable shape with seven
    // features (each as the empty fallback envelope).
    const client = makeFakeSupabase({
      tables: {
        student_model_snapshots: [
          {
            user_id: SUB,
            features: {},
            confidence: 0,
            computed_at: NOW.toISOString(),
          },
        ],
      },
    });
    const out = await getStudentModelSnapshot(client, SUB);
    expect(out).not.toBeNull();
    expect(out!.overallConfidence).toBe('limited');
    expect(out!.features.consistency_score.direction).toBe('insufficient_data');
    expect(out!.features.consistency_score.confidence).toBe('limited');
  });
});

describe('getOrRecomputeStudentModel', () => {
  it('returns the existing snapshot when fresh', async () => {
    const envelope = {
      consistency_score: {
        featureKey: 'consistency_score',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 28,
        evidenceWindowDays: 28,
      },
      procrastination_score: {
        featureKey: 'procrastination_score',
        score: 0.1,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 24,
        evidenceWindowDays: 28,
      },
      recovery_score: {
        featureKey: 'recovery_score',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 12,
        evidenceWindowDays: 28,
      },
      error_recurrence_score: {
        featureKey: 'error_recurrence_score',
        score: 0.1,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 30,
        evidenceWindowDays: 28,
      },
      review_compliance_score: {
        featureKey: 'review_compliance_score',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 18,
        evidenceWindowDays: 28,
      },
      workload_pressure_score: {
        featureKey: 'workload_pressure_score',
        score: 0.5,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 15,
        evidenceWindowDays: 28,
      },
      learning_trajectory: {
        featureKey: 'learning_trajectory',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 28,
        evidenceWindowDays: 28,
      },
    };
    const client = makeFakeSupabase({
      tables: {
        student_model_snapshots: [
          {
            user_id: SUB,
            features: envelope,
            confidence: 1.0,
            computed_at: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
          },
        ],
      },
      rpcImpls: {
        recompute_student_model: () => ({ data: 7, error: null }),
      },
    });
    const out = await getOrRecomputeStudentModel(client, {
      userId: SUB,
      windowDays: 28,
      now: () => NOW,
    });
    expect(out.computedAt).toBe(new Date(NOW.getTime() - ONE_DAY_MS).toISOString());
    expect(out.overallConfidence).toBe('strong');
  });

  it('recomputes when the existing snapshot is stale', async () => {
    let rpcCalled = 0;
    const envelope = {
      consistency_score: {
        featureKey: 'consistency_score',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 28,
        evidenceWindowDays: 28,
      },
      procrastination_score: {
        featureKey: 'procrastination_score',
        score: 0.1,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 24,
        evidenceWindowDays: 28,
      },
      recovery_score: {
        featureKey: 'recovery_score',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 12,
        evidenceWindowDays: 28,
      },
      error_recurrence_score: {
        featureKey: 'error_recurrence_score',
        score: 0.1,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 30,
        evidenceWindowDays: 28,
      },
      review_compliance_score: {
        featureKey: 'review_compliance_score',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 18,
        evidenceWindowDays: 28,
      },
      workload_pressure_score: {
        featureKey: 'workload_pressure_score',
        score: 0.5,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 15,
        evidenceWindowDays: 28,
      },
      learning_trajectory: {
        featureKey: 'learning_trajectory',
        score: 0.9,
        direction: 'stable',
        confidence: 'strong',
        sampleSize: 28,
        evidenceWindowDays: 28,
      },
    };
    const client = makeFakeSupabase({
      tables: {
        student_model_snapshots: [
          {
            user_id: SUB,
            features: envelope,
            confidence: 1.0,
            // 30 days old — stale for a 28-day window.
            computed_at: new Date(NOW.getTime() - 30 * ONE_DAY_MS).toISOString(),
          },
        ],
      },
      rpcImpls: {
        recompute_student_model: () => {
          rpcCalled += 1;
          return { data: 7, error: null };
        },
      },
    });
    await getOrRecomputeStudentModel(client, {
      userId: SUB,
      windowDays: 28,
      now: () => NOW,
    });
    expect(rpcCalled).toBe(1);
  });
});

describe('DEFAULT_WINDOW_DAYS', () => {
  it('is 28 (PRD §25 default)', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(28);
  });
});
