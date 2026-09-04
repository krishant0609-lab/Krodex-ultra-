/**
 * KRODEX API — /reviews/:id session routes (Phase 10).
 *
 *   POST /reviews/:id/start
 *     — Transition the schedule to `in_progress` and the
 *       error to `in_review` (via the Phase 9 lifecycle service),
 *       then pick a fresh verification question from the
 *       deterministic selector.
 *
 *   POST /reviews/:id/outcome
 *     — Record the outcome of the verification question,
 *       transition the error lifecycle, schedule the next review
 *       (or leave it unresolved), mark the schedule completed,
 *       and emit the `review.verification_question_used` event.
 *       Wrapped in `withIdempotency` so a retry with the same
 *       `Idempotency-Key` returns the prior response.
 *
 *   GET  /reviews/:id/verification-question
 *     — Re-fetch the most recent verification question for this
 *       review session. The selector is deterministic, so the
 *       result is stable across calls until the schedule moves
 *       out of `in_progress`.
 *
 *   GET  /reviews/:id/lifecycle
 *     — Read the immutable state-transition history for the
 *       error attached to this schedule, newest first.
 *
 * All endpoints are student-authenticated. RLS on the underlying
 * tables is the second line of defense; the service-layer
 * `assertOwned` gate converts a cross-tenant read into a 404
 * rather than an empty list.
 *
 * Concurrent review prevention (PRD §17): `start` is the gate.
 * If another review for the same error is already `in_progress`
 * for this user, the route refuses with 409 REVIEW_ALREADY_ACTIVE.
 * The `retest_only` strategy is the documented override, but
 * the per-error locking policy itself is not yet stored (Phase
 * 11+); we keep the 409 in place as the safe default.
 */

import type { FastifyInstance } from 'fastify';
import type {
  ErrorLifecycleEventRow,
  ReviewAttemptOutcome,
  ReviewScheduleRow,
} from '@krodex/shared';
import { ConflictError, NotFoundError } from '../errors';
import { ok, requireAuth, withIdempotency } from './_helpers';
import { parseBody, parseParams } from '../validation/parse';
import {
  IdParam,
  RecordReviewOutcomeBody,
  StartReviewBody,
} from '../validation/schemas';
import * as review from '../services/review';
import * as errorsService from '../services/errors';
import * as errorLifecycle from '../services/error-lifecycle-service';
import * as freshQuestion from '../services/fresh-question-selector';
import {
  recordReviewOutcome,
  type ReviewOutcomeResult,
} from '../services/review-outcome-service';

export function registerReviewSessionRoutes(app: FastifyInstance): void {
  /**
   * POST /reviews/:id/start
   *
   * Begins a review session. The route is the canonical entry
   * point for a student opening a review — it does the work
   * that was previously scattered across the schedule update
   * + the lifecycle transition + the verification question
   * selection. Returns the (now `in_progress`) schedule, the
   * updated error entry, and the picked verification question
   * (or `kind: 'none'` if the topic pool is exhausted).
   */
  app.post(
    '/reviews/:id/start',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      // Body is currently a no-op; the route is wired so the
      // client can send an `Idempotency-Key` header if it wants
      // a replay-safe start. parseBody is still called so any
      // malformed shape returns a 400 instead of being silently
      // ignored.
      parseBody(StartReviewBody, req.body ?? {});

      // 1. Load the schedule. This throws NotFoundError if it's
      //    missing, ForbiddenError if it belongs to another user.
      const schedule = await review.getReviewSchedule(
        req.supabaseUser,
        auth.userId,
        params.id,
      );
      if (schedule.state === 'completed' || schedule.state === 'skipped') {
        // Terminal states cannot be re-started. The student can
        // wait for the next scheduled review.
        throw new ConflictError(
          'review is in a terminal state and cannot be started',
          {
            context: { reviewId: schedule.id, state: schedule.state },
          },
        );
      }

      // 2. Concurrent review prevention. If another review for
      //    the same error is already `in_progress`, refuse.
      const sibling = await findActiveSibling(
        req.supabaseUser,
        auth.userId,
        schedule.error_id,
        schedule.id,
      );
      if (sibling) {
        throw new ConflictError(
          'another review for this error is already active',
          {
            context: {
              errorId: schedule.error_id,
              activeReviewId: sibling,
            },
          },
        );
      }

      // 3. Move the schedule to `in_progress` (no-op if it is
      //    already there). This emits `review.started`.
      const updatedSchedule = await review.updateReviewSchedule(
        req.supabaseUser,
        auth.userId,
        schedule.id,
        { state: 'in_progress' },
      );

      // 4. Transition the error to `in_review` (no-op if it is
      //    already there). The lifecycle service appends a
      //    history row and emits `error.lifecycle.in_review`
      //    only on the actual transition.
      const errorBefore = await errorsService.getErrorEntry(
        req.supabaseUser,
        auth.userId,
        schedule.error_id,
      );
      const lifecycle = await errorLifecycle.transitionStatus(
        req.supabaseUser,
        auth.userId,
        schedule.error_id,
        {
          to_status: 'in_review',
          trigger: 'student_review',
          reason: 'review session started',
          review_id: schedule.id,
        },
        auth.userId,
      );

      // 5. Pick a fresh verification question. The selector
      //    records the choice in `verification_questions` so
      //    future sessions skip it. If the topic pool is
      //    exhausted, the result is `kind: 'none'` and the UI
      //    falls back to "no verification question available".
      let verification:
        | { kind: 'found'; questionId: string; difficulty: number }
        | { kind: 'none' };
      if (errorBefore.question_id) {
        const outcome = await freshQuestion.selectFreshQuestion(
          req.supabaseUser,
          auth.userId,
          {
            errorId: schedule.error_id,
            originalQuestionId: errorBefore.question_id,
          },
        );
        if (outcome.kind === 'found') {
          verification = {
            kind: 'found',
            questionId: outcome.result.questionId,
            difficulty: outcome.result.difficulty,
          };
        } else {
          verification = { kind: 'none' };
        }
      } else {
        // The error entry has no source question — this can
        // happen for manually-archived / imported entries. We
        // surface the empty state to the caller so the UI can
        // show "no verification question available" without
        // throwing.
        verification = { kind: 'none' };
      }

      return ok<{
        schedule: ReviewScheduleRow;
        errorTransition: { fromStatus: string; toStatus: string };
        verification: typeof verification;
      }>(
        reply,
        {
          schedule: updatedSchedule,
          errorTransition: {
            fromStatus: lifecycle.event.from_status ?? errorBefore.status,
            toStatus: lifecycle.event.to_status,
          },
          verification,
        },
        200,
      );
    },
  );

  /**
   * POST /reviews/:id/outcome
   *
   * Records the outcome of the verification question. Wrapped in
   * `withIdempotency` so a retry with the same `Idempotency-Key`
   * header returns the prior response without re-running the
   * pipeline.
   */
  app.post(
    '/reviews/:id/outcome',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(RecordReviewOutcomeBody, req.body);

      await withIdempotency({
        env: app.krodexEnv,
        req,
        reply,
        body: { ...body, scheduleId: params.id },
        route: 'POST /reviews/:id/outcome',
        action: async () => {
          const outcome: ReviewAttemptOutcome = body.outcome;
          const result: ReviewOutcomeResult = await recordReviewOutcome(
            req.supabaseUser,
            auth.userId,
            {
              reviewId: params.id,
              questionId: body.questionId,
              outcome,
              ...(body.selectedOptionIds.length > 0
                ? { selectedOptionIds: body.selectedOptionIds }
                : {}),
              freeText: body.freeText ?? null,
              durationMs: body.durationMs ?? null,
            },
          );
          return result;
        },
        envelope: (data, requestId, timestamp) => ({
          success: true,
          data: {
            outcomeId: data.outcomeId,
            errorTransition: {
              fromStatus: data.errorTransition.fromStatus,
              toStatus: data.errorTransition.toStatus,
            },
            nextReviewScheduled: data.nextReviewScheduled,
            nextReview: data.nextReview,
            terminalOutcome: data.terminalOutcome,
          },
          requestId,
          timestamp,
        }),
      });
      return reply;
    },
  );

  /**
   * GET /reviews/:id/verification-question
   *
   * Re-fetches the verification question for the current session.
   * The selector is deterministic; calling it again with the
   * same error + exclusions returns the same questionId until
   * the row is recorded (i.e. once the student POSTs an
   * outcome, the next `GET` will pick a different question).
   */
  app.get(
    '/reviews/:id/verification-question',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const schedule = await review.getReviewSchedule(
        req.supabaseUser,
        auth.userId,
        params.id,
      );
      const errorEntry = await errorsService.getErrorEntry(
        req.supabaseUser,
        auth.userId,
        schedule.error_id,
      );
      if (!errorEntry.question_id) {
        return ok(reply, { kind: 'none' as const });
      }
      const outcome = await freshQuestion.selectFreshQuestion(
        req.supabaseUser,
        auth.userId,
        {
          errorId: schedule.error_id,
          originalQuestionId: errorEntry.question_id,
        },
      );
      if (outcome.kind === 'found') {
        return ok(reply, {
          kind: 'found' as const,
          questionId: outcome.result.questionId,
          difficulty: outcome.result.difficulty,
        });
      }
      return ok(reply, { kind: 'none' as const });
    },
  );

  /**
   * GET /reviews/:id/lifecycle
   *
   * Returns the immutable state-transition history for the
   * error attached to this schedule, newest first. Convenience
   * alias for `GET /errors/:id/lifecycle` so the frontend can
   * keep the review-detail fetch list tight.
   */
  app.get(
    '/reviews/:id/lifecycle',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const schedule = await review.getReviewSchedule(
        req.supabaseUser,
        auth.userId,
        params.id,
      );
      const events = await errorLifecycle.listLifecycleEvents(
        req.supabaseUser,
        auth.userId,
        schedule.error_id,
      );
      return ok<readonly ErrorLifecycleEventRow[]>(reply, events);
    },
  );
}

/**
 * Look for another review_schedules row for the same error that
 * is currently `in_progress`. Returns the id of the active
 * sibling, or null if none exists. The row whose id matches
 * `excludeScheduleId` is skipped (it is the one we are starting).
 */
async function findActiveSibling(
  client: import('@supabase/supabase-js').SupabaseClient,
  userId: string,
  errorId: string,
  excludeScheduleId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('review_schedules')
    .select('id, state')
    .eq('user_id', userId)
    .eq('error_id', errorId);
  if (error) {
    // We do not throw on read failure here — a downstream 500 is
    // worse than letting the student proceed. The start will
    // still go through and the per-row update will surface any
    // real data error.
    return null;
  }
  const rows = (data ?? []) as Array<{ id: string; state: string }>;
  for (const row of rows) {
    if (row.id === excludeScheduleId) continue;
    if (row.state === 'in_progress') return row.id;
  }
  return null;
}
