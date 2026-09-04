/**
 * KRODEX API — progress evidence service (Phase 11 extension).
 *
 * Append-only writes to `progress_evidence`. Each helper maps a
 * domain event (planner completion, planner miss, error
 * resolution, backlog recovery) to a single evidence row.
 *
 * Schema Ready §14: "evidence must remain append-only". We never
 * UPDATE or DELETE a row; correcting an evidence entry means
 * adding a new observation with a negative delta.
 *
 * Phase 11 §17: the existing dimensions for planner activity
 * are `planner_completion`, `planner_backlog`, and
 * `backlog_recovered`. The existing dimensions for error
 * activity are `errors_resolved` and `errors_reopened`. The
 * helpers below use the canonical dimension names without
 * inventing new ones.
 *
 * The `ref_kind` discriminator follows the existing convention
 * used by other services (e.g. `analytics/drilldown.ts`):
 *   - 'planner_task'      for events keyed on a planner_tasks row
 *   - 'backlog_item'      for events keyed on a backlog_items row
 *   - 'error_entry'       for events keyed on an error_entries row
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json, ProgressEvidenceInsert, ProgressEvidenceRow } from '@krodex/shared';
import { serviceEmit } from '../events/service-emitter';
import { asRow } from './_row';

export interface PlannerEvidenceInput {
  userId: string;
  dimension:
    | 'planner_completion'
    | 'planner_backlog'
    | 'backlog_recovered'
    | 'errors_resolved'
    | 'errors_reopened';
  /** Numeric delta. Positive for additions, negative for corrections. */
  value: number;
  /** One of 'planner_task' | 'backlog_item' | 'error_entry'. */
  refKind: 'planner_task' | 'backlog_item' | 'error_entry';
  refId: string;
  metadata?: Record<string, unknown>;
  observedAt?: string;
}

export interface ProgressEvidenceResult {
  row: ProgressEvidenceRow;
  eventType:
    | 'progress.planner_completed'
    | 'progress.planner_missed'
    | 'progress.error_resolved';
}

/**
 * Append a single progress_evidence row and emit the
 * corresponding domain event.
 *
 * The event type is derived from the dimension:
 *   - 'planner_completion' / 'planner_backlog' ->
 *     'progress.planner_completed' (semantically: planner
 *     activity happened, regardless of direction)
 *   - 'backlog_recovered'  -> 'progress.planner_completed'
 *   - 'errors_resolved'    -> 'progress.error_resolved'
 *   - 'errors_reopened'    -> 'progress.error_resolved'
 *     (the schema-side dimension is reopened; the event type
 *     classifies it as a progress event for the error dimension
 *     in the same envelope family).
 */
export async function appendPlannerEvidence(
  client: SupabaseClient,
  input: PlannerEvidenceInput,
): Promise<ProgressEvidenceResult> {
  const row: ProgressEvidenceInsert = {
    user_id: input.userId,
    dimension: input.dimension,
    delta: String(input.value),
    ref_kind: input.refKind,
    ref_id: input.refId,
    captured_at: input.observedAt ?? new Date().toISOString(),
    metadata: (input.metadata ?? {}) as Json,
  };
  const { data, error } = await client
    .from('progress_evidence')
    .insert(row)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(
      `appendPlannerEvidence failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  const inserted = asRow<ProgressEvidenceRow>(data);

  // Determine the outbox event type. Planner dimensions share a
  // single event type for the planner surface; error dimensions
  // share another.
  const isPlannerDimension =
    input.dimension === 'planner_completion' ||
    input.dimension === 'planner_backlog' ||
    input.dimension === 'backlog_recovered';
  const eventType: ProgressEvidenceResult['eventType'] = isPlannerDimension
    ? 'progress.planner_completed'
    : 'progress.error_resolved';

  // The ProgressPlannerPayload and ProgressErrorResolvedPayload
  // envelope types use the canonical surface identifiers (task_id
  // for planner surfaces, error_id for error surfaces), not the
  // evidence-side `ref_id`/`ref_kind` keys. We map the evidence
  // ref back to the appropriate field based on ref_kind.
  const isErrorSurface = input.refKind === 'error_entry';
  const observedAt = inserted.captured_at;
  const payload = isErrorSurface
    ? {
        user_id: inserted.user_id,
        error_id: input.refId,
        observed_at: observedAt,
      }
    : {
        user_id: inserted.user_id,
        task_id: input.refId,
        observed_at: observedAt,
      };

  const emit = await serviceEmit({
    client,
    userId: input.userId,
    actorId: input.userId,
    eventType,
    aggregateType: 'progress_evidence',
    aggregateId: inserted.id,
    aggregateVersion: 1,
    payload,
  });
  if (emit.kind === 'error') {
    console.warn(`[krodex] ${eventType} emit failed: ${emit.error.message}`);
  }

  return { row: inserted, eventType };
}

/**
 * Convenience helper: record a task_completed evidence row.
 * Equivalent to calling `appendPlannerEvidence` with
 * dimension='planner_completion', ref_kind='planner_task',
 * value=1.
 */
export async function recordTaskCompleted(
  client: SupabaseClient,
  userId: string,
  taskId: string,
  metadata?: Record<string, unknown>,
): Promise<ProgressEvidenceResult> {
  return appendPlannerEvidence(client, {
    userId,
    dimension: 'planner_completion',
    value: 1,
    refKind: 'planner_task',
    refId: taskId,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Convenience helper: record a task_missed evidence row with
 * delta=missCount. The plan explicitly says "miss count is
 * surfaced to analytics but stored as miss_count on the task,
 * not as a penalty." We surface the count as a single evidence
 * row so the rollup can include the magnitude.
 */
export async function recordTaskMissed(
  client: SupabaseClient,
  userId: string,
  taskId: string,
  missCount: number,
  metadata?: Record<string, unknown>,
): Promise<ProgressEvidenceResult> {
  return appendPlannerEvidence(client, {
    userId,
    dimension: 'planner_backlog',
    value: missCount,
    refKind: 'planner_task',
    refId: taskId,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Convenience helper: record a backlog_recovered evidence row
 * with value=1.
 */
export async function recordBacklogRecovered(
  client: SupabaseClient,
  userId: string,
  backlogItemId: string,
  metadata?: Record<string, unknown>,
): Promise<ProgressEvidenceResult> {
  return appendPlannerEvidence(client, {
    userId,
    dimension: 'backlog_recovered',
    value: 1,
    refKind: 'backlog_item',
    refId: backlogItemId,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Convenience helper: record an errors_resolved evidence row
 * with value=1.
 */
export async function recordErrorResolved(
  client: SupabaseClient,
  userId: string,
  errorEntryId: string,
  metadata?: Record<string, unknown>,
): Promise<ProgressEvidenceResult> {
  return appendPlannerEvidence(client, {
    userId,
    dimension: 'errors_resolved',
    value: 1,
    refKind: 'error_entry',
    refId: errorEntryId,
    ...(metadata ? { metadata } : {}),
  });
}

/**
 * Convenience helper: record an errors_reopened evidence row
 * with value=1.
 */
export async function recordErrorReopened(
  client: SupabaseClient,
  userId: string,
  errorEntryId: string,
  metadata?: Record<string, unknown>,
): Promise<ProgressEvidenceResult> {
  return appendPlannerEvidence(client, {
    userId,
    dimension: 'errors_reopened',
    value: 1,
    refKind: 'error_entry',
    refId: errorEntryId,
    ...(metadata ? { metadata } : {}),
  });
}
