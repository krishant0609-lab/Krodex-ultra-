/**
 * KRODEX API — student-model service (route layer).
 *
 * Per PHASE5_PLAN.md §7, the route layer is intentionally thin:
 *
 *   - `GET /student-model` returns the user's latest snapshot
 *     (the orchestrator + scheduled job + event handlers own
 *     the writes). The window query param is advisory; the
 *     snapshot's `evidenceWindowDays` is the source of truth.
 *   - `POST /student-model/admin/recompute` is the service-role
 *     admin path that re-runs the orchestrator for a single
 *     user. The scheduled 5-minute job already covers the
 *     per-active-user path.
 *
 * The "fat" service (orchestrator + persistence) lives in
 * `apps/api/src/student-model/service.ts`; this file is the
 * thin route-layer shim that composes the read side + the
 * admin write side and shapes the response envelope.
 *
 * Class A: the route surface (GET = read, POST = admin
 * recompute, both with the 28-day default window).
 * Class C — Approved Product Policy: the 5-minute recompute
 * cadence lives in the scheduler, not here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentModelSnapshotPayload } from '@krodex/shared';

import {
  getStudentModelSnapshot,
  recomputeStudentModelForUser,
  DEFAULT_WINDOW_DAYS,
  type RecomputeStudentModelResult,
} from '../student-model/service';

export interface GetStudentModelInput {
  /** User-scoped Supabase client. */
  client: SupabaseClient;
  /** The authenticated user's id. */
  userId: string;
  /**
   * Optional evidence window length in days. The read path
   * returns the latest snapshot regardless of the window — the
   * window is only used to default the response envelope's
   * `windowDays` slot when no snapshot exists yet.
   */
  windowDays?: number;
}

export interface GetStudentModelOutput {
  /**
   * The latest snapshot payload, or `null` when the user has
   * no snapshot yet. The route maps `null` to 404 per the
   * PHASE5_PLAN §7 contract.
   */
  snapshot: StudentModelSnapshotPayload | null;
  /** Window used. */
  windowDays: number;
}

/**
 * Read the user's latest snapshot. This is a pure read — it
 * does NOT trigger an inline recompute. The cold-start case
 * (no snapshot yet) returns `snapshot: null`; the route maps
 * that to 404, and the next 5-minute tick of the scheduled
 * `recompute_student_model` job will create the first
 * snapshot.
 *
 * Why no inline recompute: doing so would put the 28-day
 * orchestrator work on the user's request thread, which is
 * precisely the problem the projection model solves. The
 * route's only write path is the service-role admin
 * recompute.
 */
export async function getStudentModel(
  input: GetStudentModelInput,
): Promise<GetStudentModelOutput> {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const snapshot = await getStudentModelSnapshot(input.client, input.userId);
  return {
    snapshot,
    windowDays,
  };
}

export interface AdminStudentModelRecomputeInput {
  /** Service-role Supabase client. */
  client: SupabaseClient;
  /** The user to recompute. */
  userId: string;
  /** Optional evidence window length in days. */
  windowDays?: number;
  /**
   * Logger. Pino-style: each method accepts either a string
   * message (with optional args) or an object first arg +
   * message. We type it as a generic callable so call sites
   * can use either form.
   */
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface AdminStudentModelRecomputeOutput {
  /** True when the orchestrator + SQL function succeeded. */
  ok: boolean;
  /** The user id. */
  userId: string;
  /** Window used. */
  windowDays: number;
  /** Number of per-feature rows written (7 in the happy path). */
  featuresWritten: number;
  /** The fresh payload. */
  payload: StudentModelSnapshotPayload;
  /** Error message when ok is false. */
  error?: string;
}

/**
 * Run the orchestrator + persistence for a single user. The
 * admin route layer calls this; the per-user path is the
 * common case (the 5-minute scheduled job already covers
 * the per-active-user path).
 */
export async function adminStudentModelRecompute(
  input: AdminStudentModelRecomputeInput,
): Promise<AdminStudentModelRecomputeOutput> {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  let result: RecomputeStudentModelResult;
  try {
    result = await recomputeStudentModelForUser(input.client, {
      userId: input.userId,
      windowDays,
    });
  } catch (err) {
    input.logger.error(
      { err, userId: input.userId, windowDays },
      'admin_student_model_recompute.failed',
    );
    throw err;
  }
  input.logger.info(
    { userId: input.userId, featuresWritten: result.featuresWritten, windowDays },
    'admin_student_model_recompute.ok',
  );
  return {
    ok: true,
    userId: input.userId,
    windowDays,
    featuresWritten: result.featuresWritten,
    payload: result.payload,
  };
}
