-- =============================================================
-- KRODEX — migration 03: core schema (all Phase 1 entities)
-- Phase 1 (Core Data Model + Persistence)
-- =============================================================
--
-- Source of truth: KRODEX_Schema_Ready_Specification_From_Scratch_v2 §4.
-- Every table includes id (uuid, default gen_random_uuid()),
-- created_at, updated_at, and where applicable user_id (FK to users.id).
-- updated_at is maintained by public.set_updated_at().
-- user_id is enforced non-null + immutable by prevent_user_id_mutation()
-- (see migration 02).
--
-- Tables intentionally NOT created here (deferred to later phases
-- per the Project Implementation Plan):
--   - analytics_materialized_views (Phase 4)
--   - scheduler_state (Phase 3)
--   - audit_log (Phase 9 / hardening)
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- USERS
-- -------------------------------------------------------------
-- One row per registered KRODEX user. The Supabase auth.users table
-- owns the password / OAuth linkage; this table owns KRODEX-specific
-- profile metadata.
create table if not exists public.users (
  id              uuid primary key default extensions.gen_random_uuid(),
  auth_user_id    uuid not null unique,                -- FK to auth.users in real Supabase
  email           citext not null unique,
  display_name    text not null check (char_length(display_name) between 1 and 80),
  timezone        text not null default 'UTC',
  locale          text not null default 'en',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- PROFILES
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null unique references public.users(id) on delete cascade,
  grade           text,                                -- e.g. "Class 10", "Year 12"
  board           text,                                -- e.g. "CBSE", "ICSE", "IB"
  exam_target     text,                                -- e.g. "JEE Main 2027"
  study_goal      text,                                -- free-form
  preferred_subject_ids uuid[] not null default '{}',
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_profiles_user_id on public.profiles(user_id);
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists trg_profiles_user_id_immutable on public.profiles;
create trigger trg_profiles_user_id_immutable before update on public.profiles
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- SYLLABUS (Subject -> Topic -> SubTopic tree)
-- -------------------------------------------------------------
create table if not exists public.subjects (
  id              uuid primary key default extensions.gen_random_uuid(),
  -- Subjects are global (shared across users). Not user-scoped.
  code            text not null unique,                -- e.g. "MATH", "PHYS"
  name            text not null,
  display_order   int  not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_subjects_updated_at on public.subjects;
create trigger trg_subjects_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();

create table if not exists public.topics (
  id              uuid primary key default extensions.gen_random_uuid(),
  subject_id      uuid not null references public.subjects(id) on delete restrict,
  parent_topic_id uuid references public.topics(id) on delete set null,
  code            text not null,
  name            text not null,
  display_order   int  not null default 0,
  syllabus_scope  text,                                -- e.g. "CBSE-2025"
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (subject_id, code)
);
create index if not exists idx_topics_subject_id on public.topics(subject_id);
create index if not exists idx_topics_parent_topic_id on public.topics(parent_topic_id);
drop trigger if exists trg_topics_updated_at on public.topics;
create trigger trg_topics_updated_at before update on public.topics
  for each row execute function public.set_updated_at();

create table if not exists public.sub_topics (
  id              uuid primary key default extensions.gen_random_uuid(),
  topic_id        uuid not null references public.topics(id) on delete cascade,
  code            text not null,
  name            text not null,
  display_order   int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (topic_id, code)
);
create index if not exists idx_sub_topics_topic_id on public.sub_topics(topic_id);
drop trigger if exists trg_sub_topics_updated_at on public.sub_topics;
create trigger trg_sub_topics_updated_at before update on public.sub_topics
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- SYLLABUS PROGRESS (per-user coverage of the syllabus tree)
-- -------------------------------------------------------------
create table if not exists public.syllabus_progress (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  scope           text not null,                       -- "subject" | "topic" | "sub_topic"
  scope_id        uuid not null,                       -- references subjects.id | topics.id | sub_topics.id
  coverage_state  text not null default 'not_started'
                  check (coverage_state in ('not_started','in_progress','covered','needs_review')),
  evidence_count  int  not null default 0,
  last_activity_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_syllabus_progress_user on public.syllabus_progress(user_id);
create index if not exists idx_syllabus_progress_scope on public.syllabus_progress(user_id, scope, scope_id);
drop trigger if exists trg_syllabus_progress_updated_at on public.syllabus_progress;
create trigger trg_syllabus_progress_updated_at before update on public.syllabus_progress
  for each row execute function public.set_updated_at();
drop trigger if exists trg_syllabus_progress_user_id_immutable on public.syllabus_progress;
create trigger trg_syllabus_progress_user_id_immutable before update on public.syllabus_progress
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- QUESTIONS (the question bank)
-- -------------------------------------------------------------
create table if not exists public.questions (
  id              uuid primary key default extensions.gen_random_uuid(),
  -- Questions are global. Not user-scoped.
  subject_id      uuid not null references public.subjects(id) on delete restrict,
  topic_id        uuid references public.topics(id) on delete set null,
  sub_topic_id    uuid references public.sub_topics(id) on delete set null,
  question_type   text not null check (question_type in
                    ('single_mcq','multi_mcq','numerical','short_answer','true_false','assertion_reason','comprehension')),
  difficulty      text not null check (difficulty in ('easy','medium','hard','olympiad')),
  prompt          text not null,
  explanation     text,
  source          text,                                -- "JEE Main 2024 P1 Q12"
  source_year     int,
  marks_correct   numeric(6,2) not null default 1.0,
  marks_incorrect numeric(6,2) not null default 0.0,
  metadata        jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_questions_subject on public.questions(subject_id);
create index if not exists idx_questions_topic on public.questions(topic_id);
create index if not exists idx_questions_sub_topic on public.questions(sub_topic_id);
create index if not exists idx_questions_difficulty on public.questions(difficulty);
create index if not exists idx_questions_active on public.questions(is_active);
drop trigger if exists trg_questions_updated_at on public.questions;
create trigger trg_questions_updated_at before update on public.questions
  for each row execute function public.set_updated_at();

create table if not exists public.question_options (
  id              uuid primary key default extensions.gen_random_uuid(),
  question_id     uuid not null references public.questions(id) on delete cascade,
  display_order   int  not null,
  body            text not null,
  is_correct      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (question_id, display_order)
);
create index if not exists idx_question_options_question on public.question_options(question_id);
drop trigger if exists trg_question_options_updated_at on public.question_options;
create trigger trg_question_options_updated_at before update on public.question_options
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- ERROR ENTRIES (the Error Bank)
-- -------------------------------------------------------------
create table if not exists public.error_entries (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  question_id     uuid references public.questions(id) on delete set null,
  status          text not null default 'active'
                  check (status in ('active','in_review','resolved','reopened','archived')),
  mistake_type    text,                                -- "concept", "calculation", "misread", ...
  remark          text,
  source_attempt_id uuid,                              -- nullable FK set after attempts exist
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  resolved_at     timestamptz,
  recurrence_count int not null default 0,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_error_entries_user on public.error_entries(user_id);
create index if not exists idx_error_entries_status on public.error_entries(user_id, status);
create index if not exists idx_error_entries_question on public.error_entries(question_id);
drop trigger if exists trg_error_entries_updated_at on public.error_entries;
create trigger trg_error_entries_updated_at before update on public.error_entries
  for each row execute function public.set_updated_at();
drop trigger if exists trg_error_entries_user_id_immutable on public.error_entries;
create trigger trg_error_entries_user_id_immutable before update on public.error_entries
  for each row execute function public.prevent_user_id_mutation();

-- Linkage: an error can be associated with multiple questions (e.g.
-- multi-part question with one mistake spanning several items).
create table if not exists public.error_question_links (
  id              uuid primary key default extensions.gen_random_uuid(),
  error_id        uuid not null references public.error_entries(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (error_id, question_id)
);
create index if not exists idx_error_question_links_error on public.error_question_links(error_id);
create index if not exists idx_error_question_links_user on public.error_question_links(user_id);
drop trigger if exists trg_error_question_links_updated_at on public.error_question_links;
create trigger trg_error_question_links_updated_at before update on public.error_question_links
  for each row execute function public.set_updated_at();
drop trigger if exists trg_error_question_links_user_id_immutable on public.error_question_links;
create trigger trg_error_question_links_user_id_immutable before update on public.error_question_links
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- REVIEW (the Review lifecycle)
-- -------------------------------------------------------------
create table if not exists public.review_schedules (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  error_id        uuid not null references public.error_entries(id) on delete cascade,
  state           text not null default 'scheduled'
                  check (state in ('scheduled','due','in_progress','completed','skipped','missed')),
  due_at          timestamptz not null,
  scheduled_at    timestamptz not null default now(),
  completed_at    timestamptz,
  outcome         text check (outcome in ('correct','incorrect','partial') or outcome is null),
  strategy        text not null default 'standard'
                  check (strategy in ('standard','spaced','focused','retest_only')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_review_schedules_user_due on public.review_schedules(user_id, due_at);
create index if not exists idx_review_schedules_state on public.review_schedules(user_id, state);
create index if not exists idx_review_schedules_error on public.review_schedules(error_id);
drop trigger if exists trg_review_schedules_updated_at on public.review_schedules;
create trigger trg_review_schedules_updated_at before update on public.review_schedules
  for each row execute function public.set_updated_at();
drop trigger if exists trg_review_schedules_user_id_immutable on public.review_schedules;
create trigger trg_review_schedules_user_id_immutable before update on public.review_schedules
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.review_attempts (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  schedule_id     uuid not null references public.review_schedules(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete restrict,
  outcome         text not null check (outcome in ('correct','incorrect','partial')),
  selected_option_ids uuid[] not null default '{}',
  free_text       text,
  duration_ms     int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_review_attempts_user on public.review_attempts(user_id);
create index if not exists idx_review_attempts_schedule on public.review_attempts(schedule_id);
drop trigger if exists trg_review_attempts_updated_at on public.review_attempts;
create trigger trg_review_attempts_updated_at before update on public.review_attempts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_review_attempts_user_id_immutable on public.review_attempts;
create trigger trg_review_attempts_user_id_immutable before update on public.review_attempts
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- TESTS (custom Test system)
-- -------------------------------------------------------------
create table if not exists public.test_definitions (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  title           text not null,
  source_kind     text not null check (source_kind in
                    ('syllabus','error_bank','reviewed','mixed','manual','captured')),
  source_payload  jsonb not null default '{}'::jsonb,  -- selection criteria (topic ids, error ids, etc.)
  intended_count  int  not null check (intended_count between 1 and 500),
  duration_minutes int,                                -- nullable
  state           text not null default 'created'
                  check (state in ('created','in_progress','completed','abandoned','expired')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_test_definitions_user on public.test_definitions(user_id);
create index if not exists idx_test_definitions_state on public.test_definitions(user_id, state);
drop trigger if exists trg_test_definitions_updated_at on public.test_definitions;
create trigger trg_test_definitions_updated_at before update on public.test_definitions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_test_definitions_user_id_immutable on public.test_definitions;
create trigger trg_test_definitions_user_id_immutable before update on public.test_definitions
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.test_questions (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  test_id         uuid not null references public.test_definitions(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete restrict,
  display_order   int  not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (test_id, display_order)
);
create index if not exists idx_test_questions_test on public.test_questions(test_id);
create index if not exists idx_test_questions_user on public.test_questions(user_id);
drop trigger if exists trg_test_questions_updated_at on public.test_questions;
create trigger trg_test_questions_updated_at before update on public.test_questions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_test_questions_user_id_immutable on public.test_questions;
create trigger trg_test_questions_user_id_immutable before update on public.test_questions
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.test_attempts (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  test_id         uuid not null references public.test_definitions(id) on delete cascade,
  state           text not null default 'in_progress'
                  check (state in ('in_progress','submitted','timed_out','abandoned')),
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  total_questions int  not null,
  correct_count   int  not null default 0,
  incorrect_count int  not null default 0,
  partial_count   int  not null default 0,
  skipped_count   int  not null default 0,
  accuracy        numeric(5,4) not null default 0.0,   -- 0.0000 - 1.0000
  duration_ms     int,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_test_attempts_user on public.test_attempts(user_id);
create index if not exists idx_test_attempts_test on public.test_attempts(test_id);
create index if not exists idx_test_attempts_state on public.test_attempts(user_id, state);
drop trigger if exists trg_test_attempts_updated_at on public.test_attempts;
create trigger trg_test_attempts_updated_at before update on public.test_attempts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_test_attempts_user_id_immutable on public.test_attempts;
create trigger trg_test_attempts_user_id_immutable before update on public.test_attempts
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.test_answers (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  attempt_id      uuid not null references public.test_attempts(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete restrict,
  selected_option_ids uuid[] not null default '{}',
  free_text       text,
  outcome         text check (outcome in ('correct','incorrect','partial','skipped') or outcome is null),
  answered_at     timestamptz not null default now(),
  duration_ms     int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index if not exists idx_test_answers_user on public.test_answers(user_id);
create index if not exists idx_test_answers_attempt on public.test_answers(attempt_id);
drop trigger if exists trg_test_answers_updated_at on public.test_answers;
create trigger trg_test_answers_updated_at before update on public.test_answers
  for each row execute function public.set_updated_at();
drop trigger if exists trg_test_answers_user_id_immutable on public.test_answers;
create trigger trg_test_answers_user_id_immutable before update on public.test_answers
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- PLANNER
-- -------------------------------------------------------------
create table if not exists public.planner_templates (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  name            text not null,
  is_default      boolean not null default false,
  template_payload jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_planner_templates_user on public.planner_templates(user_id);
drop trigger if exists trg_planner_templates_updated_at on public.planner_templates;
create trigger trg_planner_templates_updated_at before update on public.planner_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_planner_templates_user_id_immutable on public.planner_templates;
create trigger trg_planner_templates_user_id_immutable before update on public.planner_templates
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.planner_tasks (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  template_id     uuid references public.planner_templates(id) on delete set null,
  plan_date       date not null,
  title           text not null,
  description     text,
  state           text not null default 'planned'
                  check (state in ('planned','in_progress','completed','partial','missed','backlog','cancelled')),
  subject_id      uuid references public.subjects(id) on delete set null,
  topic_id        uuid references public.topics(id) on delete set null,
  sub_topic_id    uuid references public.sub_topics(id) on delete set null,
  planned_minutes int,
  actual_minutes  int,
  started_at      timestamptz,
  completed_at    timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_planner_tasks_user_date on public.planner_tasks(user_id, plan_date);
create index if not exists idx_planner_tasks_state on public.planner_tasks(user_id, state);
create index if not exists idx_planner_tasks_subject on public.planner_tasks(user_id, subject_id);
drop trigger if exists trg_planner_tasks_updated_at on public.planner_tasks;
create trigger trg_planner_tasks_updated_at before update on public.planner_tasks
  for each row execute function public.set_updated_at();
drop trigger if exists trg_planner_tasks_user_id_immutable on public.planner_tasks;
create trigger trg_planner_tasks_user_id_immutable before update on public.planner_tasks
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- BACKLOG
-- -------------------------------------------------------------
create table if not exists public.backlog_items (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  source_task_id  uuid not null references public.planner_tasks(id) on delete cascade,
  reason          text not null check (reason in ('missed','partial','cancelled','rescheduled')),
  state           text not null default 'open'
                  check (state in ('open','scheduled','recovered','dropped')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_backlog_items_user on public.backlog_items(user_id);
create index if not exists idx_backlog_items_state on public.backlog_items(user_id, state);
create index if not exists idx_backlog_items_source on public.backlog_items(source_task_id);
drop trigger if exists trg_backlog_items_updated_at on public.backlog_items;
create trigger trg_backlog_items_updated_at before update on public.backlog_items
  for each row execute function public.set_updated_at();
drop trigger if exists trg_backlog_items_user_id_immutable on public.backlog_items;
create trigger trg_backlog_items_user_id_immutable before update on public.backlog_items
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.backlog_recoveries (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  backlog_item_id uuid not null references public.backlog_items(id) on delete cascade,
  recovered_task_id uuid references public.planner_tasks(id) on delete set null,
  state           text not null check (state in ('planned','in_progress','completed','missed','partial')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_backlog_recoveries_user on public.backlog_recoveries(user_id);
create index if not exists idx_backlog_recoveries_item on public.backlog_recoveries(backlog_item_id);
drop trigger if exists trg_backlog_recoveries_updated_at on public.backlog_recoveries;
create trigger trg_backlog_recoveries_updated_at before update on public.backlog_recoveries
  for each row execute function public.set_updated_at();
drop trigger if exists trg_backlog_recoveries_user_id_immutable on public.backlog_recoveries;
create trigger trg_backlog_recoveries_user_id_immutable before update on public.backlog_recoveries
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- NOTIFICATIONS
-- -------------------------------------------------------------
create table if not exists public.notifications (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  kind            text not null,                       -- e.g. "review_due", "backlog_created"
  severity        text not null default 'info'
                  check (severity in ('info','success','warning','critical')),
  title           text not null,
  body            text,
  payload         jsonb not null default '{}'::jsonb,  -- referenced entity ids, action url, etc.
  read_at         timestamptz,
  dismissed_at    timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, created_at desc)
  where read_at is null;
drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();
drop trigger if exists trg_notifications_user_id_immutable on public.notifications;
create trigger trg_notifications_user_id_immutable before update on public.notifications
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.notification_deliveries (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel         text not null check (channel in ('in_app','email','push')),
  state           text not null default 'pending'
                  check (state in ('pending','sent','failed','cancelled')),
  attempt_count   int not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (notification_id, channel)
);
create index if not exists idx_notification_deliveries_user on public.notification_deliveries(user_id);
create index if not exists idx_notification_deliveries_state
  on public.notification_deliveries(state) where state = 'pending';
drop trigger if exists trg_notification_deliveries_updated_at on public.notification_deliveries;
create trigger trg_notification_deliveries_updated_at before update on public.notification_deliveries
  for each row execute function public.set_updated_at();
drop trigger if exists trg_notification_deliveries_user_id_immutable on public.notification_deliveries;
create trigger trg_notification_deliveries_user_id_immutable before update on public.notification_deliveries
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- AI CONVERSATIONS
-- -------------------------------------------------------------
create table if not exists public.ai_conversations (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  title           text,
  context_kind    text,                                -- e.g. "explain_error", "plan_review"
  context_ref     jsonb not null default '{}'::jsonb,  -- referenced entity ids
  state           text not null default 'active'
                  check (state in ('active','closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_ai_conversations_user on public.ai_conversations(user_id);
drop trigger if exists trg_ai_conversations_updated_at on public.ai_conversations;
create trigger trg_ai_conversations_updated_at before update on public.ai_conversations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_ai_conversations_user_id_immutable on public.ai_conversations;
create trigger trg_ai_conversations_user_id_immutable before update on public.ai_conversations
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.ai_messages (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system','tool')),
  content         text not null,
  tokens_in       int,
  tokens_out      int,
  model           text,
  grounded_in     jsonb not null default '[]'::jsonb,    -- [{type, id}] references to evidence
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_ai_messages_conv on public.ai_messages(conversation_id, created_at);
create index if not exists idx_ai_messages_user on public.ai_messages(user_id);
drop trigger if exists trg_ai_messages_updated_at on public.ai_messages;
create trigger trg_ai_messages_updated_at before update on public.ai_messages
  for each row execute function public.set_updated_at();
drop trigger if exists trg_ai_messages_user_id_immutable on public.ai_messages;
create trigger trg_ai_messages_user_id_immutable before update on public.ai_messages
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- CAPTURE (Error Capture signature workflow)
-- -------------------------------------------------------------
create table if not exists public.capture_sources (
  id              uuid primary key default extensions.gen_random_uuid(),
  -- Capture sources are platform-defined (clipboard, manual, browser-extension).
  -- Not user-scoped.
  code            text not null unique,                -- "manual", "clipboard_text", "extension_v1"
  display_name    text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_capture_sources_updated_at on public.capture_sources;
create trigger trg_capture_sources_updated_at before update on public.capture_sources
  for each row execute function public.set_updated_at();

create table if not exists public.captured_questions (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  source_id       uuid not null references public.capture_sources(id) on delete restrict,
  external_ref    text,                                -- URL, file id, etc.
  raw_payload     jsonb not null default '{}'::jsonb,  -- whatever the capture source delivered
  prompt          text not null,
  detected_options jsonb,                              -- array of {body, is_correct?}
  state           text not null default 'captured'
                  check (state in ('captured','linked','rejected','failed')),
  linked_question_id uuid references public.questions(id) on delete set null,
  captured_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_captured_questions_user on public.captured_questions(user_id);
create index if not exists idx_captured_questions_state on public.captured_questions(user_id, state);
drop trigger if exists trg_captured_questions_updated_at on public.captured_questions;
create trigger trg_captured_questions_updated_at before update on public.captured_questions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_captured_questions_user_id_immutable on public.captured_questions;
create trigger trg_captured_questions_user_id_immutable before update on public.captured_questions
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.question_snapshots (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  captured_question_id uuid references public.captured_questions(id) on delete cascade,
  error_entry_id  uuid references public.error_entries(id) on delete set null,
  storage_path    text not null,                       -- path in Supabase Storage
  mime_type       text not null,
  byte_size       bigint not null check (byte_size >= 0),
  sha256          text,                                -- content hash, used to dedupe
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (sha256, user_id)                            -- per-user dedupe
);
create index if not exists idx_question_snapshots_user on public.question_snapshots(user_id);
create index if not exists idx_question_snapshots_error on public.question_snapshots(error_entry_id);
drop trigger if exists trg_question_snapshots_updated_at on public.question_snapshots;
create trigger trg_question_snapshots_updated_at before update on public.question_snapshots
  for each row execute function public.set_updated_at();
drop trigger if exists trg_question_snapshots_user_id_immutable on public.question_snapshots;
create trigger trg_question_snapshots_user_id_immutable before update on public.question_snapshots
  for each row execute function public.prevent_user_id_mutation();

-- -------------------------------------------------------------
-- PROGRESS + STUDENT MODEL (Phase 4-5 will read these; Phase 1 owns the tables)
-- -------------------------------------------------------------
create table if not exists public.progress_evidence (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  dimension       text not null,                       -- e.g. "syllabus_coverage", "error_resolution"
  delta           numeric(8,4) not null,               -- signed
  ref_kind        text not null,                       -- "test_attempt", "planner_task", "error_resolution", ...
  ref_id          uuid not null,
  captured_at     timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_progress_evidence_user_dim_time
  on public.progress_evidence(user_id, dimension, captured_at desc);
create index if not exists idx_progress_evidence_user_ref
  on public.progress_evidence(user_id, ref_kind, ref_id);
drop trigger if exists trg_progress_evidence_updated_at on public.progress_evidence;
create trigger trg_progress_evidence_updated_at before update on public.progress_evidence
  for each row execute function public.set_updated_at();
drop trigger if exists trg_progress_evidence_user_id_immutable on public.progress_evidence;
create trigger trg_progress_evidence_user_id_immutable before update on public.progress_evidence
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.progress_snapshots (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  scope           text not null,                       -- "subject" | "topic" | "sub_topic" | "global"
  scope_id        uuid,                                -- nullable for "global"
  metrics         jsonb not null default '{}'::jsonb,  -- the documented multi-dimension metrics
  computed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_progress_snapshots_user_time
  on public.progress_snapshots(user_id, computed_at desc);
create index if not exists idx_progress_snapshots_scope
  on public.progress_snapshots(user_id, scope, scope_id, computed_at desc);
drop trigger if exists trg_progress_snapshots_updated_at on public.progress_snapshots;
create trigger trg_progress_snapshots_updated_at before update on public.progress_snapshots
  for each row execute function public.set_updated_at();
drop trigger if exists trg_progress_snapshots_user_id_immutable on public.progress_snapshots;
create trigger trg_progress_snapshots_user_id_immutable before update on public.progress_snapshots
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.student_model_snapshots (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  features        jsonb not null default '{}'::jsonb,  -- serialized features
  confidence      numeric(4,3) not null default 0.000
                  check (confidence between 0 and 1),
  computed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_student_model_snapshots_user_time
  on public.student_model_snapshots(user_id, computed_at desc);
drop trigger if exists trg_student_model_snapshots_updated_at on public.student_model_snapshots;
create trigger trg_student_model_snapshots_updated_at before update on public.student_model_snapshots
  for each row execute function public.set_updated_at();
drop trigger if exists trg_student_model_snapshots_user_id_immutable on public.student_model_snapshots;
create trigger trg_student_model_snapshots_user_id_immutable before update on public.student_model_snapshots
  for each row execute function public.prevent_user_id_mutation();

create table if not exists public.student_model_features (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  feature_key     text not null,                       -- e.g. "consistency_7d"
  feature_value   jsonb not null,                      -- numeric / struct
  evidence_count  int  not null default 0,
  computed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, feature_key, computed_at)
);
create index if not exists idx_student_model_features_user_key
  on public.student_model_features(user_id, feature_key, computed_at desc);
drop trigger if exists trg_student_model_features_updated_at on public.student_model_features;
create trigger trg_student_model_features_updated_at before update on public.student_model_features
  for each row execute function public.set_updated_at();
drop trigger if exists trg_student_model_features_user_id_immutable on public.student_model_features;
create trigger trg_student_model_features_user_id_immutable before update on public.student_model_features
  for each row execute function public.prevent_user_id_mutation();
