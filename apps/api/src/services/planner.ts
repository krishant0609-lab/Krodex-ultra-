/**
 * KRODEX API — planner service.
 *
 * Phase 2 surface: list today's tasks, create a single task,
 * update a task (start / complete / mark partial / mark missed),
 * list templates. When a task is marked missed, the API also
 * creates a backlog item (server-authoritative state machine).
 *
 * Phase 3: emits `task.completed` (state→completed) and
 * `task.missed` (markTaskMissed) per PHASE3_PLAN §4.2.
 * Emissions are post-commit on the caller's client; failures are
 * logged and do not roll back the user-facing mutation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BacklogItemRow,
  PlannerTaskRow,
  PlannerTaskState,
  PlannerTemplateRow,
} from '@krodex/shared';
import { InvalidStateError, NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';
import { serviceEmit } from '../events/service-emitter';

export interface CreatePlannerTaskInput {
  template_id?: string | null;
  plan_date: string;
  title: string;
  description?: string | null;
  subject_id?: string | null;
  topic_id?: string | null;
  sub_topic_id?: string | null;
  planned_minutes?: number | null;
  metadata?: Record<string, unknown>;
}

export async function createPlannerTask(
  client: SupabaseClient,
  userId: string,
  input: CreatePlannerTaskInput,
): Promise<PlannerTaskRow> {
  const { data, error } = await client
    .from('planner_tasks')
    .insert({
      user_id: userId,
      template_id: input.template_id ?? null,
      plan_date: input.plan_date,
      title: input.title,
      description: input.description ?? null,
      state: 'planned',
      subject_id: input.subject_id ?? null,
      topic_id: input.topic_id ?? null,
      sub_topic_id: input.sub_topic_id ?? null,
      planned_minutes: input.planned_minutes ?? null,
      actual_minutes: null,
      started_at: null,
      completed_at: null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`createPlannerTask failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<PlannerTaskRow>(data);
}

export async function getPlannerTask(
  client: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<PlannerTaskRow> {
  const { data, error } = await client
    .from('planner_tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw new Error(`getPlannerTask failed: ${error.message}`);
  if (!data) throw new NotFoundError('planner task not found');
  assertOwned(data, userId);
  return asRow<PlannerTaskRow>(data);
}

export async function listPlannerTasks(
  client: SupabaseClient,
  userId: string,
  filter: { state?: PlannerTaskState; plan_date?: string; subject_id?: string; limit?: number } = {},
): Promise<readonly PlannerTaskRow[]> {
  let q = client
    .from('planner_tasks')
    .select('*')
    .eq('user_id', userId)
    .order('plan_date', { ascending: true })
    .limit(Math.min(filter.limit ?? 50, 200));
  if (filter.state) q = q.eq('state', filter.state);
  if (filter.plan_date) q = q.eq('plan_date', filter.plan_date);
  if (filter.subject_id) q = q.eq('subject_id', filter.subject_id);
  const { data, error } = await q;
  if (error) throw new Error(`listPlannerTasks failed: ${error.message}`);
  return asRows<PlannerTaskRow>(data ?? []);
}

export interface UpdatePlannerTaskInput {
  title?: string;
  description?: string | null;
  state?: PlannerTaskState;
  planned_minutes?: number | null;
  actual_minutes?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
}

export async function updatePlannerTask(
  client: SupabaseClient,
  userId: string,
  taskId: string,
  patch: UpdatePlannerTaskInput,
): Promise<PlannerTaskRow> {
  const before = await getPlannerTask(client, userId, taskId);
  // Lifecycle timestamps: when the client moves a task to
  // in_progress / completed without an explicit timestamp, the
  // server fills it in. The client can still override by passing
  // an explicit value.
  const next: Record<string, unknown> = { ...patch };
  if (patch.state === 'in_progress' && !patch.started_at && !before.started_at) {
    next.started_at = new Date().toISOString();
  }
  if (patch.state === 'completed' && !patch.completed_at) {
    next.completed_at = new Date().toISOString();
  }
  const { data, error } = await client
    .from('planner_tasks')
    .update(next)
    .eq('id', before.id)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`updatePlannerTask failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  const updated = asRow<PlannerTaskRow>(data);

  // Phase 3 §4.2: emit `task.completed` exactly once — when the
  // state transitions into 'completed'. Re-completing an already
  // completed task is a no-op for the event bus; the source
  // mutation is also a no-op effectively (the patch is idempotent
  // because the update overwrites with the same values).
  if (patch.state === 'completed' && before.state !== 'completed') {
    const result = await serviceEmit({
      client,
      userId,
      actorId: userId,
      eventType: 'task.completed',
      aggregateType: 'planner_task',
      aggregateId: updated.id,
      aggregateVersion: 1,
      payload: {
        task_id: updated.id,
        plan_date: updated.plan_date,
        subject_id: updated.subject_id,
      },
    });
    if (result.kind === 'error') {
      console.warn(`[krodex] task.completed emit failed: ${result.error.message}`);
    }
  }

  return updated;
}

export interface CreatePlannerTemplateInput {
  name: string;
  is_default?: boolean;
  template_payload: Record<string, unknown>;
}

export async function createPlannerTemplate(
  client: SupabaseClient,
  userId: string,
  input: CreatePlannerTemplateInput,
): Promise<PlannerTemplateRow> {
  if (input.is_default) {
    // Only one default template per user — clear the others first.
    await client.from('planner_templates').update({ is_default: false }).eq('user_id', userId).eq('is_default', true);
  }
  const { data, error } = await client
    .from('planner_templates')
    .insert({
      user_id: userId,
      name: input.name,
      is_default: input.is_default ?? false,
      template_payload: input.template_payload,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`createPlannerTemplate failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<PlannerTemplateRow>(data);
}

export async function listPlannerTemplates(
  client: SupabaseClient,
  userId: string,
): Promise<readonly PlannerTemplateRow[]> {
  const { data, error } = await client
    .from('planner_templates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listPlannerTemplates failed: ${error.message}`);
  return asRows<PlannerTemplateRow>(data ?? []);
}

export interface MarkMissedResult {
  task: PlannerTaskRow;
  backlog: BacklogItemRow | null;
}

export async function markTaskMissed(
  client: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<MarkMissedResult> {
  const before = await getPlannerTask(client, userId, taskId);
  if (before.state === 'completed' || before.state === 'cancelled') {
    throw new InvalidStateError('cannot mark a terminal task missed', {
      context: { state: before.state },
    });
  }
  const updated = await updatePlannerTask(client, userId, taskId, { state: 'missed' });
  // Always also create a backlog item so the recovery flow has
  // something to pick up later.
  const { data: backlog, error } = await client
    .from('backlog_items')
    .insert({
      user_id: userId,
      source_task_id: updated.id,
      reason: 'missed',
      state: 'open',
    })
    .select('*')
    .single();
  if (error || !backlog) {
    throw new Error(`markTaskMissed backlog failed: ${error?.message ?? 'no row returned'}`);
  }

  // Phase 3 §4.2: emit `task.missed` after the task state has
  // been flipped and the backlog item has been created. The
  // aggregate_id is the task id; the backlog_item_id is in
  // payload via the scheduleReviewEvent handling on the consumer
  // side if it needs it. We deliberately do NOT include the
  // backlog item id in the event payload because the §4.2 spec
  // does not list it as a key.
  const result = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'task.missed',
    aggregateType: 'planner_task',
    aggregateId: updated.id,
    aggregateVersion: 1,
    payload: {
      task_id: updated.id,
      plan_date: updated.plan_date,
      subject_id: updated.subject_id,
    },
  });
  if (result.kind === 'error') {
    console.warn(`[krodex] task.missed emit failed: ${result.error.message}`);
  }

  return { task: updated, backlog: asRow<BacklogItemRow>(backlog) };
}
