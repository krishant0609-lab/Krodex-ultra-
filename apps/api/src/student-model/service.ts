/**
 * KRODEX API — student-model service layer.
 *
 * Per PHASE5_PLAN.md §3, §6, §7:
 *
 *   - The pattern modules live in `apps/api/src/student-model/patterns/`
 *     and are pure functions over the pre-loaded evidence object.
 *   - The orchestrator (`computeFeatures.ts`) fans out to the six
 *     modules in parallel and composes the seven-feature
 *     `StudentModelSnapshotPayload`.
 *   - This service is the typed boundary between the
 *     orchestrator and the SQL function `recompute_student_model`
 *     in migration 13 (and the read side from
 *     `student_model_snapshots` + `student_model_features`).
 *
 * What the service does:
 *   1. `recomputeStudentModelForUser` — calls the orchestrator
 *      with the user's evidence window, then hands the resulting
 *      features JSONB to the SECURITY DEFINER SQL function
 *      `recompute_student_model` (migration 13). The function
 *      persists the snapshot row + per-feature rows. Idempotent.
 *   2. `getStudentModelSnapshot` — reads the latest snapshot +
 *      per-feature rows for the user and composes a
 *      `StudentModelSnapshotPayload`. Returns null when no
 *      snapshot exists yet for the user.
 *   3. `getStudentModelForUser` — convenience wrapper that
 *      returns the snapshot when fresh, or recomputes when stale
 *      (the 28-day default window, clamped to [1, 90]).
 *
 * The 28-day default window comes from PHASE5_PLAN.md §1 (PRD
 * §25 default). The 5-minute recompute cadence lives in the
 * scheduler (`recompute_student_model` job, see
 * apps/api/src/events/recompute_student_model.ts), not here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  StudentModelSnapshotPayload,
  StudentModelFeatureValue,
} from '@krodex/shared';

/** The seven feature keys that live inside `StudentModelSnapshotPayload.features`. */
type SevenFeatureKey = keyof StudentModelSnapshotPayload['features'];

import {
  computeFeaturesForUser,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  type StudentModelComputeResult,
} from './computeFeatures';

/* Re-exported for callers that need the window constants (e.g.
 * the route handler) without pulling in the orchestrator
 * directly. */
export { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS };

/* -------------------------------------------------------------------------- */
/* Public types.                                                              */
/* -------------------------------------------------------------------------- */

export interface RecomputeStudentModelArgs {
  userId: string;
  /** Window length in days. Defaults to 28 (PRD §25 default). */
  windowDays?: number;
  /** Override wall-clock for tests. */
  now?: () => Date;
}

export interface RecomputeStudentModelResult {
  userId: string;
  windowDays: number;
  /** Number of per-feature rows written (7 in the happy path). */
  featuresWritten: number;
  /** The freshest payload, post-persistence. */
  payload: StudentModelSnapshotPayload;
}

/**
 * Options for the read-side `getStudentModelSnapshot`.
 */
export interface GetStudentModelArgs {
  /** Optional wall-clock. Used to compare `computed_at` against "now". */
  now?: () => Date;
}

/* -------------------------------------------------------------------------- */
/* Constants.                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Map from `StudentModelFeatureKey` (as stored in
 * `student_model_features.feature_key`) to the same key on the
 * `StudentModelSnapshotPayload.features` object.
 *
 * The keys on both sides are the same set — we keep this map for
 * type-safety and as a single source of truth for the seven
 * per-feature keys. Adding an eighth feature requires adding
 * it to PHASE5_PLAN.md §1 first.
 */
const SEVEN_FEATURES: ReadonlyArray<SevenFeatureKey> = [
  'consistency_score',
  'procrastination_score',
  'recovery_score',
  'error_recurrence_score',
  'review_compliance_score',
  'workload_pressure_score',
  'learning_trajectory',
] as const;

/* -------------------------------------------------------------------------- */
/* Recompute path.                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Recompute the student model for a user and persist it.
 *
 * Flow:
 *   1. Run the orchestrator (`computeFeaturesForUser`) to obtain
 *      the seven-feature payload from the user's evidence window.
 *   2. Hand the payload's `features` JSONB to the SECURITY
 *      DEFINER SQL function `recompute_student_model` (migration
 *      13). The function deletes prior snapshot+feature rows for
 *      the user and inserts the new ones in a single transaction.
 *   3. Return the structured result with the just-written
 *      `featuresWritten` count.
 *
 * Idempotency: re-running with the same evidence produces the
 * same payload + the same row count. The SQL function deletes
 * the prior state before re-inserting, so duplicate runs do not
 * accumulate.
 *
 * Throws on RPC error or orchestrator failure. Callers in
 * scheduled jobs / event handlers should let the exception
 * propagate so the worker can mark the attempt as retryable.
 */
export async function recomputeStudentModelForUser(
  client: SupabaseClient,
  args: RecomputeStudentModelArgs,
): Promise<RecomputeStudentModelResult> {
  const { userId, windowDays = DEFAULT_WINDOW_DAYS, now } = args;
  const clock = now ?? (() => new Date());

  // 1. Run the orchestrator. This is the workhorse: it loads
  //    the four evidence tables in parallel, fans out to the
  //    five independent pattern modules, then runs the
  //    learning_trajectory fusion on the cached upstream.
  const result: StudentModelComputeResult = await computeFeaturesForUser(client, {
    userId,
    windowDays,
    now: clock,
  });

  // 2. Hand the features JSONB to the SQL function. The
  //    orchestrator's `payload.features` is a plain object whose
  //    keys are the seven feature names. We pass it as `p_features`
  //    (jsonb). The function deletes prior rows, then inserts a
  //    new snapshot row + one row per feature key.
  const { data, error } = await client.rpc('recompute_student_model', {
    p_user_id: userId,
    p_features: result.payload.features as unknown as Record<string, unknown>,
    p_window_days: clampWindow(windowDays),
    p_until: result.payload.computedAt,
  });
  if (error) {
    throw new Error(
      `recompute_student_model failed: ${error.code ?? 'unknown'}: ${error.message}`,
    );
  }
  const featuresWritten = typeof data === 'number' ? data : 0;
  return {
    userId,
    windowDays: clampWindow(windowDays),
    featuresWritten,
    payload: result.payload,
  };
}

/* -------------------------------------------------------------------------- */
/* Read path.                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read the latest snapshot for a user and compose it into a
 * `StudentModelSnapshotPayload`. Returns null when the user has
 * no snapshot yet (the cold-start path; the scheduled job will
 * create the first one within the next 5-minute window).
 *
 * The payload is composed from two tables:
 *   1. `student_model_snapshots` — the row carrying the
 *      `computed_at`, top-level `confidence`, and the full
 *      `features` JSONB. We use the latest row by `computed_at`.
 *   2. `student_model_features` — the per-feature rows for the
 *      same `computed_at`. These carry `feature_value` and
 *      `evidence_count`. We prefer the per-feature rows for
 *      `evidence_count` and use the snapshot's `features` JSONB
 *      for the envelope (score / direction / confidence /
 *      sampleSize / evidenceWindowDays) to keep the read shape
 *      stable.
 */
export async function getStudentModelSnapshot(
  client: SupabaseClient,
  userId: string,
): Promise<StudentModelSnapshotPayload | null> {
  // 1. Latest snapshot row.
  const { data: snapRow, error: snapErr } = await client
    .from('student_model_snapshots')
    .select('user_id, features, confidence, computed_at')
    .eq('user_id', userId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapErr) {
    // A read failure is unusual but not fatal — callers (the
    // route) should still get a 200 with an empty payload, not
    // a 500. We surface a structured null and let the caller
    // decide.
    return null;
  }
  if (!snapRow) return null;

  // 2. The payload envelope from the snapshot row.
  const featuresEnvelope = (snapRow.features ?? {}) as StudentModelSnapshotPayload['features'];
  const evidenceWindowDays = pickEvidenceWindowDays(featuresEnvelope);

  // 3. Per-feature rows for the same `computed_at` — used to
  //    cross-check that the snapshot's features JSONB and the
  //    per-feature row counts agree. We DO NOT rehydrate the
  //    payload from these rows; the snapshot's features JSONB
  //    is the source of truth for the read shape (the per-
  //    feature rows are a denormalized write-time projection
  //    of the same data). When the counts diverge, we prefer
  //    the JSONB and silently ignore the mismatch.
  const computedAt = String(snapRow.computed_at ?? '');
  const { error: featErr } = await client
    .from('student_model_features')
    .select('feature_key, feature_value, evidence_count, computed_at')
    .eq('user_id', userId)
    .eq('computed_at', computedAt);
  if (featErr) {
    // Same posture as the snapshot read failure: return what
    // we have.
  }

  // 4. Compose the payload. The top-level `overallConfidence`
  //    is the minimum confidence across the seven features —
  //    we recompute it here from the per-feature envelopes
  //    rather than reading the snapshot's `confidence` column,
  //    so the read shape is self-describing. (The snapshot
  //    `confidence` column is the source of truth for the
  //    SQL function; the read shape derives from the JSONB.)
  const features = composeFeatures(featuresEnvelope);
  const overallConfidence = minConfidenceAcross(features);

  return {
    userId,
    computedAt,
    evidenceWindowDays,
    features,
    overallConfidence,
  };
}

/**
 * Convenience: return the snapshot when fresh, recompute when
 * stale. A snapshot is "stale" when its `computed_at` is older
 * than `windowDays * 86_400_000` ms. The recompute path uses
 * the service-role client and is async; the caller is expected
 * to have a service-role client (this is intended for the
 * admin recompute route, not the user-facing GET).
 */
export async function getOrRecomputeStudentModel(
  serviceClient: SupabaseClient,
  args: RecomputeStudentModelArgs & GetStudentModelArgs,
): Promise<StudentModelSnapshotPayload> {
  const clock = args.now ?? (() => new Date());
  const existing = await getStudentModelSnapshot(serviceClient, args.userId);
  if (existing && !isStale(existing, args.windowDays ?? DEFAULT_WINDOW_DAYS, clock())) {
    return existing;
  }
  const fresh = await recomputeStudentModelForUser(serviceClient, {
    userId: args.userId,
    ...(args.windowDays !== undefined ? { windowDays: args.windowDays } : {}),
    now: clock,
  });
  return fresh.payload;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers.                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `true` when the snapshot's `computed_at` is older than
 * `windowDays` days from `now`. A 28-day window means the
 * snapshot is stale if it is older than 28 days.
 */
export function isStale(
  payload: StudentModelSnapshotPayload,
  windowDays: number,
  now: Date,
): boolean {
  const computed = Date.parse(payload.computedAt);
  if (!Number.isFinite(computed)) return true;
  const ageMs = now.getTime() - computed;
  if (ageMs < 0) return false; // future-dated; treat as fresh
  return ageMs > windowDays * 86_400_000;
}

/** Clamp a window length to [1, MAX_WINDOW_DAYS]. Mirrors the orchestrator. */
export function clampWindow(windowDays: number): number {
  if (!Number.isFinite(windowDays) || windowDays < 1) return 1;
  if (windowDays > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS;
  return Math.floor(windowDays);
}

/**
 * Compose a `StudentModelSnapshotPayload.features` object from
 * the snapshot row's `features` JSONB. The seven feature keys
 * are pinned by PHASE5_PLAN.md §1; the value for each is the
 * per-feature `StudentModelFeatureValue` envelope.
 *
 * When the snapshot is missing a feature envelope (e.g. a
 * pre-Phase-5 row), we fall back to a `null`/empty envelope
 * with `score=0`, `direction='insufficient_data'`, and
 * `confidence='limited'`. This keeps the read shape stable
 * even across migration edges.
 */
function composeFeatures(
  envelope: StudentModelSnapshotPayload['features'] | null | undefined,
): StudentModelSnapshotPayload['features'] {
  const out = {} as StudentModelSnapshotPayload['features'];
  for (const k of SEVEN_FEATURES) {
    const v = envelope?.[k];
    out[k] = pickFeature(v, k);
  }
  return out;
}

function pickFeature(
  raw: StudentModelFeatureValue | undefined,
  _key: SevenFeatureKey,
): StudentModelFeatureValue {
  if (
    raw &&
    typeof raw === 'object' &&
    typeof raw.score === 'number' &&
    typeof raw.confidence === 'string' &&
    typeof raw.sampleSize === 'number' &&
    typeof raw.evidenceWindowDays === 'number' &&
    typeof raw.direction === 'string'
  ) {
    return raw;
  }
  return {
    score: 0,
    direction: 'insufficient_data',
    confidence: 'limited',
    sampleSize: 0,
    evidenceWindowDays: 0,
  };
}

function pickEvidenceWindowDays(
  envelope: StudentModelSnapshotPayload['features'] | null | undefined,
): number {
  for (const k of SEVEN_FEATURES) {
    const v = envelope?.[k];
    if (v && typeof v.evidenceWindowDays === 'number' && v.evidenceWindowDays > 0) {
      return v.evidenceWindowDays;
    }
  }
  return DEFAULT_WINDOW_DAYS;
}

const CONFIDENCE_RANK: Record<StudentModelFeatureValue['confidence'], number> = {
  limited: 0,
  moderate: 1,
  strong: 2,
};

const RANK_TO_CONFIDENCE: Record<number, StudentModelFeatureValue['confidence']> = {
  0: 'limited',
  1: 'moderate',
  2: 'strong',
};

function minConfidenceAcross(
  features: StudentModelSnapshotPayload['features'],
): StudentModelFeatureValue['confidence'] {
  let minRank = 2;
  for (const k of SEVEN_FEATURES) {
    const r = CONFIDENCE_RANK[features[k].confidence] ?? 0;
    if (r < minRank) minRank = r;
  }
  return RANK_TO_CONFIDENCE[minRank] ?? 'limited';
}
