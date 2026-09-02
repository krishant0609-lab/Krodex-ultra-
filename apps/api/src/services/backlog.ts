/**
 * KRODEX API — backlog service.
 *
 * Phase 2 surface: list open backlog items, recover an item
 * (creates a new planner_task and records a backlog_recoveries
 * row), drop an item.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BacklogItemRow,
  BacklogReason,
  BacklogRecoveryRow,
  BacklogState,
  PlannerTaskRow,
} from '@krodex/shared';
import { InvalidStateError, NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';

export async function listBacklogItems(
  client: SupabaseClient,
  userId: string,
  filter: { state?: BacklogState; reason?: BacklogReason; limit?: number } = {},
): Promise<readonly BacklogItemRow[]> {
  let q = client
    .from('backlog_items')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(filter.limit ?? 50, 200));
  if (filter.state) q = q.eq('state', filter.state);
  if (filter.reason) q = q.eq('reason', filter.reason);
  const { data, error } = await q;
  if (error) throw new Error(`listBacklogItems failed: ${error.message}`);
  return asRows<BacklogItemRow>(data ?? []);
}

export async function getBacklogItem(
  client: SupabaseClient,
  userId: string,
  backlogId: string,
): Promise<BacklogItemRow> {
  const { data, error } = await client
    .from('backlog_items')
    .select('*')
    .eq('id', backlogId)
    .maybeSingle();
  if (error) throw new Error(`getBacklogItem failed: ${error.message}`);
  if (!data) throw new NotFoundError('backlog item not found');
  assertOwned(data, userId);
  return asRow<BacklogItemRow>(data);
}

export interface RecoverBacklogInput {
  plan_date?: string;
  notes?: string | null;
}

export interface RecoverBacklogResult {
  backlog: BacklogItemRow;
  recovered_task: PlannerTaskRow;
  recovery: BacklogRecoveryRow;
}

export async function recoverBacklogItem(
  client: SupabaseClient,
  userId: string,
  backlogId: string,
  input: RecoverBacklogInput,
): Promise<RecoverBacklogResult> {
  const backlog = await getBacklogItem(client, userId, backlogId);
  if (backlog.state !== 'open' && backlog.state !== 'scheduled') {
    throw new InvalidStateError('backlog item not recoverable', {
      context: { state: backlog.state },
    });
  }
  // Look up the source task to copy title / description.
  const { data: sourceTask, error: taskErr } = await client
    .from('planner_tasks')
    .select('*')
    .eq('id', backlog.source_task_id)
    .maybeSingle();
  if (taskErr) throw new Error(`recoverBacklogItem source-task lookup failed: ${taskErr.message}`);
  if (!sourceTask) throw new NotFoundError('backlog source task gone');
  assertOwned(sourceTask, userId);

  // Create the replacement planner task.
  const { data: newTask, error: newTaskErr } = await client
    .from('planner_tasks')
    .insert({
      user_id: userId,
      template_id: sourceTask.template_id,
      plan_date: input.plan_date ?? new Date().toISOString().slice(0, 10),
      title: sourceTask.title,
      description: sourceTask.description,
      state: 'planned',
      subject_id: sourceTask.subject_id,
      topic_id: sourceTask.topic_id,
      sub_topic_id: sourceTask.sub_topic_id,
      planned_minutes: sourceTask.planned_minutes,
      actual_minutes: null,
      started_at: null,
      completed_at: null,
      metadata: { recovered_from: backlog.id },
    })
    .select('*')
    .single();
  if (newTaskErr || !newTask) {
    throw new Error(`recoverBacklogItem create-task failed: ${newTaskErr?.message ?? 'no row returned'}`);
  }

  // Mark the backlog item recovered.
  const { data: updatedBacklog, error: updateErr } = await client
    .from('backlog_items')
    .update({ state: 'recovered' })
    .eq('id', backlog.id)
    .select('*')
    .single();
  if (updateErr || !updatedBacklog) {
    throw new Error(`recoverBacklogItem update failed: ${updateErr?.message ?? 'no row returned'}`);
  }

  // Record the recovery itself.
  const { data: recovery, error: recErr } = await client
    .from('backlog_recoveries')
    .insert({
      user_id: userId,
      backlog_item_id: backlog.id,
      recovered_task_id: newTask.id,
      state: 'planned',
      notes: input.notes ?? null,
    })
    .select('*')
    .single();
  if (recErr || !recovery) {
    throw new Error(`recoverBacklogItem recovery-row failed: ${recErr?.message ?? 'no row returned'}`);
  }

  return {
    backlog: asRow<BacklogItemRow>(updatedBacklog),
    recovered_task: asRow<PlannerTaskRow>(newTask),
    recovery: asRow<BacklogRecoveryRow>(recovery),
  };
}

export async function dropBacklogItem(
  client: SupabaseClient,
  userId: string,
  backlogId: string,
): Promise<BacklogItemRow> {
  const before = await getBacklogItem(client, userId, backlogId);
  const { data, error } = await client
    .from('backlog_items')
    .update({ state: 'dropped' })
    .eq('id', before.id)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`dropBacklogItem failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<BacklogItemRow>(data);
}
