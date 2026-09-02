/**
 * KRODEX — row interfaces for every Phase 1 table.
 *
 * These mirror the column lists in
 * supabase/migrations/20260901164346_03_core_schema.sql. They are
 * hand-written for Phase 1; a future phase will generate them from
 * the live schema. When the SQL changes, update the matching
 * interface here in the same commit.
 *
 * Conventions:
 *  - All ids are uuid (string in TS; the @supabase/supabase-js v2
 *    runtime keeps them as strings on the client).
 *  - Timestamps are stored as Postgres `timestamptz`. We model them
 *    as ISO 8601 strings (e.g. "2026-09-01T16:00:00.000Z") because
 *    that is what Supabase returns over the wire. Convert with
 *    `new Date(row.created_at)` when a Date is required.
 *  - `numeric(p, s)` is returned as a string by Supabase to preserve
 *    precision; we keep that as `string` here.
 *  - `jsonb` is `Json` (a recursive JSON value).
 *  - `text[]` / `uuid[]` are returned as readonly arrays.
 *  - `citext` is treated as a case-insensitive string in TS (no
 *    special type — Postgres handles case folding).
 */

import type {
  AiConversationState,
  AiMessageRole,
  BacklogReason,
  BacklogRecoveryState,
  BacklogState,
  CapturedQuestionState,
  CoverageState,
  Difficulty,
  ErrorEntryStatus,
  MistakeType,
  NotificationChannel,
  NotificationDeliveryState,
  NotificationSeverity,
  PlannerTaskState,
  ProgressDimension,
  ProgressScope,
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

/** A JSON value: object | array | string | number | boolean | null. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** ISO 8601 timestamp string (what Supabase returns for timestamptz). */
export type IsoTimestamp = string;

/** Postgres numeric is serialized as a string to preserve precision. */
export type PgNumeric = string;

/** date column ("YYYY-MM-DD"). */
export type IsoDate = string;

// -------------------------------------------------------------
// users / profiles
// -------------------------------------------------------------

/** public.users — one row per KRODEX user. */
export interface UserRow {
  id: string;
  auth_user_id: string;
  email: string;
  display_name: string;
  timezone: string;
  locale: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Insert shape for public.users. */
export interface UserInsert {
  id?: string;
  auth_user_id: string;
  email: string;
  display_name: string;
  timezone?: string;
  locale?: string;
}

/** Update shape for public.users. */
export interface UserUpdate {
  email?: string;
  display_name?: string;
  timezone?: string;
  locale?: string;
}

/** public.profiles — KRODEX-specific profile metadata, one per user. */
export interface ProfileRow {
  id: string;
  user_id: string;
  grade: string | null;
  board: string | null;
  exam_target: string | null;
  study_goal: string | null;
  preferred_subject_ids: readonly string[];
  settings: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ProfileInsert {
  id?: string;
  user_id: string;
  grade?: string | null;
  board?: string | null;
  exam_target?: string | null;
  study_goal?: string | null;
  preferred_subject_ids?: readonly string[];
  settings?: Json;
}

export interface ProfileUpdate {
  grade?: string | null;
  board?: string | null;
  exam_target?: string | null;
  study_goal?: string | null;
  preferred_subject_ids?: readonly string[];
  settings?: Json;
}

// -------------------------------------------------------------
// syllabus tree (global)
// -------------------------------------------------------------

/** public.subjects — global, not user-scoped. */
export interface SubjectRow {
  id: string;
  code: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface SubjectInsert {
  id?: string;
  code: string;
  name: string;
  display_order?: number;
  is_active?: boolean;
}

export interface SubjectUpdate {
  name?: string;
  display_order?: number;
  is_active?: boolean;
}

/** public.topics — global, parented to a subject. */
export interface TopicRow {
  id: string;
  subject_id: string;
  parent_topic_id: string | null;
  code: string;
  name: string;
  display_order: number;
  syllabus_scope: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface TopicInsert {
  id?: string;
  subject_id: string;
  parent_topic_id?: string | null;
  code: string;
  name: string;
  display_order?: number;
  syllabus_scope?: string | null;
}

export interface TopicUpdate {
  parent_topic_id?: string | null;
  name?: string;
  display_order?: number;
  syllabus_scope?: string | null;
}

/** public.sub_topics — global, parented to a topic. */
export interface SubTopicRow {
  id: string;
  topic_id: string;
  code: string;
  name: string;
  display_order: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface SubTopicInsert {
  id?: string;
  topic_id: string;
  code: string;
  name: string;
  display_order?: number;
}

export interface SubTopicUpdate {
  name?: string;
  display_order?: number;
}

// -------------------------------------------------------------
// syllabus progress (per-user)
// -------------------------------------------------------------

export interface SyllabusProgressRow {
  id: string;
  user_id: string;
  scope: ProgressScope;
  scope_id: string;
  coverage_state: CoverageState;
  evidence_count: number;
  last_activity_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface SyllabusProgressInsert {
  id?: string;
  user_id: string;
  scope: ProgressScope;
  scope_id: string;
  coverage_state?: CoverageState;
  evidence_count?: number;
  last_activity_at?: IsoTimestamp | null;
}

export interface SyllabusProgressUpdate {
  coverage_state?: CoverageState;
  evidence_count?: number;
  last_activity_at?: IsoTimestamp | null;
}

// -------------------------------------------------------------
// question bank (global)
// -------------------------------------------------------------

export interface QuestionRow {
  id: string;
  subject_id: string;
  topic_id: string | null;
  sub_topic_id: string | null;
  question_type: QuestionType;
  difficulty: Difficulty;
  prompt: string;
  explanation: string | null;
  source: string | null;
  source_year: number | null;
  marks_correct: PgNumeric;
  marks_incorrect: PgNumeric;
  metadata: Json;
  is_active: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface QuestionInsert {
  id?: string;
  subject_id: string;
  topic_id?: string | null;
  sub_topic_id?: string | null;
  question_type: QuestionType;
  difficulty: Difficulty;
  prompt: string;
  explanation?: string | null;
  source?: string | null;
  source_year?: number | null;
  marks_correct?: PgNumeric;
  marks_incorrect?: PgNumeric;
  metadata?: Json;
  is_active?: boolean;
}

export interface QuestionUpdate {
  topic_id?: string | null;
  sub_topic_id?: string | null;
  prompt?: string;
  explanation?: string | null;
  source?: string | null;
  source_year?: number | null;
  marks_correct?: PgNumeric;
  marks_incorrect?: PgNumeric;
  metadata?: Json;
  is_active?: boolean;
}

export interface QuestionOptionRow {
  id: string;
  question_id: string;
  display_order: number;
  body: string;
  is_correct: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface QuestionOptionInsert {
  id?: string;
  question_id: string;
  display_order: number;
  body: string;
  is_correct?: boolean;
}

export interface QuestionOptionUpdate {
  body?: string;
  is_correct?: boolean;
}

// -------------------------------------------------------------
// error bank (per-user)
// -------------------------------------------------------------

export interface ErrorEntryRow {
  id: string;
  user_id: string;
  question_id: string | null;
  status: ErrorEntryStatus;
  mistake_type: MistakeType | null;
  remark: string | null;
  source_attempt_id: string | null;
  first_seen_at: IsoTimestamp;
  last_seen_at: IsoTimestamp;
  resolved_at: IsoTimestamp | null;
  recurrence_count: number;
  metadata: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ErrorEntryInsert {
  id?: string;
  user_id: string;
  question_id?: string | null;
  status?: ErrorEntryStatus;
  mistake_type?: MistakeType | null;
  remark?: string | null;
  source_attempt_id?: string | null;
  first_seen_at?: IsoTimestamp;
  last_seen_at?: IsoTimestamp;
  resolved_at?: IsoTimestamp | null;
  recurrence_count?: number;
  metadata?: Json;
}

export interface ErrorEntryUpdate {
  status?: ErrorEntryStatus;
  mistake_type?: MistakeType | null;
  remark?: string | null;
  last_seen_at?: IsoTimestamp;
  resolved_at?: IsoTimestamp | null;
  recurrence_count?: number;
  metadata?: Json;
}

export interface ErrorQuestionLinkRow {
  id: string;
  error_id: string;
  question_id: string;
  user_id: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ErrorQuestionLinkInsert {
  id?: string;
  error_id: string;
  question_id: string;
  user_id: string;
}

// -------------------------------------------------------------
// review (per-user)
// -------------------------------------------------------------

export interface ReviewScheduleRow {
  id: string;
  user_id: string;
  error_id: string;
  state: ReviewState;
  due_at: IsoTimestamp;
  scheduled_at: IsoTimestamp;
  completed_at: IsoTimestamp | null;
  outcome: ReviewOutcome | null;
  strategy: ReviewStrategy;
  metadata: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ReviewScheduleInsert {
  id?: string;
  user_id: string;
  error_id: string;
  state?: ReviewState;
  due_at: IsoTimestamp;
  scheduled_at?: IsoTimestamp;
  completed_at?: IsoTimestamp | null;
  outcome?: ReviewOutcome | null;
  strategy?: ReviewStrategy;
  metadata?: Json;
}

export interface ReviewScheduleUpdate {
  state?: ReviewState;
  due_at?: IsoTimestamp;
  completed_at?: IsoTimestamp | null;
  outcome?: ReviewOutcome | null;
  strategy?: ReviewStrategy;
  metadata?: Json;
}

export interface ReviewAttemptRow {
  id: string;
  user_id: string;
  schedule_id: string;
  question_id: string;
  outcome: ReviewAttemptOutcome;
  selected_option_ids: readonly string[];
  free_text: string | null;
  duration_ms: number | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ReviewAttemptInsert {
  id?: string;
  user_id: string;
  schedule_id: string;
  question_id: string;
  outcome: ReviewAttemptOutcome;
  selected_option_ids?: readonly string[];
  free_text?: string | null;
  duration_ms?: number | null;
}

// -------------------------------------------------------------
// tests (per-user)
// -------------------------------------------------------------

export interface TestDefinitionRow {
  id: string;
  user_id: string;
  title: string;
  source_kind: TestSourceKind;
  source_payload: Json;
  intended_count: number;
  duration_minutes: number | null;
  state: TestDefinitionState;
  metadata: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface TestDefinitionInsert {
  id?: string;
  user_id: string;
  title: string;
  source_kind: TestSourceKind;
  source_payload?: Json;
  intended_count: number;
  duration_minutes?: number | null;
  state?: TestDefinitionState;
  metadata?: Json;
}

export interface TestDefinitionUpdate {
  title?: string;
  source_kind?: TestSourceKind;
  source_payload?: Json;
  intended_count?: number;
  duration_minutes?: number | null;
  state?: TestDefinitionState;
  metadata?: Json;
}

export interface TestQuestionRow {
  id: string;
  user_id: string;
  test_id: string;
  question_id: string;
  display_order: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface TestQuestionInsert {
  id?: string;
  user_id: string;
  test_id: string;
  question_id: string;
  display_order: number;
}

export interface TestAttemptRow {
  id: string;
  user_id: string;
  test_id: string;
  state: TestAttemptState;
  started_at: IsoTimestamp;
  submitted_at: IsoTimestamp | null;
  total_questions: number;
  correct_count: number;
  incorrect_count: number;
  partial_count: number;
  skipped_count: number;
  accuracy: PgNumeric;
  duration_ms: number | null;
  metadata: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface TestAttemptInsert {
  id?: string;
  user_id: string;
  test_id: string;
  state?: TestAttemptState;
  started_at?: IsoTimestamp;
  submitted_at?: IsoTimestamp | null;
  total_questions: number;
  correct_count?: number;
  incorrect_count?: number;
  partial_count?: number;
  skipped_count?: number;
  accuracy?: PgNumeric;
  duration_ms?: number | null;
  metadata?: Json;
}

export interface TestAttemptUpdate {
  state?: TestAttemptState;
  submitted_at?: IsoTimestamp | null;
  correct_count?: number;
  incorrect_count?: number;
  partial_count?: number;
  skipped_count?: number;
  accuracy?: PgNumeric;
  duration_ms?: number | null;
  metadata?: Json;
}

export interface TestAnswerRow {
  id: string;
  user_id: string;
  attempt_id: string;
  question_id: string;
  selected_option_ids: readonly string[];
  free_text: string | null;
  outcome: TestAnswerOutcome | null;
  answered_at: IsoTimestamp;
  duration_ms: number | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface TestAnswerInsert {
  id?: string;
  user_id: string;
  attempt_id: string;
  question_id: string;
  selected_option_ids?: readonly string[];
  free_text?: string | null;
  outcome?: TestAnswerOutcome | null;
  answered_at?: IsoTimestamp;
  duration_ms?: number | null;
}

export interface TestAnswerUpdate {
  selected_option_ids?: readonly string[];
  free_text?: string | null;
  outcome?: TestAnswerOutcome | null;
  duration_ms?: number | null;
}

// -------------------------------------------------------------
// planner (per-user)
// -------------------------------------------------------------

export interface PlannerTemplateRow {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean;
  template_payload: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PlannerTemplateInsert {
  id?: string;
  user_id: string;
  name: string;
  is_default?: boolean;
  template_payload?: Json;
}

export interface PlannerTemplateUpdate {
  name?: string;
  is_default?: boolean;
  template_payload?: Json;
}

export interface PlannerTaskRow {
  id: string;
  user_id: string;
  template_id: string | null;
  plan_date: IsoDate;
  title: string;
  description: string | null;
  state: PlannerTaskState;
  subject_id: string | null;
  topic_id: string | null;
  sub_topic_id: string | null;
  planned_minutes: number | null;
  actual_minutes: number | null;
  started_at: IsoTimestamp | null;
  completed_at: IsoTimestamp | null;
  metadata: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface PlannerTaskInsert {
  id?: string;
  user_id: string;
  template_id?: string | null;
  plan_date: IsoDate;
  title: string;
  description?: string | null;
  state?: PlannerTaskState;
  subject_id?: string | null;
  topic_id?: string | null;
  sub_topic_id?: string | null;
  planned_minutes?: number | null;
  actual_minutes?: number | null;
  started_at?: IsoTimestamp | null;
  completed_at?: IsoTimestamp | null;
  metadata?: Json;
}

export interface PlannerTaskUpdate {
  title?: string;
  description?: string | null;
  state?: PlannerTaskState;
  subject_id?: string | null;
  topic_id?: string | null;
  sub_topic_id?: string | null;
  planned_minutes?: number | null;
  actual_minutes?: number | null;
  started_at?: IsoTimestamp | null;
  completed_at?: IsoTimestamp | null;
  metadata?: Json;
}

// -------------------------------------------------------------
// backlog (per-user)
// -------------------------------------------------------------

export interface BacklogItemRow {
  id: string;
  user_id: string;
  source_task_id: string;
  reason: BacklogReason;
  state: BacklogState;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface BacklogItemInsert {
  id?: string;
  user_id: string;
  source_task_id: string;
  reason: BacklogReason;
  state?: BacklogState;
}

export interface BacklogItemUpdate {
  state?: BacklogState;
}

export interface BacklogRecoveryRow {
  id: string;
  user_id: string;
  backlog_item_id: string;
  recovered_task_id: string | null;
  state: BacklogRecoveryState;
  notes: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface BacklogRecoveryInsert {
  id?: string;
  user_id: string;
  backlog_item_id: string;
  recovered_task_id?: string | null;
  state: BacklogRecoveryState;
  notes?: string | null;
}

export interface BacklogRecoveryUpdate {
  recovered_task_id?: string | null;
  state?: BacklogRecoveryState;
  notes?: string | null;
}

// -------------------------------------------------------------
// notifications (per-user)
// -------------------------------------------------------------

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  payload: Json;
  read_at: IsoTimestamp | null;
  dismissed_at: IsoTimestamp | null;
  expires_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface NotificationInsert {
  id?: string;
  user_id: string;
  kind: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  payload?: Json;
  read_at?: IsoTimestamp | null;
  dismissed_at?: IsoTimestamp | null;
  expires_at?: IsoTimestamp | null;
}

export interface NotificationUpdate {
  severity?: NotificationSeverity;
  title?: string;
  body?: string | null;
  payload?: Json;
  read_at?: IsoTimestamp | null;
  dismissed_at?: IsoTimestamp | null;
  expires_at?: IsoTimestamp | null;
}

export interface NotificationDeliveryRow {
  id: string;
  user_id: string;
  notification_id: string;
  channel: NotificationChannel;
  state: NotificationDeliveryState;
  attempt_count: number;
  last_error: string | null;
  sent_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface NotificationDeliveryInsert {
  id?: string;
  user_id: string;
  notification_id: string;
  channel: NotificationChannel;
  state?: NotificationDeliveryState;
  attempt_count?: number;
  last_error?: string | null;
  sent_at?: IsoTimestamp | null;
}

export interface NotificationDeliveryUpdate {
  state?: NotificationDeliveryState;
  attempt_count?: number;
  last_error?: string | null;
  sent_at?: IsoTimestamp | null;
}

// -------------------------------------------------------------
// AI (per-user)
// -------------------------------------------------------------

export interface AiConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  context_kind: string | null;
  context_ref: Json;
  state: AiConversationState;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface AiConversationInsert {
  id?: string;
  user_id: string;
  title?: string | null;
  context_kind?: string | null;
  context_ref?: Json;
  state?: AiConversationState;
}

export interface AiConversationUpdate {
  title?: string | null;
  context_kind?: string | null;
  context_ref?: Json;
  state?: AiConversationState;
}

export interface AiMessageRow {
  id: string;
  user_id: string;
  conversation_id: string;
  role: AiMessageRole;
  content: string;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
  grounded_in: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface AiMessageInsert {
  id?: string;
  user_id: string;
  conversation_id: string;
  role: AiMessageRole;
  content: string;
  tokens_in?: number | null;
  tokens_out?: number | null;
  model?: string | null;
  grounded_in?: Json;
}

// -------------------------------------------------------------
// capture (sources are global; questions are per-user)
// -------------------------------------------------------------

export interface CaptureSourceRow {
  id: string;
  code: string;
  display_name: string;
  is_active: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface CaptureSourceInsert {
  id?: string;
  code: string;
  display_name: string;
  is_active?: boolean;
}

export interface CaptureSourceUpdate {
  display_name?: string;
  is_active?: boolean;
}

export interface CapturedQuestionRow {
  id: string;
  user_id: string;
  source_id: string;
  external_ref: string | null;
  raw_payload: Json;
  prompt: string;
  detected_options: Json | null;
  state: CapturedQuestionState;
  linked_question_id: string | null;
  captured_at: IsoTimestamp;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface CapturedQuestionInsert {
  id?: string;
  user_id: string;
  source_id: string;
  external_ref?: string | null;
  raw_payload?: Json;
  prompt: string;
  detected_options?: Json | null;
  state?: CapturedQuestionState;
  linked_question_id?: string | null;
  captured_at?: IsoTimestamp;
}

export interface CapturedQuestionUpdate {
  detected_options?: Json | null;
  state?: CapturedQuestionState;
  linked_question_id?: string | null;
}

export interface QuestionSnapshotRow {
  id: string;
  user_id: string;
  captured_question_id: string | null;
  error_entry_id: string | null;
  storage_path: string;
  mime_type: string;
  byte_size: string; // bigint -> string in Supabase
  sha256: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface QuestionSnapshotInsert {
  id?: string;
  user_id: string;
  captured_question_id?: string | null;
  error_entry_id?: string | null;
  storage_path: string;
  mime_type: string;
  byte_size: string | number;
  sha256?: string | null;
}

// -------------------------------------------------------------
// progress + student model (per-user)
// -------------------------------------------------------------

export interface ProgressEvidenceRow {
  id: string;
  user_id: string;
  dimension: ProgressDimension;
  delta: PgNumeric;
  ref_kind: string;
  ref_id: string;
  captured_at: IsoTimestamp;
  metadata: Json;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ProgressEvidenceInsert {
  id?: string;
  user_id: string;
  dimension: ProgressDimension;
  delta: PgNumeric;
  ref_kind: string;
  ref_id: string;
  captured_at?: IsoTimestamp;
  metadata?: Json;
}

export interface ProgressSnapshotRow {
  id: string;
  user_id: string;
  scope: ProgressScope;
  scope_id: string | null;
  metrics: Json;
  computed_at: IsoTimestamp;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ProgressSnapshotInsert {
  id?: string;
  user_id: string;
  scope: ProgressScope;
  scope_id?: string | null;
  metrics?: Json;
  computed_at?: IsoTimestamp;
}

export interface StudentModelSnapshotRow {
  id: string;
  user_id: string;
  features: Json;
  confidence: PgNumeric;
  computed_at: IsoTimestamp;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface StudentModelSnapshotInsert {
  id?: string;
  user_id: string;
  features?: Json;
  confidence?: PgNumeric;
  computed_at?: IsoTimestamp;
}

export interface StudentModelFeatureRow {
  id: string;
  user_id: string;
  feature_key: string;
  feature_value: Json;
  evidence_count: number;
  computed_at: IsoTimestamp;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface StudentModelFeatureInsert {
  id?: string;
  user_id: string;
  feature_key: string;
  feature_value: Json;
  evidence_count?: number;
  computed_at?: IsoTimestamp;
}

export interface StudentModelFeatureUpdate {
  feature_value?: Json;
  evidence_count?: number;
}

// ---------------------------------------------------------------------------
// Phase 5 — Student Model Inference types (PRD §25)
//
// The student model is computed in TypeScript (pattern modules in
// apps/api/src/student-model/patterns/*) and persisted as one
// row per user in `student_model_snapshots` (features jsonb blob +
// confidence numeric) plus one row per feature key in
// `student_model_features`. The shapes below are the wire/payload
// contract; the row types above are the storage mirror.
// ---------------------------------------------------------------------------

/**
 * Canonical feature keys produced by Phase 5. The list is the
 * full PRD §25 surface; the SQL function, the API, and the
 * snapshot payload all key on exactly these eight names. A new
 * pattern module is non-conformant unless its key appears here.
 */
export type StudentModelFeatureKey =
  | 'consistency_score'
  | 'procrastination_score'
  | 'recovery_score'
  | 'error_recurrence_score'
  | 'review_compliance_score'
  | 'workload_pressure_score'
  | 'learning_trajectory'
  | 'overall_confidence';

/**
 * Single-feature output envelope. The score is the 0..1
 * deterministic value; direction is a half-vs-half trend over
 * the window; confidence mirrors the D-2 ladder from
 * analytics/thresholds.ts; sampleSize is the raw count the
 * pattern module saw; evidenceWindowDays is the window the
 * module ran against (default 28, max 90).
 */
export interface StudentModelFeatureValue {
  score: number;
  direction: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  confidence: 'limited' | 'moderate' | 'strong';
  sampleSize: number;
  evidenceWindowDays: number;
}

/**
 * Full snapshot payload — what the API returns and what the
 * SQL function writes into `student_model_snapshots.features`.
 * The seven real pattern outputs are kept in `features`; the
 * top-level `overallConfidence` is the minimum confidence
 * across them, per PRD §25.
 */
export interface StudentModelSnapshotPayload {
  userId: string;
  computedAt: string;
  evidenceWindowDays: number;
  features: {
    consistency_score: StudentModelFeatureValue;
    procrastination_score: StudentModelFeatureValue;
    recovery_score: StudentModelFeatureValue;
    error_recurrence_score: StudentModelFeatureValue;
    review_compliance_score: StudentModelFeatureValue;
    workload_pressure_score: StudentModelFeatureValue;
    learning_trajectory: StudentModelFeatureValue;
  };
  overallConfidence: 'limited' | 'moderate' | 'strong';
}

/**
 * Per-feature persistence row mirror. The Phase 5 SQL function
 * writes one row per feature key per user; the API service
 * hydrates a `StudentModelSnapshotPayload` from these rows.
 */
export interface StudentModelFeaturePersistenceRow {
  user_id: string;
  feature_key: StudentModelFeatureKey;
  feature_value: StudentModelFeatureValue;
  evidence_count: number;
  computed_at: IsoTimestamp;
}
