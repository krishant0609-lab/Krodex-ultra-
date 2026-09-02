/**
 * KRODEX API — /student-model routes.
 *
 *   GET  /student-model                   — latest snapshot for the auth'd user
 *   POST /student-model/admin/recompute   — service-role recompute for one user
 *
 * Per PHASE5_PLAN.md §7:
 *
 *   - GET returns the latest snapshot row + per-feature rows
 *     for the authenticated user. When no snapshot exists
 *     yet, the route returns 404 (cold-start path; the next
 *     5-minute tick of the scheduled `recompute_student_model`
 *     job will create the first snapshot).
 *   - POST is service-role only. It invokes the orchestrator
 *     + SECURITY DEFINER SQL function `recompute_student_model`
 *     (migration 13) for the requested user. The 28-day
 *     default window is clamped to [1, 90].
 *
 * The student model is advisory — the orchestrator never
 * rewrites raw evidence records. The route surface is
 * intentionally narrow: one read, one service-role
 * recompute.
 *
 * Class A: the read shape (`StudentModelSnapshotPayload`).
 * Class C — Approved Product Policy: the 5-minute recompute
 * cadence lives in the scheduler, not here; the admin route
 * is the only path that runs an inline recompute.
 */

import type { FastifyInstance } from 'fastify';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseQuery } from '../validation/parse';
import { GetStudentModelQuery, AdminStudentModelRecomputeBody } from '../validation/schemas';
import { getStudentModel, adminStudentModelRecompute } from '../services/student-model';
import { getServiceClient } from '../db/supabase';
import { DependencyUnavailableError, NotFoundError } from '../errors';

export function registerStudentModelRoutes(app: FastifyInstance): void {
  /**
   * GET /student-model
   *
   * Returns the latest snapshot for the authenticated user.
   * The 28-day default window is the PRD §25 default; the
   * `?window_days=N` query param is advisory for the response
   * envelope (the snapshot's `evidenceWindowDays` is the
   * source of truth).
   *
   * Status codes:
   *   - 200: snapshot exists; payload is the seven-feature
   *     envelope + the overall confidence.
   *   - 404: no snapshot yet for the user (cold-start).
   *   - 400: invalid `window_days` (caught by zod).
   *   - 401: not authenticated (caught by authPreHandler).
   */
  app.get('/student-model', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(GetStudentModelQuery, req.query);
    const result = await getStudentModel({
      client: req.supabaseUser,
      userId: auth.userId,
      ...(q.window_days !== undefined ? { windowDays: q.window_days } : {}),
    });
    if (!result.snapshot) {
      throw new NotFoundError(
        `student_model: no snapshot yet for user ${auth.userId} (next 5-minute tick will create one)`,
      );
    }
    return ok(reply, {
      snapshot: result.snapshot,
      windowDays: result.windowDays,
    });
  });

  /**
   * POST /student-model/admin/recompute
   *
   * Service-role only. Re-runs the orchestrator for one user.
   * The 5-minute scheduled `recompute_student_model` job
   * already covers the per-active-user path; the admin route
   * exists for cold-start scenarios (e.g. a brand-new user
   * that the job hasn't picked up yet) and operator debug
   * tools.
   *
   * Gating: the route is NOT under `authPreHandler`. The
   * handler checks `env.hasServiceRole` and 503s when the
   * service role is not configured. There is no user-JWT
   * path; an admin caller is expected to be in a trusted
   * network.
   */
  app.post('/student-model/admin/recompute', async (req, reply) => {
    const env = app.krodexEnv;
    if (!env.hasServiceRole) {
      throw new DependencyUnavailableError(
        'student_model_admin_recompute: SUPABASE_SERVICE_ROLE_KEY is not configured',
      );
    }
    const body = parseBody(AdminStudentModelRecomputeBody, req.body ?? {});
    const service = getServiceClient(env);
    const result = await adminStudentModelRecompute({
      client: service,
      userId: body.user_id,
      ...(body.window_days !== undefined ? { windowDays: body.window_days } : {}),
      logger: req.log,
    });
    return ok(reply, result);
  });
}
