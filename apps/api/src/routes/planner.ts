/**
 * KRODEX API — /planner routes.
 *
 *   GET    /planner/tasks                          — list tasks
 *   POST   /planner/tasks                          — create a task
 *   GET    /planner/tasks/:id                      — read a task
 *   PATCH  /planner/tasks/:id                      — update a task
 *   POST   /planner/tasks/:id/missed               — mark missed, create backlog
 *   POST   /planner/check-missed                   — admin / cron: scan for overdue
 *   POST   /planner/tasks/:id/partial              — mark partial, create backlog
 *   POST   /planner/tasks/:id/reschedule           — new task linked to original
 *   GET    /planner/tasks/:id/history              — event history
 *   GET    /planner/backlog/recovery-suggestions   — stale backlog items
 *   POST   /planner/backlog/recover/:id            — reschedule/complete/dismiss/split
 *   GET    /planner/templates                      — list templates
 *   POST   /planner/templates                      — create a template
 */

import type { FastifyInstance } from 'fastify';
import type {
  PlannerTaskRow,
  PlannerTemplateRow,
  BacklogItemRow,
  PlannerTaskEventRow,
} from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  CheckMissedPlannerTasksBody,
  CreatePlannerTaskBody,
  CreatePlannerTemplateBody,
  IdParam,
  ListPlannerTasksQuery,
  MarkPartialBody,
  RecoverPlannerBacklogItemBody,
  RecoverySuggestionsQuery,
  RescheduleTaskBody,
  UpdatePlannerTaskBody,
  UpdatePlannerTemplateBody,
} from '../validation/schemas';
import * as planner from '../services/planner';
import {
  detectMissedTasks,
  getTaskHistory,
  markPartial,
  recoverBacklogItem,
  rescheduleTask,
} from '../services/planner-task-automation-service';
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

  // --- Phase 11: planner task automation --------------------------------

  /**
   * Periodic scan: any task whose plan_date is in the past and
   * which is still in {planned, in_progress} is flipped to
   * 'missed' and a backlog item is created. The route accepts
   * an optional `scan_before` ISO timestamp; defaults to now.
   *
   * This is the outbox-worker / cron entry point.
   */
  app.post(
    '/planner/check-missed',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const body = parseBody(CheckMissedPlannerTasksBody, req.body ?? {});
      const result = await detectMissedTasks(req.supabaseUser, {
        userId: auth.userId,
        ...(body.scan_before ? { scanBefore: body.scan_before } : {}),
      });
      // Phase 14: audit log entry. check-missed is a
      // privileged op (writes to planner_tasks + backlog_items);
      // an attacker with a valid user JWT could otherwise call
      // it as a side-effect of any cron tick.
      const { makeAuditLogger } = await import('../security/audit-logger');
      const { getServiceClient } = await import('../db/supabase');
      const audit = makeAuditLogger(getServiceClient(app.krodexEnv), req.log);
      await audit.log({
        actorId: auth.userId,
        action: 'PLANNER_CHECK_MISSED',
        resource: 'planner_tasks',
        resourceId: auth.userId,
        metadata: {
          newly_missed: result.newlyMissed.length,
          already_missed: result.alreadyMissed.length,
          backlog_created: result.createdBacklogItemIds.length,
        },
        requestId: typeof req.id === 'string' ? req.id : undefined,
      });
      return ok(reply, {
        scannedAt: result.scannedAt,
        newlyMissed: result.newlyMissed.map((d) => d.task),
        alreadyMissed: result.alreadyMissed.map((d) => d.task),
        createdBacklogItemIds: result.createdBacklogItemIds,
      });
    },
  );

  /**
   * Mark a task as partial. The student worked on it but did
   * not complete it. We increment `partial_count`, append a
   * 'partial' history row, and create a backlog item.
   */
  app.post(
    '/planner/tasks/:id/partial',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(MarkPartialBody, req.body ?? {});
      const result = await markPartial(req.supabaseUser, {
        userId: auth.userId,
        taskId: params.id,
        actualDurationMinutes: body.actual_duration_minutes ?? null,
        reason: body.reason ?? null,
      });
      return ok(reply, result);
    },
  );

  /**
   * Reschedule a task by creating a new task linked to the
   * original. The original is preserved with a 'rescheduled'
   * event row appended.
   */
  app.post(
    '/planner/tasks/:id/reschedule',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(RescheduleTaskBody, req.body);
      const result = await rescheduleTask(req.supabaseUser, {
        userId: auth.userId,
        taskId: params.id,
        newDueAt: body.new_due_at,
        reason: body.reason ?? null,
      });
      return ok(reply, result);
    },
  );

  /**
   * Read the immutable history for a task.
   */
  app.get(
    '/planner/tasks/:id/history',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const events = await getTaskHistory(req.supabaseUser, auth.userId, params.id);
      return ok<readonly PlannerTaskEventRow[]>(reply, events);
    },
  );

  /**
   * Surface backlog items that need recovery action. Returns
   * the most recent open backlog items for this user, with a
   * suggested action based on age and miss count.
   */
  app.get(
    '/planner/backlog/recovery-suggestions',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const q = parseQuery(RecoverySuggestionsQuery, req.query);
      const limit = q.limit ?? 20;
      const { data, error } = await req.supabaseUser
        .from('backlog_items')
        .select('*')
        .eq('user_id', auth.userId)
        .eq('state', 'open')
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw new Error(`recovery-suggestions failed: ${error.message}`);
      const items = (data ?? []) as BacklogItemRow[];
      const now = Date.now();
      const suggestions = items.map((item) => {
        const ageDays = Math.max(
          0,
          Math.floor((now - new Date(item.created_at).getTime()) / 86_400_000),
        );
        let suggestedAction: 'reschedule' | 'dismiss' | 'complete';
        let reason: string;
        if (ageDays >= 14) {
          suggestedAction = 'dismiss';
          reason = `Backlog item is ${ageDays} days old; consider dismissing.`;
        } else if (ageDays >= 7) {
          suggestedAction = 'complete';
          reason = `Backlog item is ${ageDays} days old; consider completing or dismissing.`;
        } else {
          suggestedAction = 'reschedule';
          reason = `Backlog item is ${ageDays} days old; reschedule to a fresh slot.`;
        }
        return {
          backlogItemId: item.id,
          reason,
          suggestedAction,
          ageDays,
          sourceTaskId: item.source_task_id ?? null,
        };
      });
      return ok(reply, { suggestions });
    },
  );

  /**
   * Recover a backlog item via the chosen action.
   */
  app.post(
    '/planner/backlog/recover/:id',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(RecoverPlannerBacklogItemBody, req.body);
      const result = await recoverBacklogItem(req.supabaseUser, {
        userId: auth.userId,
        backlogItemId: params.id,
        action: body.action,
        ...(body.new_due_at ? { newDueAt: body.new_due_at } : {}),
        reason: body.reason ?? null,
      });
      return ok(reply, result);
    },
  );

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
