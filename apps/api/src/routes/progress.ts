/**
 * KRODEX API — /progress and /notifications routes.
 *
 *   GET    /progress/evidence                    — list progress evidence rows
 *   GET    /notifications                         — list notifications
 *   GET    /notifications/:id                    — read a notification
 *   PATCH  /notifications/:id                    — mark read / dismissed
 *   GET    /notifications/preferences            — read notification prefs (Phase 12)
 *   PATCH  /notifications/preferences            — update notification prefs (Phase 12)
 *   POST   /notifications/dispatch-tick          — drain pending in_app queue (Phase 12)
 *
 * Progress evidence is written by the submit_test_attempt and
 * schedule_review RPCs; this surface is read-only in Phase 2.
 */

import type { FastifyInstance } from 'fastify';
import type { NotificationRow, ProgressEvidenceRow } from '@krodex/shared';
import type { NotificationPreferences } from '../services/notification-preferences-service';
import { ok, requireAuth, setNoStore } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  DispatchTickBody,
  IdParam,
  ListNotificationsQuery,
  ListProgressEvidenceQuery,
  UpdateNotificationBody,
  UpdateNotificationPreferencesBody,
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
    setNoStore(reply);
    return ok<readonly ProgressEvidenceRow[]>(reply, items);
  });

  app.get('/notifications', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListNotificationsQuery, req.query);
    const items = await progress.listNotifications(req.supabaseUser, auth.userId, {
      ...(q.unread_only ? { unread_only: q.unread_only } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    setNoStore(reply);
    return ok<readonly NotificationRow[]>(reply, items);
  });

  app.get('/notifications/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const row = await progress.getNotification(req.supabaseUser, auth.userId, params.id);
    setNoStore(reply);
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

  // --- Phase 12: notification preferences ---------------------------

  app.get('/notifications/preferences', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const prefs = await progress.getNotificationPreferences(req.supabaseUser, auth.userId);
    setNoStore(reply);
    return ok<NotificationPreferences>(reply, prefs);
  });

  app.patch('/notifications/preferences', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(UpdateNotificationPreferencesBody, req.body);
    // The service's mergePreferences fills in any missing sub-fields
    // (e.g. quiet_hours.start when only quiet_hours.enabled was sent).
    const prefs = await progress.updateNotificationPreferences(
      req.supabaseUser,
      auth.userId,
      body as Partial<NotificationPreferences>,
    );
    return ok<NotificationPreferences>(reply, prefs);
  });

  // --- Phase 12: dispatch tick ---------------------------------------
  // Drains pending in_app delivery rows. Authenticated-only; Phase 12
  // does not yet expose a public cron trigger — the scheduled job
  // calls this route via the same authenticated client.

  app.post('/notifications/dispatch-tick', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(DispatchTickBody, req.body ?? {});
    const result = await progress.dispatchNotificationDeliveries(req.supabaseUser, {
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
    });
    return ok(reply, result);
  });
}
