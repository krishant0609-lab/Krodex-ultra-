/**
 * KRODEX API — /planner routes.
 *
 *   GET    /planner/tasks                 — list tasks
 *   POST   /planner/tasks                 — create a task
 *   GET    /planner/tasks/:id             — read a task
 *   PATCH  /planner/tasks/:id             — update a task
 *   POST   /planner/tasks/:id/missed      — mark missed, create backlog
 *   GET    /planner/templates             — list templates
 *   POST   /planner/templates             — create a template
 */

import type { FastifyInstance } from 'fastify';
import type {
  PlannerTaskRow,
  PlannerTemplateRow,
  BacklogItemRow,
} from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  CreatePlannerTaskBody,
  CreatePlannerTemplateBody,
  IdParam,
  ListPlannerTasksQuery,
  UpdatePlannerTaskBody,
  UpdatePlannerTemplateBody,
} from '../validation/schemas';
import * as planner from '../services/planner';
import { NotFoundError } from '../errors';

export function registerPlannerRoutes(app: FastifyInstance): void {
  app.get('/planner/tasks', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListPlannerTasksQuery, req.query);
    const items = await planner.listPlannerTasks(req.supabaseUser, auth.userId, {
      ...(q.state ? { state: q.state } : {}),
      ...(q.plan_date ? { plan_date: q.plan_date } : {}),
      ...(q.subject_id ? { subject_id: q.subject_id } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return ok<readonly PlannerTaskRow[]>(reply, items);
  });

  app.post('/planner/tasks', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(CreatePlannerTaskBody, req.body);
    const task = await planner.createPlannerTask(req.supabaseUser, auth.userId, {
      template_id: body.template_id ?? null,
      plan_date: body.plan_date,
      title: body.title,
      description: body.description ?? null,
      subject_id: body.subject_id ?? null,
      topic_id: body.topic_id ?? null,
      sub_topic_id: body.sub_topic_id ?? null,
      planned_minutes: body.planned_minutes ?? null,
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    return ok<PlannerTaskRow>(reply, task, 201);
  });

  app.get('/planner/tasks/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const task = await planner.getPlannerTask(req.supabaseUser, auth.userId, params.id);
    return ok<PlannerTaskRow>(reply, task);
  });

  app.patch('/planner/tasks/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(UpdatePlannerTaskBody, req.body);
    const task = await planner.updatePlannerTask(req.supabaseUser, auth.userId, params.id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.state ? { state: body.state } : {}),
      ...(body.planned_minutes !== undefined ? { planned_minutes: body.planned_minutes } : {}),
      ...(body.actual_minutes !== undefined ? { actual_minutes: body.actual_minutes } : {}),
      ...(body.started_at !== undefined ? { started_at: body.started_at } : {}),
      ...(body.completed_at !== undefined ? { completed_at: body.completed_at } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    return ok<PlannerTaskRow>(reply, task);
  });

  app.post('/planner/tasks/:id/missed', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const result = await planner.markTaskMissed(req.supabaseUser, auth.userId, params.id);
    return ok<{ task: PlannerTaskRow; backlog: BacklogItemRow | null }>(reply, result);
  });

  app.get('/planner/templates', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const items = await planner.listPlannerTemplates(req.supabaseUser, auth.userId);
    return ok<readonly PlannerTemplateRow[]>(reply, items);
  });

  app.post('/planner/templates', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(CreatePlannerTemplateBody, req.body);
    const row = await planner.createPlannerTemplate(req.supabaseUser, auth.userId, {
      name: body.name,
      is_default: body.is_default ?? false,
      template_payload: body.template_payload,
    });
    return ok<PlannerTemplateRow>(reply, row, 201);
  });

  // Templates have no per-id GET in the Phase 2 surface; clients
  // list and then edit inline. We expose PATCH for completeness.
  // The service's read+update cycle still uses RLS so the
  // caller's JWT owns the row.
  app.patch('/planner/templates/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(UpdatePlannerTemplateBody, req.body);
    // Fetch first to assert ownership; then update.
    await planner.listPlannerTemplates(req.supabaseUser, auth.userId);
    // The service update is inlined via the supabase user client.
    const { data, error } = await req.supabaseUser
      .from('planner_templates')
      .update({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.is_default !== undefined ? { is_default: body.is_default } : {}),
        ...(body.template_payload !== undefined ? { template_payload: body.template_payload } : {}),
      })
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .select('*')
      .single();
    if (error || !data) {
      throw new NotFoundError('template not found');
    }
    return ok<PlannerTemplateRow>(reply, data as unknown as PlannerTemplateRow);
  });
}
