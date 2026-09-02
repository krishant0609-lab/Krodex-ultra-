/**
 * KRODEX API — request schemas.
 *
 * One zod schema per request. Routes import the schema they need
 * and feed it to `parseBody` / `parseQuery` / `parseParams`. The
 * schemas here are intentionally request-shaped (what the client
 * sends) — they are not the persisted row shape.
 *
 * Convention: every schema lives in a named export. Tests assert
 * the contract stays stable across releases.
 */

import { z } from 'zod';
import { Uuid, IsoDate, IsoTimestamp, CursorPagination, nonEmptyString, optionalString } from './primitives';

// --- user / profile ----------------------------------------------------

export const CreateUserBody = z.object({
  auth_user_id: nonEmptyString(128, 'auth_user_id'),
  email: z.string().trim().email('must be a valid email').max(254),
  display_name: nonEmptyString(80, 'display_name'),
  timezone: optionalString(64),
  locale: optionalString(16),
});
export type CreateUserBodyT = z.infer<typeof CreateUserBody>;

export const UpdateUserBody = z.object({
  display_name: optionalString(80),
  timezone: optionalString(64),
  locale: optionalString(16),
});
export type UpdateUserBodyT = z.infer<typeof UpdateUserBody>;

export const UpdateProfileBody = z.object({
  grade: optionalString(16),
  board: optionalString(64),
  exam_target: optionalString(128),
  study_goal: optionalString(512),
  preferred_subject_ids: z.array(Uuid).max(50).optional(),
  settings: z.record(z.unknown()).optional(),
});
export type UpdateProfileBodyT = z.infer<typeof UpdateProfileBody>;

// --- dev token mint (used in tests) ------------------------------------

export const MintDevTokenBody = z.object({
  user_id: Uuid,
  ttl_seconds: z.number().int().min(60).max(86_400).optional(),
  email: optionalString(254),
});
export type MintDevTokenBodyT = z.infer<typeof MintDevTokenBody>;

// --- syllabus tree (read-only, but listed endpoints take filters) ------

export const ListSubjectsQuery = z.object({});
export const ListTopicsQuery = z.object({
  subject_id: Uuid.optional(),
  parent_topic_id: Uuid.nullable().optional(),
});
export const ListSubTopicsQuery = z.object({
  topic_id: Uuid,
});
export const ListQuestionsQuery = z.object({
  subject_id: Uuid.optional(),
  topic_id: Uuid.optional(),
  sub_topic_id: Uuid.optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'olympiad']).optional(),
  type: z
    .enum([
      'single_mcq',
      'multi_mcq',
      'numerical',
      'short_answer',
      'true_false',
      'assertion_reason',
      'comprehension',
    ])
    .optional(),
  ...CursorPagination.shape,
});
export type ListQuestionsQueryT = z.infer<typeof ListQuestionsQuery>;

// --- syllabus progress (per-user) --------------------------------------

export const UpsertSyllabusProgressBody = z.object({
  scope: z.enum(['subject', 'topic', 'sub_topic', 'global']),
  scope_id: Uuid.nullable().optional(),
  coverage_state: z.enum(['not_started', 'in_progress', 'covered', 'needs_review']).optional(),
  last_activity_at: IsoTimestamp.nullable().optional(),
});
export type UpsertSyllabusProgressBodyT = z.infer<typeof UpsertSyllabusProgressBody>;

export const ListSyllabusProgressQuery = z.object({
  scope: z.enum(['subject', 'topic', 'sub_topic', 'global']).optional(),
  ...CursorPagination.shape,
});

// --- test definitions / attempts / answers ----------------------------

export const CreateTestDefinitionBody = z.object({
  title: nonEmptyString(200, 'title'),
  source_kind: z.enum(['syllabus', 'error_bank', 'reviewed', 'mixed', 'manual', 'captured']),
  source_payload: z.record(z.unknown()).default({}),
  intended_count: z.number().int().min(1).max(500),
  duration_minutes: z.number().int().min(1).max(600).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateTestDefinitionBodyT = z.infer<typeof CreateTestDefinitionBody>;

export const UpdateTestDefinitionBody = z.object({
  title: optionalString(200),
  duration_minutes: z.number().int().min(1).max(600).nullable().optional(),
  state: z.enum(['created', 'in_progress', 'completed', 'abandoned', 'expired']).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateTestDefinitionBodyT = z.infer<typeof UpdateTestDefinitionBody>;

export const AttachTestQuestionBody = z.object({
  question_id: Uuid,
  display_order: z.number().int().min(0).max(10_000),
});
export type AttachTestQuestionBodyT = z.infer<typeof AttachTestQuestionBody>;

export const StartTestAttemptBody = z.object({
  test_id: Uuid,
});
export type StartTestAttemptBodyT = z.infer<typeof StartTestAttemptBody>;

export const AnswerTestQuestionBody = z.object({
  question_id: Uuid,
  selected_option_ids: z.array(Uuid).max(20).default([]),
  free_text: optionalString(8_000),
  duration_ms: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable().optional(),
});
export type AnswerTestQuestionBodyT = z.infer<typeof AnswerTestQuestionBody>;

export const ListTestAttemptsQuery = z.object({
  test_id: Uuid.optional(),
  state: z.enum(['in_progress', 'submitted', 'timed_out', 'abandoned']).optional(),
  ...CursorPagination.shape,
});

export const ListTestDefinitionsQuery = z.object({
  state: z.enum(['created', 'in_progress', 'completed', 'abandoned', 'expired']).optional(),
  source_kind: z
    .enum(['syllabus', 'error_bank', 'reviewed', 'mixed', 'manual', 'captured'])
    .optional(),
  ...CursorPagination.shape,
});

// --- error bank --------------------------------------------------------

export const CreateErrorEntryBody = z.object({
  question_id: Uuid.nullable().optional(),
  mistake_type: z
    .enum(['concept', 'calculation', 'misread', 'time_pressure', 'careless', 'method', 'unknown'])
    .nullable()
    .optional(),
  remark: optionalString(2_000),
  source_attempt_id: Uuid.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateErrorEntryBodyT = z.infer<typeof CreateErrorEntryBody>;

export const UpdateErrorEntryBody = z.object({
  status: z
    .enum(['active', 'in_review', 'resolved', 'reopened', 'archived'])
    .optional(),
  mistake_type: z
    .enum(['concept', 'calculation', 'misread', 'time_pressure', 'careless', 'method', 'unknown'])
    .nullable()
    .optional(),
  remark: optionalString(2_000),
  recurrence_count: z.number().int().min(0).max(1_000).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateErrorEntryBodyT = z.infer<typeof UpdateErrorEntryBody>;

export const LinkErrorQuestionBody = z.object({
  question_id: Uuid,
});
export type LinkErrorQuestionBodyT = z.infer<typeof LinkErrorQuestionBody>;

export const ListErrorEntriesQuery = z.object({
  status: z.enum(['active', 'in_review', 'resolved', 'reopened', 'archived']).optional(),
  question_id: Uuid.optional(),
  ...CursorPagination.shape,
});

// --- review ------------------------------------------------------------

export const ScheduleReviewBody = z.object({
  error_id: Uuid,
  strategy: z.enum(['standard', 'spaced', 'focused', 'retest_only']).default('standard'),
  due_at: IsoTimestamp,
  metadata: z.record(z.unknown()).optional(),
});
export type ScheduleReviewBodyT = z.infer<typeof ScheduleReviewBody>;

export const UpdateReviewScheduleBody = z.object({
  state: z
    .enum(['scheduled', 'due', 'in_progress', 'completed', 'skipped', 'missed'])
    .optional(),
  due_at: IsoTimestamp.optional(),
  outcome: z.enum(['correct', 'incorrect', 'partial']).nullable().optional(),
  strategy: z.enum(['standard', 'spaced', 'focused', 'retest_only']).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateReviewScheduleBodyT = z.infer<typeof UpdateReviewScheduleBody>;

export const RecordReviewAttemptBody = z.object({
  schedule_id: Uuid,
  question_id: Uuid,
  outcome: z.enum(['correct', 'incorrect', 'partial']),
  selected_option_ids: z.array(Uuid).max(20).default([]),
  free_text: optionalString(8_000),
  duration_ms: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable().optional(),
});
export type RecordReviewAttemptBodyT = z.infer<typeof RecordReviewAttemptBody>;

export const ListReviewSchedulesQuery = z.object({
  state: z
    .enum(['scheduled', 'due', 'in_progress', 'completed', 'skipped', 'missed'])
    .optional(),
  due_before: IsoTimestamp.optional(),
  ...CursorPagination.shape,
});

// --- planner -----------------------------------------------------------

export const CreatePlannerTemplateBody = z.object({
  name: nonEmptyString(120, 'name'),
  is_default: z.boolean().optional(),
  template_payload: z.record(z.unknown()).default({}),
});
export type CreatePlannerTemplateBodyT = z.infer<typeof CreatePlannerTemplateBody>;

export const UpdatePlannerTemplateBody = z.object({
  name: optionalString(120),
  is_default: z.boolean().optional(),
  template_payload: z.record(z.unknown()).optional(),
});
export type UpdatePlannerTemplateBodyT = z.infer<typeof UpdatePlannerTemplateBody>;

export const CreatePlannerTaskBody = z.object({
  template_id: Uuid.nullable().optional(),
  plan_date: IsoDate,
  title: nonEmptyString(200, 'title'),
  description: optionalString(2_000),
  subject_id: Uuid.nullable().optional(),
  topic_id: Uuid.nullable().optional(),
  sub_topic_id: Uuid.nullable().optional(),
  planned_minutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreatePlannerTaskBodyT = z.infer<typeof CreatePlannerTaskBody>;

export const UpdatePlannerTaskBody = z.object({
  title: optionalString(200),
  description: optionalString(2_000),
  state: z
    .enum(['planned', 'in_progress', 'completed', 'partial', 'missed', 'backlog', 'cancelled'])
    .optional(),
  planned_minutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  actual_minutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  started_at: IsoTimestamp.nullable().optional(),
  completed_at: IsoTimestamp.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdatePlannerTaskBodyT = z.infer<typeof UpdatePlannerTaskBody>;

export const ListPlannerTasksQuery = z.object({
  state: z
    .enum(['planned', 'in_progress', 'completed', 'partial', 'missed', 'backlog', 'cancelled'])
    .optional(),
  plan_date: IsoDate.optional(),
  subject_id: Uuid.optional(),
  ...CursorPagination.shape,
});

// --- backlog -----------------------------------------------------------

export const RecoverBacklogItemBody = z.object({
  plan_date: IsoDate.optional(),
  notes: optionalString(2_000),
});
export type RecoverBacklogItemBodyT = z.infer<typeof RecoverBacklogItemBody>;

export const ListBacklogItemsQuery = z.object({
  state: z.enum(['open', 'scheduled', 'recovered', 'dropped']).optional(),
  reason: z.enum(['missed', 'partial', 'cancelled', 'rescheduled']).optional(),
  ...CursorPagination.shape,
});

// --- progress ----------------------------------------------------------

export const ListProgressEvidenceQuery = z.object({
  dimension: z
    .enum([
      'syllabus_coverage',
      'test_accuracy',
      'test_attempts',
      'errors_created',
      'errors_resolved',
      'errors_reopened',
      'review_completed',
      'planner_completion',
      'planner_backlog',
      'backlog_recovered',
      'consistency',
      'practice_volume',
      'other',
    ])
    .optional(),
  since: IsoTimestamp.optional(),
  until: IsoTimestamp.optional(),
  ...CursorPagination.shape,
});

// --- notifications -----------------------------------------------------

export const ListNotificationsQuery = z.object({
  unread_only: z.boolean().optional(),
  severity: z.enum(['info', 'success', 'warning', 'critical']).optional(),
  ...CursorPagination.shape,
});

export const UpdateNotificationBody = z.object({
  read: z.boolean().optional(),
  dismissed: z.boolean().optional(),
});
export type UpdateNotificationBodyT = z.infer<typeof UpdateNotificationBody>;

// --- common path params ------------------------------------------------

export const IdParam = z.object({
  id: Uuid,
});
export type IdParamT = z.infer<typeof IdParam>;

// --- Phase 4 analytics: dimension dashboard + explain + admin recompute ---

/**
 * The six PRD §24 metric keys (PHASE4_PLAN.md §12.1). Validated
 * as a zod enum so `GET /analytics/dashboards/dimension/:key`
 * returns 400 for unknown keys (Class A — derived from PRD §24).
 */
export const DimensionKeyParam = z.object({
  key: z.enum([
    'test_completion',
    'error_capture',
    'review_completion',
    'correction_rate',
    'reopen_rate',
    'time_to_correction',
  ]),
});
export type DimensionKeyParamT = z.infer<typeof DimensionKeyParam>;

/**
 * Admin recompute body. The route is service-role only; this
 * schema validates the *body* of the POST. `since` and `until`
 * bound the recompute window. The defaults are the trailing
 * 5 minutes (D-9, Class C — Approved Product Policy).
 */
export const AdminRecomputeBody = z.object({
  user_id: Uuid.optional(),
  since: IsoTimestamp.optional(),
  until: IsoTimestamp.optional(),
});
export type AdminRecomputeBodyT = z.infer<typeof AdminRecomputeBody>;

// --- Phase 5: student model ---

/**
 * `GET /student-model` query params.
 *
 * - `window_days` — evidence window length in days; defaults to
 *   28 (PRD §25 default). Clamped to [1, 90] by the service.
 *   The window is advisory for the read side: the snapshot is
 *   precomputed by the orchestrator and the route just returns
 *   the latest row.
 */
export const GetStudentModelQuery = z.object({
  window_days: z.coerce.number().int().min(1).max(90).optional(),
});
export type GetStudentModelQueryT = z.infer<typeof GetStudentModelQuery>;

/**
 * `POST /student-model/admin/recompute` body.
 *
 * - `user_id` — required; the user to recompute. Batch
 *   recompute is owned by the scheduled job; the admin route
 *   refuses it so operators don't accidentally bypass the
 *   5-minute cadence.
 * - `window_days` — evidence window length in days; defaults
 *   to 28. Clamped to [1, 90] by the service.
 */
export const AdminStudentModelRecomputeBody = z.object({
  user_id: Uuid,
  window_days: z.coerce.number().int().min(1).max(90).optional(),
});
export type AdminStudentModelRecomputeBodyT = z.infer<typeof AdminStudentModelRecomputeBody>;
