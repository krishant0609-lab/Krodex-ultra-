/**
 * KRODEX API — /errors routes.
 *
 *   GET    /errors                — list error entries
 *   POST   /errors                — create a manual error entry
 *   GET    /errors/:id            — read an error entry
 *   PATCH  /errors/:id            — update an error entry
 *   POST   /errors/:id/questions  — link a question
 *
 * The submit_test_attempt RPC creates rows here too; this surface
 * is the manual editor.
 */

import type { FastifyInstance } from 'fastify';
import type { ErrorEntryRow, ErrorQuestionLinkRow } from '@krodex/shared';
import { ok, requireAuth, setNoStore } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  CreateErrorEntryBody,
  IdParam,
  LinkErrorQuestionBody,
  ListErrorEntriesQuery,
  UpdateErrorEntryBody,
} from '../validation/schemas';
import * as errors from '../services/errors';
import * as lifecycle from '../services/error-lifecycle-service';

export function registerErrorRoutes(app: FastifyInstance): void {
  app.get('/errors', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListErrorEntriesQuery, req.query);
    const items = await errors.listErrorEntries(req.supabaseUser, auth.userId, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.question_id ? { question_id: q.question_id } : {}),
    }, q.limit ?? 25);
    setNoStore(reply);
    return ok<readonly ErrorEntryRow[]>(reply, items);
  });

  app.post('/errors', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(CreateErrorEntryBody, req.body);
    const row = await errors.createErrorEntry(req.supabaseUser, auth.userId, {
      question_id: body.question_id ?? null,
      mistake_type: body.mistake_type ?? null,
      remark: body.remark ?? null,
      source_attempt_id: body.source_attempt_id ?? null,
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    return ok<ErrorEntryRow>(reply, row, 201);
  });

  app.get('/errors/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const row = await errors.getErrorEntry(req.supabaseUser, auth.userId, params.id);
    setNoStore(reply);
    return ok<ErrorEntryRow>(reply, row);
  });

  app.patch('/errors/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(UpdateErrorEntryBody, req.body);

    // Status changes are routed through the lifecycle service so
    // the (a) state machine is enforced (illegal transitions
    // raise InvalidStateError -> 400), (b) `error_lifecycle_events`
    // audit row is appended, and (c) `error.lifecycle.*` event
    // fires so the notification handler can react. The legacy
    // `updateErrorEntry` path silently accepted any status string
    // and emitted no event — see PATCH /errors/:id in PHASE16
    // verification §"Defects found and fixed".
    if (body.status !== undefined) {
      if (body.status === 'resolved') {
        // `resolveError` is the dedicated service: it sets the
        // status and emits `error.resolved` (which the notification
        // handler maps to a "resolved" kind). It is the right path
        // for the manual "Mark resolved" button.
        await errors.resolveError(req.supabaseUser, auth.userId, params.id, {
          trigger: 'manual',
        });
      } else {
        // All other status flips go through the lifecycle service
        // so the state machine + audit log + lifecycle event are
        // all honored. transitionStatus throws InvalidStateError
        // for illegal transitions (e.g. resolved -> active); the
        // error handler maps that to 400.
        await lifecycle.transitionStatus(
          req.supabaseUser,
          auth.userId,
          params.id,
          { to_status: body.status, trigger: 'manual' },
          auth.userId,
        );
      }
    }

    // Non-status fields use the legacy updater (which already
    // emits `error.classified` correctly when mistake_type
    // goes null -> value).
    const otherPatch: errors.UpdateErrorEntryInput = {
      ...(body.mistake_type !== undefined ? { mistake_type: body.mistake_type } : {}),
      ...(body.remark !== undefined ? { remark: body.remark } : {}),
      ...(body.recurrence_count !== undefined ? { recurrence_count: body.recurrence_count } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    };
    if (Object.keys(otherPatch).length > 0) {
      const row = await errors.updateErrorEntry(
        req.supabaseUser,
        auth.userId,
        params.id,
        otherPatch,
      );
      return ok<ErrorEntryRow>(reply, row);
    }
    // status-only update: re-read the row to return the current
    // shape (the lifecycle / resolve services already returned
    // their own rows but the route's return type is the
    // ErrorEntryRow).
    const row = await errors.getErrorEntry(req.supabaseUser, auth.userId, params.id);
    return ok<ErrorEntryRow>(reply, row);
  });

  app.post('/errors/:id/questions', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(LinkErrorQuestionBody, req.body);
    const link = await errors.linkErrorQuestion(
      req.supabaseUser,
      auth.userId,
      params.id,
      body.question_id,
    );
    return ok<ErrorQuestionLinkRow>(reply, link, 201);
  });
}
