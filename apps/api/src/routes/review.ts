/**
 * KRODEX API — /review routes.
 *
 *   GET    /review/schedules            — list schedules
 *   POST   /review/schedules            — schedule a review
 *   GET    /review/schedules/:id        — read a schedule
 *   PATCH  /review/schedules/:id        — update a schedule
 *   POST   /review/schedules/:id/attempts — record a review attempt
 *
 * The schedule_review RPC is the writer used by other endpoints
 * (e.g. on test attempt submission); this surface is the manual
 * editor the user invokes from the UI.
 */

import type { FastifyInstance } from 'fastify';
import type { ReviewAttemptRow, ReviewScheduleRow } from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  IdParam,
  ListReviewSchedulesQuery,
  RecordReviewAttemptBody,
  ScheduleReviewBody,
  UpdateReviewScheduleBody,
} from '../validation/schemas';
import * as review from '../services/review';
import { ForbiddenError } from '../errors';

export function registerReviewRoutes(app: FastifyInstance): void {
  app.get('/review/schedules', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListReviewSchedulesQuery, req.query);
    const items = await review.listReviewSchedules(req.supabaseUser, auth.userId, {
      ...(q.state ? { state: q.state } : {}),
      ...(q.due_before ? { due_before: q.due_before } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return ok<readonly ReviewScheduleRow[]>(reply, items);
  });

  app.post('/review/schedules', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(ScheduleReviewBody, req.body);
    const row = await review.scheduleReview(req.supabaseUser, auth.userId, {
      error_id: body.error_id,
      strategy: body.strategy,
      due_at: body.due_at,
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    return ok<ReviewScheduleRow>(reply, row, 201);
  });

  app.get('/review/schedules/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const row = await review.getReviewSchedule(req.supabaseUser, auth.userId, params.id);
    return ok<ReviewScheduleRow>(reply, row);
  });

  app.patch('/review/schedules/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(UpdateReviewScheduleBody, req.body);
    const row = await review.updateReviewSchedule(req.supabaseUser, auth.userId, params.id, {
      ...(body.state ? { state: body.state } : {}),
      ...(body.due_at ? { due_at: body.due_at } : {}),
      ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
      ...(body.strategy ? { strategy: body.strategy } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    return ok<ReviewScheduleRow>(reply, row);
  });

  app.post(
    '/review/schedules/:id/attempts',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(RecordReviewAttemptBody, req.body);
      if (params.id !== body.schedule_id) {
        // The body wins because the route param and the body must
        // match for the call to make sense.
        throw new ForbiddenError('schedule_id mismatch', {
          context: { paramsId: params.id, bodyId: body.schedule_id },
        });
      }
      const attempt = await review.recordReviewAttempt(req.supabaseUser, auth.userId, {
        schedule_id: body.schedule_id,
        question_id: body.question_id,
        outcome: body.outcome,
        selected_option_ids: body.selected_option_ids,
        free_text: body.free_text ?? null,
        duration_ms: body.duration_ms ?? null,
      });
      return ok<ReviewAttemptRow>(reply, attempt, 201);
    },
  );
}
