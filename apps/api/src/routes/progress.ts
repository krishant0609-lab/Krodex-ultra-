/**
 * KRODEX API — /progress and /notifications routes.
 *
 *   GET    /progress/evidence        — list progress evidence rows
 *   GET    /notifications             — list notifications
 *   GET    /notifications/:id        — read a notification
 *   PATCH  /notifications/:id        — mark read / dismissed
 *
 * Progress evidence is written by the submit_test_attempt and
 * schedule_review RPCs; this surface is read-only in Phase 2.
 */

import type { FastifyInstance } from 'fastify';
import type { NotificationRow, ProgressEvidenceRow } from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  IdParam,
  ListNotificationsQuery,
  ListProgressEvidenceQuery,
  UpdateNotificationBody,
} from '../validation/schemas';
import * as progress from '../services/progress';

export function registerProgressRoutes(app: FastifyInstance): void {
  app.get('/progress/evidence', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListProgressEvidenceQuery, req.query);
    const items = await progress.listProgressEvidence(req.supabaseUser, auth.userId, {
      ...(q.dimension ? { dimension: q.dimension } : {}),
      ...(q.since ? { since: q.since } : {}),
      ...(q.until ? { until: q.until } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return ok<readonly ProgressEvidenceRow[]>(reply, items);
  });

  app.get('/notifications', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListNotificationsQuery, req.query);
    const items = await progress.listNotifications(req.supabaseUser, auth.userId, {
      ...(q.unread_only ? { unread_only: q.unread_only } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return ok<readonly NotificationRow[]>(reply, items);
  });

  app.get('/notifications/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const row = await progress.getNotification(req.supabaseUser, auth.userId, params.id);
    return ok<NotificationRow>(reply, row);
  });

  app.patch('/notifications/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(UpdateNotificationBody, req.body);
    const row = await progress.updateNotification(req.supabaseUser, auth.userId, params.id, {
      ...(body.read !== undefined ? { read: body.read } : {}),
      ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
    });
    return ok<NotificationRow>(reply, row);
  });
}
