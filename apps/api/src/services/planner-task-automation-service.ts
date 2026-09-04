/**
 * KRODEX API — planner task automation service (Phase 11).
 *
 * Surfaces the automation that turns overdue / partial planner
 * tasks into recovery flows. The four operations:
 *
 *   - `detectMissedTasks`    — scan for tasks where due_at < now
 *                              and the task has not started, then
 *                              flip them to 'missed' and create a
 *                              backlog item.
 *   - `markPartial`          — a student marks a task as partial
 *                              (worked on, not completed by due).
 *                              Increments partial_count, appends
 *                              a 'partial' event, creates a
 *                              backlog item, emits task.partial.
 *   - `rescheduleTask`       — creates a NEW planner task linked
 *                              to the original via source_task_id.
 *                              The original task is preserved with
 *                              a 'rescheduled' event row appended.
 *                              Emits task.rescheduled.
 *   - `recoverBacklogItem`   — student picks an action on an open
 *                              backlog item: reschedule, complete,
 *                              dismiss, or split (split is recorded
 *                              as a single 'split' recovery event;
 *                              no new tasks are auto-created — the
 *                              client UI drives the split input).
 *
 * All mutations are append-only: the original task is never
 * rewritten or deleted. `planner_task_events` records every
 * transition. `backlog_recovery_events` records every recovery
 * action.
 *
 * Idempotency: the service is NOT idempotent on its own (re-calls
 * would create duplicate events). The route layer wraps these
 * functions with `withIdempotency` from apps/api/src/idempotency
 * keyed on a client-supplied commandId.
 *
 * Phase 11 §17 (PIP §449–458) and Schema Ready §14.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BacklogItemRow,
  PlannerTaskEventRow,
  PlannerTaskEventType,
  PlannerTaskRow,
} from '@krodex/shared';
import { assertOwned } from '../auth/ownership';
import { NotFoundError } from '../errors';
import { asRow, asRows } from './_row';
import { serviceEmit } from '../events/service-emitter';
import { markTaskMissed } from './planner';

// --- Public types ----------------------------------------------------

export interface DetectMissedTasksInput {
  userId: string;
  /** ISO timestamp; defaults to now(). Tasks with due_at < scanBefore are considered. */
  scanBefore?: string;
}

export interface DetectedMissedTask {
  task: PlannerTaskRow;
  alreadyMissed: boolean; // true if the task was already in 'missed' state (idempotent return)
}

export interface DetectMissedTasksResult {
  scannedAt: string;
  /** Tasks newly flipped to 'missed' by this call. */
  newlyMissed: DetectedMissedTask[];
  /** Tasks already 'missed' (returned for caller convenience; no DB write). */
  alreadyMissed: DetectedMissedTask[];
  /** Backlog item ids created by this call. */
  createdBacklogItemIds: string[];
}

export interface MarkPartialInput {
  userId: string;
  taskId: string;
  /** Student-reported actual minutes. Stored on the task; informational only. */
  actualDurationMinutes?: number | null;
  /** Optional reason from the client. */
  reason?: string | null;
}

export interface MarkPartialResult {
  task: PlannerTaskRow;
  eventId: string;
  recoveryEventId: string;
  backlogItem: BacklogItemRow;
}

export interface RescheduleTaskInput {
  userId: string;
  taskId: string;
  /** ISO timestamp for the new due_at. */
  newDueAt: string;
  reason?: string | null;
}

export interface RescheduleTaskResult {
  originalTask: PlannerTaskRow;
  newTask: PlannerTaskRow;
  eventId: string;
}

export type BacklogRecoveryAction = 'reschedule' | 'complete' | 'dismiss' | 'split';

export interface RecoverBacklogItemInput {
  userId: string;
  backlogItemId: string;
  action: BacklogRecoveryAction;
  /** Required for action='reschedule'. */
  newDueAt?: string;
  /** Optional reason from the client. */
  reason?: string | null;
}

export interface RecoverBacklogItemResult {
  backlogItem: BacklogItemRow;
  recoveryEventId: string;
  /** Present when action='reschedule' — the newly created planner task. */
  newTask?: PlannerTaskRow;
}

// --- Internal helpers ------------------------------------------------

interface InternalEventAppend {
  task_id: string;
  event_type: PlannerTaskEventType;
  previous_due_at?: string | null;
  new_due_at?: string | null;
  reason?: string | null;
}

async function appendPlannerTaskEvent(
  client: SupabaseClient,
  userId: string,
  row: InternalEventAppend,
): Promise<PlannerTaskEventRow> {
  // The RLS policy on planner_task_events permits INSERT for the
  // owning student; we therefore pass user_id explicitly so the
  // call works under the request-scoped client.
  const { data, error } = await client
    .from('planner_task_events')
    .insert({
      task_id: row.task_id,
      event_type: row.event_type,
      previous_due_at: row.previous_due_at ?? null,
      new_due_at: row.new_due_at ?? null,
      reason: row.reason ?? null,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(
      `appendPlannerTaskEvent failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  // We don't have a user_id column on planner_task_events; the
  // user scoping is implicit via task_id -> user_id. Skip
  // assertOwned here.
  void userId;
  return asRow<PlannerTaskEventRow>(data);
}

async function appendBacklogRecoveryEvent(
  client: SupabaseClient,
  userId: string,
  row: {
    backlog_item_id?: string | null;
    task_id?: string | null;
    recovery_type: 'rescheduled' | 'split' | 'downgraded' | 'completed' | 'dismissed';
  },
): Promise<{ id: string }> {
  const { data, error } = await client
    .from('backlog_recovery_events')
    .insert({
      user_id: userId,
      backlog_item_id: row.backlog_item_id ?? null,
      task_id: row.task_id ?? null,
      recovery_type: row.recovery_type,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `appendBacklogRecoveryEvent failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  return asRow<{ id: string }>(data);
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- Miss detection --------------------------------------------------

/**
 * Scan for planner tasks that should be marked missed.
 *
 * Phase 11 domain rule: a task is "missed" when:
 *   - plan_date + planned_minutes is in the past (we approximate
 *     using plan_date; due_at is a Phase 11 synonym)
 *   - state ∈ {'planned', 'in_progress'} (NOT already terminal)
 *   - state !== 'missed' (re-scanning a missed task is a no-op)
 *
 * For each candidate, the existing `markTaskMissed` is invoked.
 * That helper already handles the state transition and the
 * backlog item creation; this service wraps it with the
 * planner_task_events history row.
 */
export async function detectMissedTasks(
  client: SupabaseClient,
  input: DetectMissedTasksInput,
): Promise<DetectMissedTasksResult> {
  const userId = input.userId;
  const scanBefore = input.scanBefore ?? nowIso();

  // Fetch tasks that could potentially be missed. Filter at the
  // DB to keep the payload small. Two queries: candidates for
  // the active flip, and any already-missed tasks for the
  // idempotent re-scan path.
  const { data: candidates, error } = await client
    .from('planner_tasks')
    .select('*')
    .eq('user_id', userId)
    .lt('plan_date', scanBefore)
    .in('state', ['planned', 'in_progress']);
  if (error) {
    throw new Error(`detectMissedTasks query failed: ${error.message}`);
  }

  const { data: missed, error: missedErr } = await client
    .from('planner_tasks')
    .select('*')
    .eq('user_id', userId)
    .lt('plan_date', scanBefore)
    .eq('state', 'missed');
  if (missedErr) {
    throw new Error(`detectMissedTasks missed query failed: ${missedErr.message}`);
  }

  const newlyMissed: DetectedMissedTask[] = [];
  const alreadyMissed: DetectedMissedTask[] = [];
  const createdBacklogItemIds: string[] = [];

  // Populate already-missed from the second query (these are
  // returned to the caller for visibility but no DB write
  // happens).
  for (const raw of missed ?? []) {
    const task = asRow<PlannerTaskRow>(raw);
    assertOwned(task, userId);
    alreadyMissed.push({ task, alreadyMissed: true });
  }

  for (const raw of candidates ?? []) {
    const task = asRow<PlannerTaskRow>(raw);
    assertOwned(task, userId);
    // The candidate query already filters out 'missed' tasks.
    // Use the existing markTaskMissed for the underlying state +
    // backlog flip. We then append the planner_task_events row
    // for history and re-emit task.missed.
    const result = await markTaskMissed(client, userId, task.id);
    await appendPlannerTaskEvent(client, userId, {
      task_id: task.id,
      event_type: 'missed',
      previous_due_at: task.plan_date,
      new_due_at: task.plan_date,
      reason: 'auto_detected_overdue',
    });
    createdBacklogItemIds.push(result.backlog?.id ?? '');
    newlyMissed.push({ task: result.task, alreadyMissed: false });
  }

  return {
    scannedAt: scanBefore,
    newlyMissed,
    alreadyMissed,
    createdBacklogItemIds,
  };
}

// --- Partial ---------------------------------------------------------

/**
 * Mark a task as partial. Phase 11 semantics: the student worked
 * on the task but did not complete it by the due date. We do NOT
 * derive partial from timing; the student (or the teacher for a
 * paper task) drives the partial flag. The service:
 *   - transitions the task to state='partial'
 *   - increments partial_count
 *   - appends a 'partial' planner_task_events row
 *   - creates a backlog item
 *   - emits task.partial
 */
export async function markPartial(
  client: SupabaseClient,
  input: MarkPartialInput,
): Promise<MarkPartialResult> {
  const userId = input.userId;
  // Read the current task so we can preserve history and know the
  // current partial_count. assertOwned is invoked inside the
  // service helpers.
  const { data: before, error: readErr } = await client
    .from('planner_tasks')
    .select('*')
    .eq('id', input.taskId)
    .maybeSingle();
  if (readErr) throw new Error(`markPartial read failed: ${readErr.message}`);
  if (!before) throw new NotFoundError('planner task not found');
  assertOwned(before, userId);
  const beforeRow = asRow<PlannerTaskRow>(before);

  if (beforeRow.state === 'completed') {
    throw new Error('cannot mark a completed task partial');
  }
  if (beforeRow.state === 'partial') {
    // Idempotent: the task is already partial. Append another
    // 'partial' event row to record the additional attempt, but
    // do NOT create another backlog item.
    const ev = await appendPlannerTaskEvent(client, userId, {
      task_id: beforeRow.id,
      event_type: 'partial',
      previous_due_at: beforeRow.plan_date,
      new_due_at: beforeRow.plan_date,
      reason: input.reason ?? 'repeat_partial',
    });
    const { data: existing } = await client
      .from('backlog_items')
      .select('*')
      .eq('source_task_id', beforeRow.id)
      .eq('reason', 'partial')
      .maybeSingle();
    return {
      task: beforeRow,
      eventId: ev.id,
      recoveryEventId: '',
      backlogItem: asRow<BacklogItemRow>(existing ?? {
        id: '',
        user_id: userId,
        source_task_id: beforeRow.id,
        reason: 'partial',
        state: 'open',
        created_at: nowIso(),
      }),
    };
  }

  // Transition the task to partial and bump partial_count.
  const nextCount = (beforeRow.partial_count ?? 0) + 1;
  const { data: updated, error: updateErr } = await client
    .from('planner_tasks')
    .update({
      state: 'partial',
      partial_count: nextCount,
      actual_minutes: input.actualDurationMinutes ?? null,
    })
    .eq('id', beforeRow.id)
    .select('*')
    .single();
  if (updateErr || !updated) {
    throw new Error(`markPartial update failed: ${updateErr?.message ?? 'no row returned'}`);
  }
  assertOwned(updated, userId);
  const updatedRow = asRow<PlannerTaskRow>(updated);

  // History row.
  const ev = await appendPlannerTaskEvent(client, userId, {
    task_id: updatedRow.id,
    event_type: 'partial',
    previous_due_at: beforeRow.plan_date,
    new_due_at: updatedRow.plan_date,
    reason: input.reason ?? null,
  });

  // Backlog item for the recovery panel.
  const { data: backlog, error: backlogErr } = await client
    .from('backlog_items')
    .insert({
      user_id: userId,
      source_task_id: updatedRow.id,
      reason: 'partial',
      state: 'open',
    })
    .select('*')
    .single();
  if (backlogErr || !backlog) {
    throw new Error(
      `markPartial backlog failed: ${backlogErr?.message ?? 'no row returned'}`,
    );
  }
  const backlogRow = asRow<BacklogItemRow>(backlog);

  // Recovery event for the new backlog item.
  const recovery = await appendBacklogRecoveryEvent(client, userId, {
    backlog_item_id: backlogRow.id,
    task_id: updatedRow.id,
    recovery_type: 'downgraded',
  });

  // Outbox event.
  const result = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'task.partial',
    aggregateType: 'planner_task',
    aggregateId: updatedRow.id,
    aggregateVersion: 1,
    payload: {
      task_id: updatedRow.id,
      plan_date: updatedRow.plan_date,
      subject_id: updatedRow.subject_id ?? null,
      actual_minutes: updatedRow.actual_minutes ?? null,
      planned_minutes: updatedRow.planned_minutes ?? null,
    },
  });
  if (result.kind === 'error') {
    console.warn(`[krodex] task.partial emit failed: ${result.error.message}`);
  }

  return {
    task: updatedRow,
    eventId: ev.id,
    recoveryEventId: recovery.id,
    backlogItem: backlogRow,
  };
}

// --- Reschedule ------------------------------------------------------

/**
 * Reschedule a planner task by creating a new task linked to the
 * original. The original is preserved verbatim; a
 * 'rescheduled' event row records the change.
 *
 * Per Phase 11 §19: "Reschedule preserves original task + all
 * history. Recovery creates a new PlannerTask linked to the
 * originating task via source_task_id. Original task gets a
 * planner_task_events.rescheduled row."
 */
export async function rescheduleTask(
  client: SupabaseClient,
  input: RescheduleTaskInput,
): Promise<RescheduleTaskResult> {
  const userId = input.userId;

  // Read the original task.
  const { data: before, error: readErr } = await client
    .from('planner_tasks')
    .select('*')
    .eq('id', input.taskId)
    .maybeSingle();
  if (readErr) throw new Error(`rescheduleTask read failed: ${readErr.message}`);
  if (!before) throw new NotFoundError('planner task not found');
  assertOwned(before, userId);
  const beforeRow = asRow<PlannerTaskRow>(before);

  if (beforeRow.state === 'completed') {
    throw new Error('cannot reschedule a completed task');
  }

  // Create the new task. Carry the title / subject / topic /
  // planned_minutes from the original; the new plan_date is the
  // caller-supplied newDueAt.
  const { data: newTask, error: insertErr } = await client
    .from('planner_tasks')
    .insert({
      user_id: userId,
      template_id: beforeRow.template_id ?? null,
      plan_date: input.newDueAt,
      title: beforeRow.title,
      description: beforeRow.description ?? null,
      state: 'planned',
      subject_id: beforeRow.subject_id ?? null,
      topic_id: beforeRow.topic_id ?? null,
      sub_topic_id: beforeRow.sub_topic_id ?? null,
      planned_minutes: beforeRow.planned_minutes ?? null,
      actual_minutes: null,
      started_at: null,
      completed_at: null,
      metadata: beforeRow.metadata ?? {},
      source_task_id: beforeRow.id,
    })
    .select('*')
    .single();
  if (insertErr || !newTask) {
    throw new Error(
      `rescheduleTask insert failed: ${insertErr?.message ?? 'no row returned'}`,
    );
  }
  assertOwned(newTask, userId);
  const newTaskRow = asRow<PlannerTaskRow>(newTask);

  // Append the 'rescheduled' event row on the original task.
  const ev = await appendPlannerTaskEvent(client, userId, {
    task_id: beforeRow.id,
    event_type: 'rescheduled',
    previous_due_at: beforeRow.plan_date,
    new_due_at: input.newDueAt,
    reason: input.reason ?? null,
  });

  // Outbox event.
  const result = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'task.rescheduled',
    aggregateType: 'planner_task',
    aggregateId: beforeRow.id,
    aggregateVersion: 1,
    payload: {
      task_id: beforeRow.id,
      new_task_id: newTaskRow.id,
      previous_due_at: beforeRow.plan_date,
      new_due_at: input.newDueAt,
      reason: input.reason ?? null,
    },
  });
  if (result.kind === 'error') {
    console.warn(`[krodex] task.rescheduled emit failed: ${result.error.message}`);
  }

  return {
    originalTask: beforeRow,
    newTask: newTaskRow,
    eventId: ev.id,
  };
}

// --- Backlog recovery ------------------------------------------------

/**
 * Recover a backlog item. The student picks one of:
 *   - reschedule: create a new planner task linked to the
 *     originating source_task_id (if any). The backlog item is
 *     marked 'recovered'.
 *   - complete: mark the originating task complete (if it still
 *     exists and is not terminal). Otherwise just mark the
 *     backlog item 'recovered'.
 *   - dismiss: mark the backlog item 'dropped'.
 *   - split: just record the split intent as a recovery event;
 *     the client UI drives the actual split input. The backlog
 *     item is left 'open' for the next action.
 */
export async function recoverBacklogItem(
  client: SupabaseClient,
  input: RecoverBacklogItemInput,
): Promise<RecoverBacklogItemResult> {
  const userId = input.userId;

  // Read the backlog item.
  const { data: backlog, error: readErr } = await client
    .from('backlog_items')
    .select('*')
    .eq('id', input.backlogItemId)
    .maybeSingle();
  if (readErr) throw new Error(`recoverBacklogItem read failed: ${readErr.message}`);
  if (!backlog) throw new NotFoundError('backlog item not found');
  assertOwned(backlog, userId);
  const backlogRow = asRow<BacklogItemRow>(backlog);

  let newTask: PlannerTaskRow | undefined;

  switch (input.action) {
    case 'reschedule': {
      if (!input.newDueAt) {
        throw new Error('reschedule action requires newDueAt');
      }
      if (backlogRow.source_task_id) {
        // Reuse rescheduleTask so the history row and outbox event
        // are emitted with the same shape as a manual reschedule.
        const result = await rescheduleTask(client, {
          userId,
          taskId: backlogRow.source_task_id,
          newDueAt: input.newDueAt,
          reason: input.reason ?? 'backlog_recovery',
        });
        newTask = result.newTask;
      } else {
        // No source task — the backlog item has no original task
        // to reschedule. Create a barebones planner task.
        const { data: bare, error: bareErr } = await client
          .from('planner_tasks')
          .insert({
            user_id: userId,
            plan_date: input.newDueAt,
            title: `Recovered from backlog ${backlogRow.id.slice(0, 8)}`,
            state: 'planned',
            metadata: { from_backlog: backlogRow.id, reason: backlogRow.reason },
            source_task_id: null,
          })
          .select('*')
          .single();
        if (bareErr || !bare) {
          throw new Error(
            `recoverBacklogItem insert failed: ${bareErr?.message ?? 'no row returned'}`,
          );
        }
        assertOwned(bare, userId);
        newTask = asRow<PlannerTaskRow>(bare);
      }
      // Mark the backlog item 'recovered'.
      const { data: updated, error: updateErr } = await client
        .from('backlog_items')
        .update({ state: 'recovered' })
        .eq('id', backlogRow.id)
        .select('*')
        .single();
      if (updateErr || !updated) {
        throw new Error(
          `recoverBacklogItem update failed: ${updateErr?.message ?? 'no row returned'}`,
        );
      }
      Object.assign(backlogRow, updated);
      break;
    }
    case 'complete': {
      if (backlogRow.source_task_id) {
        const { data: src, error: srcErr } = await client
          .from('planner_tasks')
          .select('*')
          .eq('id', backlogRow.source_task_id)
          .maybeSingle();
        if (srcErr) throw new Error(`recover complete read src: ${srcErr.message}`);
        if (src && (src.state === 'planned' || src.state === 'in_progress' || src.state === 'partial')) {
          const { error: completeErr } = await client
            .from('planner_tasks')
            .update({
              state: 'completed',
              completed_at: nowIso(),
            })
            .eq('id', backlogRow.source_task_id);
          if (completeErr) {
            throw new Error(`recover complete update: ${completeErr.message}`);
          }
          await appendPlannerTaskEvent(client, userId, {
            task_id: backlogRow.source_task_id,
            event_type: 'completed',
            reason: 'recovered_via_backlog',
          });
        }
      }
      const { data: updated, error: updateErr } = await client
        .from('backlog_items')
        .update({ state: 'recovered' })
        .eq('id', backlogRow.id)
        .select('*')
        .single();
      if (updateErr || !updated) {
        throw new Error(
          `recoverBacklogItem update failed: ${updateErr?.message ?? 'no row returned'}`,
        );
      }
      Object.assign(backlogRow, updated);
      break;
    }
    case 'dismiss': {
      const { data: updated, error: updateErr } = await client
        .from('backlog_items')
        .update({ state: 'dropped' })
        .eq('id', backlogRow.id)
        .select('*')
        .single();
      if (updateErr || !updated) {
        throw new Error(
          `recoverBacklogItem update failed: ${updateErr?.message ?? 'no row returned'}`,
        );
      }
      Object.assign(backlogRow, updated);
      break;
    }
    case 'split': {
      // No state change. Just record the recovery event. The
      // client is expected to call again with reschedule /
      // complete / dismiss for each split piece.
      break;
    }
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = input.action;
      throw new Error(`unknown backlog action: ${String(_exhaustive)}`);
    }
  }

  // Append the recovery event for every action.
  const recovery = await appendBacklogRecoveryEvent(client, userId, {
    backlog_item_id: backlogRow.id,
    task_id: backlogRow.source_task_id ?? newTask?.id ?? null,
    recovery_type:
      input.action === 'reschedule'
        ? 'rescheduled'
        : input.action === 'complete'
          ? 'completed'
          : input.action === 'dismiss'
            ? 'dismissed'
            : 'split',
  });

  // Outbox event.
  const out = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'backlog.item_recovered',
    aggregateType: 'backlog_item',
    aggregateId: backlogRow.id,
    aggregateVersion: 1,
    payload: {
      backlog_item_id: backlogRow.id,
      recovery_type:
        input.action === 'reschedule'
          ? 'reschedule'
          : input.action === 'dismiss'
            ? 'dismissed'
            : input.action === 'complete'
              ? 'completed'
              : 'split',
      recovered_task_id: newTask?.id ?? null,
    },
  });
  if (out.kind === 'error') {
    console.warn(`[krodex] backlog.item_recovered emit failed: ${out.error.message}`);
  }

  return {
    backlogItem: asRow<BacklogItemRow>(backlogRow),
    recoveryEventId: recovery.id,
    ...(newTask ? { newTask } : {}),
  };
}

// --- History reads ---------------------------------------------------

/**
 * Read the planner_task_events history for a single task.
 * Returns events in reverse-chronological order (newest first).
 */
export async function getTaskHistory(
  client: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<readonly PlannerTaskEventRow[]> {
  // First confirm the user owns the task (defence in depth — RLS
  // should also enforce this).
  const { data: task, error: taskErr } = await client
    .from('planner_tasks')
    .select('id, user_id')
    .eq('id', taskId)
    .maybeSingle();
  if (taskErr) throw new Error(`getTaskHistory read task: ${taskErr.message}`);
  if (!task) throw new NotFoundError('planner task not found');
  assertOwned(task, userId);

  const { data, error } = await client
    .from('planner_task_events')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getTaskHistory failed: ${error.message}`);
  return asRows<PlannerTaskEventRow>(data ?? []);
}
