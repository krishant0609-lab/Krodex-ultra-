/**
 * KRODEX — string-union enum types mirroring Postgres CHECK constraints.
 *
 * These MUST stay in lockstep with the CHECK constraints in
 * supabase/migrations/20260901164346_03_core_schema.sql. When the
 * SQL check is updated, update the matching union here in the same
 * commit.
 *
 * Phase 1: a hand-written list. Phase 5+ will consider generating
 * these from the live schema, but for now the hand-list is the
 * single source of truth on the TS side.
 */

// --- syllabus_progress.coverage_state
export type CoverageState =
  | 'not_started'
  | 'in_progress'
  | 'covered'
  | 'needs_review';

// --- questions.question_type
export type QuestionType =
  | 'single_mcq'
  | 'multi_mcq'
  | 'numerical'
  | 'short_answer'
  | 'true_false'
  | 'assertion_reason'
  | 'comprehension';

// --- questions.difficulty
export type Difficulty = 'easy' | 'medium' | 'hard' | 'olympiad';

// --- error_entries.status
export type ErrorEntryStatus =
  | 'active'
  | 'in_review'
  | 'resolved'
  | 'reopened'
  | 'archived';

// --- error_entries.mistake_type
// Free-form text in the schema; we constrain to a documented set.
export type MistakeType =
  | 'concept'
  | 'calculation'
  | 'misread'
  | 'time_pressure'
  | 'careless'
  | 'method'
  | 'unknown';

// --- review_schedules.state
export type ReviewState =
  | 'scheduled'
  | 'due'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'missed';

// --- review_schedules.outcome
export type ReviewOutcome = 'correct' | 'incorrect' | 'partial';

// --- review_schedules.strategy
export type ReviewStrategy = 'standard' | 'spaced' | 'focused' | 'retest_only';

// --- review_attempts.outcome
// (same as ReviewOutcome but kept distinct because the two columns
// have slightly different semantics)
export type ReviewAttemptOutcome = 'correct' | 'incorrect' | 'partial';

// --- test_definitions.source_kind
export type TestSourceKind =
  | 'syllabus'
  | 'error_bank'
  | 'reviewed'
  | 'mixed'
  | 'manual'
  | 'captured';

// --- test_definitions.state
export type TestDefinitionState = 'created' | 'in_progress' | 'completed' | 'abandoned' | 'expired';

// --- test_attempts.state
export type TestAttemptState = 'in_progress' | 'submitted' | 'timed_out' | 'abandoned';

// --- test_answers.outcome
export type TestAnswerOutcome = 'correct' | 'incorrect' | 'partial' | 'skipped';

// --- planner_tasks.state
export type PlannerTaskState =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'partial'
  | 'missed'
  | 'backlog'
  | 'cancelled';

// --- backlog_items.reason
export type BacklogReason = 'missed' | 'partial' | 'cancelled' | 'rescheduled';

// --- backlog_items.state
export type BacklogState = 'open' | 'scheduled' | 'recovered' | 'dropped';

// --- backlog_recoveries.state
export type BacklogRecoveryState =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'partial';

// --- notifications.severity
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

// --- notification_deliveries.channel
export type NotificationChannel = 'in_app' | 'email' | 'push';

// --- notification_deliveries.state
export type NotificationDeliveryState = 'pending' | 'sent' | 'failed' | 'cancelled';

// --- ai_conversations.state
export type AiConversationState = 'active' | 'closed';

// --- ai_messages.role
export type AiMessageRole = 'user' | 'assistant' | 'system' | 'tool';

// --- captured_questions.state
export type CapturedQuestionState = 'captured' | 'linked' | 'rejected' | 'failed';

// --- progress_evidence.dimension (exemplar; not CHECK-constrained in SQL yet)
export type ProgressDimension =
  | 'syllabus_coverage'
  | 'test_accuracy'
  | 'test_attempts'
  | 'errors_created'
  | 'errors_resolved'
  | 'errors_reopened'
  | 'review_completed'
  | 'planner_completion'
  | 'planner_backlog'
  | 'backlog_recovered'
  | 'consistency'
  | 'practice_volume'
  | 'other';

// --- progress_snapshots.scope
export type ProgressScope = 'subject' | 'topic' | 'sub_topic' | 'global';
