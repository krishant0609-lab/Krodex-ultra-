/**
 * KRODEX API — error lifecycle service (Phase 9).
 *
 * Owns the error_entries status state machine. Per TRD §11, the
 * five states and their valid transitions are:
 *
 *   ACTIVE ─→ IN_REVIEW
 *   ACTIVE ─→ ARCHIVED
 *   IN_REVIEW ─→ RESOLVED
 *   IN_REVIEW ─→ ACTIVE
 *   IN_REVIEW ─→ ARCHIVED
 *   RESOLVED ─→ REOPENED
 *   REOPENED ─→ IN_REVIEW
 *   REOPENED ─→ RESOLVED
 *   REOPENED ─→ ARCHIVED
 *   ARCHIVED ─→ (terminal; no outbound transitions in Phase 9)
 *
 * The legacy `errors.ts` service still owns the user-facing
 * `updateErrorEntry()` / `resolveError()` paths, but every state
 * transition must go through this service so the lifecycle
 * history table is populated. The capture orchestrator uses
 * `transitionStatus()` to flip newly-created or newly-resolved
 * errors into the correct state after the snapshot pipeline runs.
 *
 * Invariants:
 *   - Controllers MUST NOT set `error_entries.status` directly.
 *   - Every accepted transition appends a row to
 *     `error_lifecycle_events`. The insert is the audit log.
 *   - The history table is append-only; no UPDATE/DELETE.
 *   - Events are emitted into the outbox on every transition. The
 *     outbox unique-key dedupes duplicate emissions from retries.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ErrorEntryStatus,
  ErrorLifecycleEventInsert,
  ErrorLifecycleEventRow,
  ErrorLifecycleEventType,
} from '@krodex/shared';
import { asRow, asRows } from './_row';
import { serviceEmit } from '../events/service-emitter';
import { InvalidStateError } from '../errors';
import { assertOwned } from '../auth/ownership';
import * as errorsService from './errors';

/** What caused the transition. Persisted on the history row. */
export type LifecycleTrigger =
  | 'student_review'
  | 'ai_suggestion'
  | 'manual'
  | 'system';

/**
 * Edges of the state machine. We keep the table here (not at the
 * schema level) because the DB CHECK on `to_status` is just an
 * enum, not a transition constraint.
 */
const TRANSITIONS: Readonly<Record<ErrorEntryStatus, readonly ErrorEntryStatus[]>> = {
  active: ['in_review', 'archived'],
  in_review: ['resolved', 'active', 'archived'],
  resolved: ['reopened'],
  reopened: ['in_review', 'resolved', 'archived'],
  archived: [],
};

/**
 * Map a `to_status` to the corresponding `error.lifecycle.*`
 * EventType. We use an explicit switch (rather than a template
 * literal `error.lifecycle.${to_status}`) so TypeScript can verify
 * each branch against the EventType union and refuse a typo'd
 * status.
 */
function lifecycleEventTypeFor(
  status: ErrorEntryStatus,
): ErrorLifecycleEventType {
  switch (status) {
    case 'active':
      return 'error.lifecycle.active';
    case 'in_review':
      return 'error.lifecycle.in_review';
    case 'resolved':
      return 'error.lifecycle.resolved';
    case 'reopened':
      return 'error.lifecycle.reopened';
    case 'archived':
      return 'error.lifecycle.archived';
  }
}

/** True if a transition from `from` to `to` is allowed. */
export function isValidTransition(
  from: ErrorEntryStatus,
  to: ErrorEntryStatus,
): boolean {
  if (from === to) return false; // same-state transitions are no-ops
  return TRANSITIONS[from].includes(to);
}

/**
 * What the orchestrator / route handler hands to the service for
 * a single transition.
 */
export interface TransitionInput {
  /** Target status. Must be reachable from the row's current status. */
  to_status: ErrorEntryStatus;
  /** Why the transition happened. Recorded on the history row. */
  trigger: LifecycleTrigger;
  /** Free-form context, surfaced in the UI history panel. */
  reason?: string | null;
  /** The review id that drove the transition (student_review only). */
  review_id?: string | null;
}

export interface TransitionResult {
  /** The updated error_entries row. */
  errorEntry: Awaited<ReturnType<typeof errorsService.getErrorEntry>>;
  /** The lifecycle event row that was just appended. */
  event: ErrorLifecycleEventRow;
}

/**
 * Transition an error entry to a new status, append the lifecycle
 * event, and emit the corresponding `error.lifecycle.*` event.
 *
 * Throws `InvalidStateError` when the transition is not allowed
 * by the state machine. The source row is left untouched in that
 * case (no partial writes).
 */
export async function transitionStatus(
  client: SupabaseClient,
  userId: string,
  errorId: string,
  input: TransitionInput,
  actorId: string | null = null,
): Promise<TransitionResult> {
  // 1. Load + assert ownership. This is the gate: only the owner
  //    can move their own errors. RLS is the second line of
  //    defense; assertOwned is the service-layer guard that
  //    turns a cross-tenant read into ForbiddenError rather than
  //    an empty result set.
  const before = await errorsService.getErrorEntry(client, userId, errorId);
  if (before.status === input.to_status) {
    // Idempotent no-op: re-asserting the same status is fine but
    // should not append a duplicate history row. We synthesize a
    // "current state" event for the return value so the caller's
    // shape is preserved without lying about a real history row.
    return {
      errorEntry: before,
      event: syntheticEventFor(errorId, before.status, input.trigger),
    };
  }
  if (!isValidTransition(before.status, input.to_status)) {
    throw new InvalidStateError(
      `illegal transition: ${before.status} → ${input.to_status}`,
      { context: { errorId, from: before.status, to: input.to_status } },
    );
  }

  // 2. Update the error_entries row.
  const { data: updated, error } = await client
    .from('error_entries')
    .update({ status: input.to_status })
    .eq('id', errorId)
    .select('*')
    .single();
  if (error || !updated) {
    throw new Error(`transitionStatus update failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(updated, userId);

  // 3. Append the immutable history row.
  const historyInsert: ErrorLifecycleEventInsert = {
    error_entry_id: errorId,
    from_status: before.status,
    to_status: input.to_status,
    trigger: input.trigger,
    reason: input.reason ?? null,
    review_id: input.review_id ?? null,
  };
  const { data: event, error: eventErr } = await client
    .from('error_lifecycle_events')
    .insert(historyInsert)
    .select('*')
    .single();
  if (eventErr || !event) {
    throw new Error(
      `error_lifecycle_events insert failed: ${eventErr?.message ?? 'no row returned'}`,
    );
  }

  // 4. Emit the corresponding domain event. The outbox is
  //    post-commit; failure is logged and the row state stays
  //    consistent (see service-emitter.ts for the rationale).
  //    We map the validated to_status to a typed EventType
  //    (the template literal would otherwise widen to string,
  //    which EventType does not include).
  const eventType = lifecycleEventTypeFor(input.to_status);
  const result = await serviceEmit({
    client,
    userId,
    actorId: actorId ?? userId,
    eventType,
    aggregateType: 'error_entry',
    aggregateId: errorId,
    aggregateVersion: 1,
    payload: {
      error_id: errorId,
      from_status: before.status,
      to_status: input.to_status,
      trigger: input.trigger,
      reason: input.reason ?? null,
      review_id: input.review_id ?? null,
    },
  });
  if (result.kind === 'error') {
    console.warn(
      `[krodex] ${eventType} emit failed: ${result.error.message}`,
    );
  }

  return {
    errorEntry: asRow(await errorsService.getErrorEntry(client, userId, errorId)),
    event: asRow<ErrorLifecycleEventRow>(event),
  };
}

/**
 * Read the lifecycle history for an error entry, newest first.
 * Used by the in-app error detail page.
 */
export async function listLifecycleEvents(
  client: SupabaseClient,
  userId: string,
  errorId: string,
): Promise<readonly ErrorLifecycleEventRow[]> {
  // Ownership gate via the parent error.
  await errorsService.getErrorEntry(client, userId, errorId);
  const { data, error } = await client
    .from('error_lifecycle_events')
    .select('*')
    .eq('error_entry_id', errorId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listLifecycleEvents failed: ${error.message}`);
  return asRows<ErrorLifecycleEventRow>(data ?? []);
}

/**
 * Build a synthetic lifecycle event row representing the current
 * state of an error. Used only by the same-state no-op branch of
 * `transitionStatus()` so the caller gets a value-shaped result
 * without claiming a real history row exists.
 *
 * The id is a deterministic UUID derived from the error id and the
 * current status so two callers asking for the same state see the
 * same value. `created_at` is the Unix epoch (no clock) so the row
 * is stable across calls.
 */
function syntheticEventFor(
  errorId: string,
  status: ErrorEntryStatus,
  trigger: LifecycleTrigger,
): ErrorLifecycleEventRow {
  // Deterministic, time-independent value. Avoids Date.now() / Math.random()
  // (which are banned in deterministic contexts) while still being unique
  // per (errorId, status, trigger) tuple.
  let h = 0x811c9dc5;
  for (let i = 0; i < errorId.length; i++) {
    h ^= errorId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  for (let i = 0; i < status.length; i++) {
    h ^= status.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  for (let i = 0; i < trigger.length; i++) {
    h ^= trigger.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 8-char hex is plenty for a synthetic id.
  const id = `synth-${(h >>> 0).toString(16).padStart(8, '0')}`;
  return {
    id,
    error_entry_id: errorId,
    from_status: status,
    to_status: status,
    trigger,
    reason: 'synthetic:no-op',
    review_id: null,
    created_at: '1970-01-01T00:00:00.000Z',
  };
}
