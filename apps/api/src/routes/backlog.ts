/**
 * KRODEX API — /backlog routes.
 *
 *   GET   /backlog                 — list backlog items
 *   GET   /backlog/:id             — read a backlog item
 *   POST  /backlog/:id/recover     — recover (re-schedule)
 *   POST  /backlog/:id/drop        — drop
 */

import type { FastifyInstance } from 'fastify';
import type { BacklogItemRow, BacklogRecoveryRow, PlannerTaskRow } from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  IdParam,
  ListBacklogItemsQuery,
  RecoverBacklogItemBody,
} from '../validation/schemas';
import * as backlog from '../services/backlog';

export function registerBacklogRoutes(app: FastifyInstance): void {
  app.get('/backlog', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListBacklogItemsQuery, req.query);
    const items = await backlog.listBacklogItems(req.supabaseUser, auth.userId, {
      ...(q.state ? { state: q.state } : {}),
      ...(q.reason ? { reason: q.reason } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return ok<readonly BacklogItemRow[]>(reply, items);
  });

  app.get('/backlog/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const row = await backlog.getBacklogItem(req.supabaseUser, auth.userId, params.id);
    return ok<BacklogItemRow>(reply, row);
  });

  app.post('/backlog/:id/recover', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(RecoverBacklogItemBody, req.body);
    const result = await backlog.recoverBacklogItem(req.supabaseUser, auth.userId, params.id, {
      ...(body.plan_date ? { plan_date: body.plan_date } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });
    return ok<{
      backlog: BacklogItemRow;
      recovered_task: PlannerTaskRow;
      recovery: BacklogRecoveryRow;
    }>(reply, result);
  });

  app.post('/backlog/:id/drop', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const row = await backlog.dropBacklogItem(req.supabaseUser, auth.userId, params.id);
    return ok<BacklogItemRow>(reply, row);
  });
}
