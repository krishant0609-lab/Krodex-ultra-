/**
 * KRODEX — domain event envelope and catalog.
 *
 * Phase 3: the typed shape every domain event follows. Mirrors
 * TRD §8 ("Domain Event Architecture"). Apps/api produces these
 * (from inside RPCs and from service-layer mutations); the worker
 * consumes them. Apps/web reads the projected side-effects
 * (notifications, progress_evidence) but never reads the
 * outbox directly.
 *
 * The catalog is the single source of truth. To add a new event
 * type, append it to the EventType union, declare its payload
 * shape in payloads.ts, and document it in docs/PHASE3_PLAN.md.
 */

import type { Json } from '../db/types';

/** The 13 domain event types from TRD §8 plus Phase 9 additions. */
export type EventType =
  | 'attempt.submitted'
  | 'attempt.analyzed'
  | 'error.recorded'
  | 'error.classified'
  | 'review.scheduled'
  | 'review.started'
  | 'review.outcome_recorded'
  | 'error.resolved'
  | 'error.reopened'
  | 'task.completed'
  | 'task.missed'
  | 'syllabus.node_archived'
  | 'notification.created'
  /** Synthetic event emitted by scheduled jobs for audit-trail symmetry. */
  | 'system.tick'
  /** Phase 9 — evidence pipeline */
  | 'evidence.captured'
  | 'evidence.snapshot_created'
  | 'evidence.snapshot_failed'
  /** Phase 9 — error lifecycle */
  | 'error.lifecycle.active'
  | 'error.lifecycle.in_review'
  | 'error.lifecycle.resolved'
  | 'error.lifecycle.reopened'
  | 'error.lifecycle.archived'
  /** Phase 10 — review / retest engine */
  | 'review.verification_question_used'
  /** Phase 11 — planner / backlog automation */
  | 'task.partial'
  | 'task.rescheduled'
  | 'backlog.item_created'
  | 'backlog.item_recovered'
  | 'progress.planner_completed'
  | 'progress.planner_missed'
  | 'progress.error_resolved'
  /** Phase 12 — notifications & scheduling */
  | 'review.due'
  | 'review.overdue'
  | 'task.upcoming';

/** Per-event payload shapes. */
export interface EventPayloadMap {
  'attempt.submitted': AttemptSubmittedPayload;
  'attempt.analyzed': AttemptAnalyzedPayload;
  'error.recorded': ErrorRecordedPayload;
  'error.classified': ErrorClassifiedPayload;
  'review.scheduled': ReviewScheduledPayload;
  'review.started': ReviewStartedPayload;
  'review.outcome_recorded': ReviewOutcomeRecordedPayload;
  'error.resolved': ErrorResolvedPayload;
  'error.reopened': ErrorReopenedPayload;
  'task.completed': TaskCompletedPayload;
  'task.missed': TaskMissedPayload;
  'syllabus.node_archived': SyllabusNodeArchivedPayload;
  'notification.created': NotificationCreatedPayload;
  'system.tick': SystemTickPayload;
  'evidence.captured': EvidenceCapturedPayload;
  'evidence.snapshot_created': EvidenceSnapshotCreatedPayload;
  'evidence.snapshot_failed': EvidenceSnapshotFailedPayload;
  'error.lifecycle.active': ErrorLifecyclePayload;
  'error.lifecycle.in_review': ErrorLifecyclePayload;
  'error.lifecycle.resolved': ErrorLifecyclePayload;
  'error.lifecycle.reopened': ErrorLifecyclePayload;
  'error.lifecycle.archived': ErrorLifecyclePayload;
  'review.verification_question_used': ReviewVerificationQuestionUsedPayload;
  'task.partial': TaskPartialPayload;
  'task.rescheduled': TaskRescheduledPayload;
  'backlog.item_created': BacklogItemCreatedPayload;
  'backlog.item_recovered': BacklogItemRecoveredPayload;
  'progress.planner_completed': ProgressPlannerPayload;
  'progress.planner_missed': ProgressPlannerPayload;
  'progress.error_resolved': ProgressErrorResolvedPayload;
  /** Phase 12 — notifications & scheduling */
  'review.due': ReviewDuePayload;
  'review.overdue': ReviewOverduePayload;
  'task.upcoming': TaskUpcomingPayload;
}

export interface AttemptSubmittedPayload {
  test_id: string;
  attempt_id: string;
  correct_count: number;
  incorrect_count: number;
  partial_count: number;
  skipped_count: number;
  accuracy: string; // numeric serialized as string
  duration_ms: number | null;
  incorrect_question_ids: readonly string[];
}

export interface AttemptAnalyzedPayload {
  attempt_id: string;
  test_id: string;
  answers: ReadonlyArray<{ question_id: string; outcome: string }>;
}

export interface ErrorRecordedPayload {
  error_id: string;
  question_id: string | null;
  source_attempt_id: string | null;
  recurrence_count: number;
}

export interface ErrorClassifiedPayload {
  error_id: string;
  mistake_type: string;
  previous_mistake_type: string | null;
}

export interface ReviewScheduledPayload {
  schedule_id: string;
  error_id: string;
  strategy: string;
  due_at: string;
}

export interface ReviewStartedPayload {
  schedule_id: string;
  error_id: string;
  previous_state: string;
}

/**
 * Per-event payload uses its own type name to avoid colliding with
 * the db-namespace `ReviewOutcome` string union. The two carry the
 * same values ('correct' | 'incorrect' | 'partial') but are kept
 * distinct so the event-payload side can evolve without disturbing
 * the database CHECK-constrained union (and vice versa).
 */
export type EventReviewOutcome = 'correct' | 'incorrect' | 'partial';

export interface ReviewOutcomeRecordedPayload {
  schedule_id: string;
  error_id: string;
  question_id: string;
  outcome: EventReviewOutcome;
}

export interface ErrorResolvedPayload {
  error_id: string;
  trigger: 'review' | 'manual';
  review_schedule_id: string | null;
}

export interface ErrorReopenedPayload {
  error_id: string;
  source_attempt_id: string | null;
}

export interface TaskCompletedPayload {
  task_id: string;
  plan_date: string;
  subject_id: string | null;
}

export interface TaskMissedPayload {
  task_id: string;
  plan_date: string;
  subject_id: string | null;
}

export interface SyllabusNodeArchivedPayload {
  node_type: 'subject' | 'topic' | 'sub_topic';
  node_id: string;
}

export interface NotificationCreatedPayload {
  notification_id: string;
  kind: string;
  severity: string;
  source_event_id: string;
  title: string;
  body: string | null;
  /** Free-form metadata blob the producer wants on the row. */
  metadata: Record<string, unknown>;
}

export interface SystemTickPayload {
  job_name: string;
  ran_at: string;
  emitted_event_count: number;
}

export interface EvidenceCapturedPayload {
  evidence_id: string;
  error_entry_id: string | null;
  attempt_id: string | null;
  classification_status: string;
}

export interface EvidenceSnapshotCreatedPayload {
  evidence_id: string;
  asset_id: string;
  storage_bucket: string;
  storage_key: string;
  byte_size: string;
  sha256: string | null;
}

export interface EvidenceSnapshotFailedPayload {
  evidence_id: string;
  asset_id: string;
  reason: string;
}

export interface ErrorLifecyclePayload {
  error_id: string;
  from_status: string | null;
  to_status: string;
  trigger: string;
  reason: string | null;
  review_id: string | null;
}

// --- Phase 10 payload types ----------------------------------

export interface ReviewVerificationQuestionUsedPayload {
  schedule_id: string;
  error_id: string;
  question_id: string;
}

// --- Phase 11 payload types ----------------------------------

export interface TaskPartialPayload {
  task_id: string;
  plan_date: string;
  subject_id: string | null;
  actual_minutes: number | null;
  planned_minutes: number | null;
}

export interface TaskRescheduledPayload {
  task_id: string;
  previous_due_at: string | null;
  new_due_at: string;
  reason: string | null;
  new_task_id: string | null;
}

export interface BacklogItemCreatedPayload {
  backlog_item_id: string;
  source_task_id: string;
  reason: string;
}

export interface BacklogItemRecoveredPayload {
  backlog_item_id: string;
  recovery_type: 'reschedule' | 'split' | 'downgraded' | 'completed' | 'dismissed';
  recovered_task_id: string | null;
}

export interface ProgressPlannerPayload {
  user_id: string;
  task_id: string;
  observed_at: string;
}

export interface ProgressErrorResolvedPayload {
  user_id: string;
  error_id: string;
  observed_at: string;
}

// --- Phase 12 payload types ----------------------------------

export interface ReviewDuePayload {
  schedule_id: string;
  error_id: string;
  due_at: string;
  strategy: string;
}

export interface ReviewOverduePayload {
  schedule_id: string;
  error_id: string;
  due_at: string;
  overdue_by_seconds: number;
}

export interface TaskUpcomingPayload {
  task_id: string;
  plan_date: string;
  subject_id: string | null;
  due_at: string;
}

/** The envelope. Matches TRD §8 fields verbatim. */
export interface EventEnvelope<T extends EventType = EventType> {
  /** sha256(event_type|aggregate_type|aggregate_id|version|idempotency_key), hex. */
  eventId: string;
  eventType: T;
  schemaVersion: 1;
  /** ISO 8601. */
  occurredAt: string;
  /** Owning user. Phase 3 aliases TRD's accountId → user_id. */
  accountId: string;
  /** The user who caused the event (null = system / worker). */
  actorId: string | null;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: EventPayloadMap[T];
  /** See plan §4.3 for the formula. */
  idempotencyKey: string;
}

/** All envelope field names. Used by the shared serialization helpers. */
export const ENVELOPE_FIELDS = [
  'eventId',
  'eventType',
  'schemaVersion',
  'occurredAt',
  'accountId',
  'actorId',
  'aggregateType',
  'aggregateId',
  'aggregateVersion',
  'payload',
  'idempotencyKey',
] as const;

/** Allow loose Json to flow through (jsonb column). */
export type AnyEnvelope = EventEnvelope & { payload: Json };
