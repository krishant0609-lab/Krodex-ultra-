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
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  CreateErrorEntryBody,
  IdParam,
  LinkErrorQuestionBody,
  ListErrorEntriesQuery,
  UpdateErrorEntryBody,
} from '../validation/schemas';
import * as errors from '../services/errors';

export function registerErrorRoutes(app: FastifyInstance): void {
  app.get('/errors', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListErrorEntriesQuery, req.query);
    const items = await errors.listErrorEntries(req.supabaseUser, auth.userId, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.question_id ? { question_id: q.question_id } : {}),
    }, q.limit ?? 25);
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
    return ok<ErrorEntryRow>(reply, row);
  });

  app.patch('/errors/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(UpdateErrorEntryBody, req.body);
    const row = await errors.updateErrorEntry(req.supabaseUser, auth.userId, params.id, {
      ...(body.status ? { status: body.status } : {}),
      ...(body.mistake_type !== undefined ? { mistake_type: body.mistake_type } : {}),
      ...(body.remark !== undefined ? { remark: body.remark } : {}),
      ...(body.recurrence_count !== undefined ? { recurrence_count: body.recurrence_count } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
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
