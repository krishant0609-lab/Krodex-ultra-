/**
 * KRODEX API — /syllabus routes.
 *
 *   GET /syllabus/subjects
 *   GET /syllabus/topics
 *   GET /syllabus/sub-topics
 *   GET /syllabus/questions
 *   GET /syllabus/questions/:id/options
 *   GET /syllabus/progress
 *   PUT /syllabus/progress
 *
 * The tree (subjects → topics → sub_topics → questions → options)
 * is global read-only. The per-user syllabus_progress is the only
 * writable surface. PUTs are idempotent at the
 * (user_id, scope, scope_id) tuple.
 */

import type { FastifyInstance } from 'fastify';
import type {
  QuestionRow,
  SubjectRow,
  SubTopicRow,
  SyllabusProgressRow,
  TopicRow,
  CoverageState,
} from '@krodex/shared';
import { ok, okPage, requireAuth, setNoStore, setPrivateCache } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  IdParam,
  ListQuestionsQuery,
  ListSyllabusProgressQuery,
  ListSubTopicsQuery,
  ListTopicsQuery,
  UpsertSyllabusProgressBody,
} from '../validation/schemas';
import * as syllabus from '../services/syllabus';

export function registerSyllabusRoutes(app: FastifyInstance): void {
  app.get('/syllabus/subjects', { preHandler: app.authPreHandler }, async (req, reply) => {
    const items = await syllabus.listSubjects(req.supabaseUser);
    setPrivateCache(reply, 300);
    return ok<readonly SubjectRow[]>(reply, items);
  });

  app.get('/syllabus/topics', { preHandler: app.authPreHandler }, async (req, reply) => {
    const q = parseQuery(ListTopicsQuery, req.query);
    const items = await syllabus.listTopics(req.supabaseUser, {
      ...(q.subject_id ? { subject_id: q.subject_id } : {}),
      ...(q.parent_topic_id !== undefined ? { parent_topic_id: q.parent_topic_id } : {}),
    });
    setPrivateCache(reply, 300);
    return ok<readonly TopicRow[]>(reply, items);
  });

  app.get('/syllabus/sub-topics', { preHandler: app.authPreHandler }, async (req, reply) => {
    const q = parseQuery(ListSubTopicsQuery, req.query);
    const items = await syllabus.listSubTopics(req.supabaseUser, q.topic_id);
    setPrivateCache(reply, 300);
    return ok<readonly SubTopicRow[]>(reply, items);
  });

  app.get('/syllabus/questions', { preHandler: app.authPreHandler }, async (req, reply) => {
    const q = parseQuery(ListQuestionsQuery, req.query);
    const page = await syllabus.listQuestions(req.supabaseUser, {
      ...(q.subject_id ? { subject_id: q.subject_id } : {}),
      ...(q.topic_id ? { topic_id: q.topic_id } : {}),
      ...(q.sub_topic_id ? { sub_topic_id: q.sub_topic_id } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    setPrivateCache(reply, 60);
    return okPage<QuestionRow>(reply, page);
  });

  app.get(
    '/syllabus/questions/:id/options',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const params = parseParams(IdParam, req.params);
      const items = await syllabus.getQuestionOptions(req.supabaseUser, params.id);
      // Strip server-only fields before returning. is_correct is
      // part of the row but the route surface only exposes the
      // display-relevant columns.
      const display = items.map((o) => ({
        id: o.id,
        display_order: o.display_order,
        body: o.body,
      }));
      setPrivateCache(reply, 300);
      return ok<readonly { id: string; display_order: number; body: string }[]>(reply, display);
    },
  );

  app.get('/syllabus/progress', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListSyllabusProgressQuery, req.query);
    const page = await syllabus.getSyllabusProgress(
      req.supabaseUser,
      auth.userId,
      q.scope ?? '',
      q.cursor ?? null,
      q.limit ?? 25,
    );
    setNoStore(reply);
    return okPage<SyllabusProgressRow>(reply, page);
  });

  app.put('/syllabus/progress', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(UpsertSyllabusProgressBody, req.body);
    const row = await syllabus.upsertSyllabusProgress(req.supabaseUser, auth.userId, {
      scope: body.scope,
      scope_id: body.scope_id ?? null,
      ...(body.coverage_state ? { coverage_state: body.coverage_state as CoverageState } : {}),
      ...(body.last_activity_at ? { last_activity_at: body.last_activity_at } : {}),
    });
    return ok<SyllabusProgressRow>(reply, row);
  });
}
