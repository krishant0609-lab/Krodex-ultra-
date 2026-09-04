/**
 * KRODEX — runtime list of every CHECK-constrained enum value.
 *
 * `enums.ts` defines each union as a `type` (TS erases type-only
 * declarations at runtime). The migration test (and any future
 * runtime validation) needs the literal value list, so we keep a
 * parallel `as const` array here. When you add a value to a union
 * in `enums.ts`, also add it to the matching array in this file
 * in the same commit.
 *
 * If they drift, `migrations.test.ts` will fail with a clear
 * "value not present in SQL" error.
 */

import type {
  AiConversationState,
  AiMessageRole,
  BacklogReason,
  BacklogRecoveryState,
  BacklogState,
  CapturedQuestionState,
  ClassificationStatus,
  CoverageState,
  Difficulty,
  ErrorEntryStatus,
  EvidenceAssetStatus,
  MistakeType,
  NotificationChannel,
  NotificationDeliveryState,
  NotificationSeverity,
  PlannerTaskState,
  QuestionType,
  ReviewAttemptOutcome,
  ReviewOutcome,
  ReviewState,
  ReviewStrategy,
  TestAnswerOutcome,
  TestAttemptState,
  TestDefinitionState,
  TestSourceKind,
} from './enums';

export const COVERAGE_STATE_VALUES: readonly CoverageState[] = [
  'not_started',
  'in_progress',
  'covered',
  'needs_review',
] as const;

export const QUESTION_TYPE_VALUES: readonly QuestionType[] = [
  'single_mcq',
  'multi_mcq',
  'numerical',
  'short_answer',
  'true_false',
  'assertion_reason',
  'comprehension',
] as const;

export const DIFFICULTY_VALUES: readonly Difficulty[] = [
  'easy',
  'medium',
  'hard',
  'olympiad',
] as const;

export const ERROR_ENTRY_STATUS_VALUES: readonly ErrorEntryStatus[] = [
  'active',
  'in_review',
  'resolved',
  'reopened',
  'archived',
] as const;

export const MISTAKE_TYPE_VALUES: readonly MistakeType[] = [
  'concept',
  'calculation',
  'misread',
  'time_pressure',
  'careless',
  'method',
  'unknown',
] as const;

export const REVIEW_STATE_VALUES: readonly ReviewState[] = [
  'scheduled',
  'due',
  'in_progress',
  'completed',
  'skipped',
  'missed',
] as const;

export const REVIEW_OUTCOME_VALUES: readonly ReviewOutcome[] = [
  'correct',
  'incorrect',
  'partial',
] as const;

export const REVIEW_STRATEGY_VALUES: readonly ReviewStrategy[] = [
  'standard',
  'spaced',
  'focused',
  'retest_only',
] as const;

export const REVIEW_ATTEMPT_OUTCOME_VALUES: readonly ReviewAttemptOutcome[] = [
  'correct',
  'incorrect',
  'partial',
] as const;

export const TEST_SOURCE_KIND_VALUES: readonly TestSourceKind[] = [
  'syllabus',
  'error_bank',
  'reviewed',
  'mixed',
  'manual',
  'captured',
] as const;

export const TEST_DEFINITION_STATE_VALUES: readonly TestDefinitionState[] = [
  'created',
  'in_progress',
  'completed',
  'abandoned',
  'expired',
] as const;

export const TEST_ATTEMPT_STATE_VALUES: readonly TestAttemptState[] = [
  'in_progress',
  'submitted',
  'timed_out',
  'abandoned',
] as const;

export const TEST_ANSWER_OUTCOME_VALUES: readonly TestAnswerOutcome[] = [
  'correct',
  'incorrect',
  'partial',
  'skipped',
] as const;

export const PLANNER_TASK_STATE_VALUES: readonly PlannerTaskState[] = [
  'planned',
  'in_progress',
  'completed',
  'partial',
  'missed',
  'backlog',
  'cancelled',
] as const;

export const BACKLOG_REASON_VALUES: readonly BacklogReason[] = [
  'missed',
  'partial',
  'cancelled',
  'rescheduled',
] as const;

export const BACKLOG_STATE_VALUES: readonly BacklogState[] = [
  'open',
  'scheduled',
  'recovered',
  'dropped',
] as const;

export const BACKLOG_RECOVERY_STATE_VALUES: readonly BacklogRecoveryState[] = [
  'planned',
  'in_progress',
  'completed',
  'missed',
  'partial',
] as const;

export const NOTIFICATION_SEVERITY_VALUES: readonly NotificationSeverity[] = [
  'info',
  'success',
  'warning',
  'critical',
] as const;

export const NOTIFICATION_CHANNEL_VALUES: readonly NotificationChannel[] = [
  'in_app',
  'email',
  'push',
] as const;

export const NOTIFICATION_DELIVERY_STATE_VALUES: readonly NotificationDeliveryState[] = [
  'pending',
  'sent',
  'failed',
  'cancelled',
] as const;

export const AI_CONVERSATION_STATE_VALUES: readonly AiConversationState[] = [
  'active',
  'closed',
] as const;

export const AI_MESSAGE_ROLE_VALUES: readonly AiMessageRole[] = [
  'user',
  'assistant',
  'system',
  'tool',
] as const;

export const CAPTURED_QUESTION_STATE_VALUES: readonly CapturedQuestionState[] = [
  'captured',
  'linked',
  'rejected',
  'failed',
] as const;

// Phase 9 — error_evidence.classification_status (TRD §9).
export const CLASSIFICATION_STATUS_VALUES: readonly ClassificationStatus[] = [
  'pending',
  'suggested',
  'confirmed',
  'student_override',
] as const;

// Phase 9 — evidence_assets.status (TRD §10).
export const EVIDENCE_ASSET_STATUS_VALUES: readonly EvidenceAssetStatus[] = [
  'pending',
  'available',
  'failed',
  'deleted',
] as const;
