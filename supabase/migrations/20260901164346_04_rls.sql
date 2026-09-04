-- =============================================================
-- KRODEX — migration 04: Row-Level Security
-- Phase 1
-- =============================================================
--
-- Posture (per TRD §2.3 + Schema-Ready §3):
--   * Every USER-SCOPED table has RLS enabled and FORCED.
--   * Global tables (subjects, topics, sub_topics, questions,
--     question_options, capture_sources) are read-public / write-admin
--     because their content is shared across users. Write access is
--     gated to the service role; the public API must NOT mutate
--     global content directly (Phase 2 will enforce that at the
--     service layer).
--   * The auth model is "owner-only": a user can only see rows where
--     user_id = auth.uid(). The service role bypasses RLS for
--     legitimate cross-user work (migrations, admin tooling,
--     scheduled jobs in Phase 3).
-- =============================================================

set search_path = public, extensions;

-- Helper: returns true iff the caller is the service role.
-- (Real Supabase exposes this via auth.role(); the GUC fallback keeps
-- the policies portable to a vanilla Postgres test environment.)
create or replace function public.is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('role', true), '') = 'service_role',
    false
  );
$$;

-- -------------------------------------------------------------
-- Global tables (read-public, write via service role only)
-- -------------------------------------------------------------

alter table public.subjects         enable row level security;
alter table public.subjects         force  row level security;
alter table public.topics           enable row level security;
alter table public.topics           force  row level security;
alter table public.sub_topics       enable row level security;
alter table public.sub_topics       force  row level security;
alter table public.questions        enable row level security;
alter table public.questions        force  row level security;
alter table public.question_options enable row level security;
alter table public.question_options force  row level security;
alter table public.capture_sources  enable row level security;
alter table public.capture_sources  force  row level security;

-- Anyone authenticated may READ the global content; only service role
-- may WRITE it.
create policy subjects_read         on public.subjects         for select using (true);
create policy subjects_write_service on public.subjects         for all    using (public.is_service_role()) with check (public.is_service_role());
create policy topics_read           on public.topics           for select using (true);
create policy topics_write_service  on public.topics           for all    using (public.is_service_role()) with check (public.is_service_role());
create policy sub_topics_read       on public.sub_topics       for select using (true);
create policy sub_topics_write_service on public.sub_topics     for all    using (public.is_service_role()) with check (public.is_service_role());
create policy questions_read        on public.questions        for select using (true);
create policy questions_write_service on public.questions      for all    using (public.is_service_role()) with check (public.is_service_role());
create policy question_options_read on public.question_options for select using (true);
create policy question_options_write_service on public.question_options for all using (public.is_service_role()) with check (public.is_service_role());
create policy capture_sources_read  on public.capture_sources  for select using (true);
create policy capture_sources_write_service on public.capture_sources for all using (public.is_service_role()) with check (public.is_service_role());

-- -------------------------------------------------------------
-- Users + profiles
-- -------------------------------------------------------------
-- A user can read their own user row and (in Phase 2+) admins can read
-- all. For Phase 1 the policy is strict owner-only.
alter table public.users    enable row level security;
alter table public.users    force  row level security;
alter table public.profiles enable row level security;
alter table public.profiles force  row level security;

create policy users_owner_all on public.users
  for all
  using      (id = public.auth_uid() or public.is_service_role())
  with check (id = public.auth_uid() or public.is_service_role());

create policy profiles_owner_all on public.profiles
  for all
  using      (user_id = public.auth_uid() or public.is_service_role())
  with check (user_id = public.auth_uid() or public.is_service_role());

-- -------------------------------------------------------------
-- User-scoped tables (single owner policy repeated)
-- -------------------------------------------------------------
-- Pattern: full CRUD for the owner (user_id = auth.uid()) plus the
-- service role. This is the documented "User Ownership" posture.
do $$
declare
  t text;
  tables text[] := array[
    'syllabus_progress',
    'error_entries',
    'error_question_links',
    'review_schedules',
    'review_attempts',
    'test_definitions',
    'test_questions',
    'test_attempts',
    'test_answers',
    'planner_templates',
    'planner_tasks',
    'backlog_items',
    'backlog_recoveries',
    'notifications',
    'notification_deliveries',
    'ai_conversations',
    'ai_messages',
    'captured_questions',
    'question_snapshots',
    'progress_evidence',
    'progress_snapshots',
    'student_model_snapshots',
    'student_model_features',
    -- Phase 9 (TRD §9): per-attempt evidence record has a direct
    -- user_id column and uses the standard owner template.
    'error_evidence'
    -- Phase 9 tables `evidence_assets` and `error_lifecycle_events`
    -- are NOT in this DO block on purpose: their ownership predicate
    -- is a JOIN through error_evidence / error_entries, so the
    -- simple `user_id = auth.uid()` template does not fit. Explicit
    -- CREATE POLICY statements follow below.
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format(
      'create policy %I_owner_all on public.%I '
      'for all '
      'using      (user_id = public.auth_uid() or public.is_service_role()) '
      'with check (user_id = public.auth_uid() or public.is_service_role())',
      t, t);
  end loop;
end$$;

-- -------------------------------------------------------------
-- Phase 9 join-owned tables (explicit CREATE POLICY)
--
-- The two tables below do NOT have a direct `user_id` column.
-- Their ownership is determined by JOINing through a parent
-- table that DOES carry user_id, so the simple DO-block
-- template above does not fit. Both tables get RLS enabled
-- and forced here, with an explicit policy whose USING
-- expression performs the parent-table lookup.
-- -------------------------------------------------------------

alter table public.evidence_assets enable row level security;
alter table public.evidence_assets force  row level security;

create policy evidence_assets_owner_all on public.evidence_assets
  for all
  using (
    exists (
      select 1 from public.error_evidence ee
      where ee.id = evidence_assets.evidence_id
        and (ee.user_id = public.auth_uid() or public.is_service_role())
    )
    or public.is_service_role()
  )
  with check (
    exists (
      select 1 from public.error_evidence ee
      where ee.id = evidence_assets.evidence_id
        and (ee.user_id = public.auth_uid() or public.is_service_role())
    )
    or public.is_service_role()
  );

alter table public.error_lifecycle_events enable row level security;
alter table public.error_lifecycle_events force  row level security;

-- Owner can read their own lifecycle history. The lifecycle
-- history is INSERT-only via the service role; controllers
-- MUST go through the service, not raw SQL. UPDATE/DELETE
-- are intentionally not granted to anyone (append-only audit).
create policy error_lifecycle_owner_select on public.error_lifecycle_events
  for select
  using (
    exists (
      select 1 from public.error_entries ee
      where ee.id = error_lifecycle_events.error_entry_id
        and (ee.user_id = public.auth_uid() or public.is_service_role())
    )
    or public.is_service_role()
  );

-- INSERT is restricted to the service role because controllers
-- always go through ErrorLifecycleService. This keeps the
-- history table append-only from the API's point of view.
create policy error_lifecycle_insert_service on public.error_lifecycle_events
  for insert
  with check (public.is_service_role());

-- -------------------------------------------------------------
-- Phase 10: verification_questions
--
-- No direct user_id; ownership is via the error_entries join.
-- The table is INSERT-only via the service role; SELECT goes
-- through the error_entries ownership check.
-- -------------------------------------------------------------
alter table public.verification_questions enable row level security;
alter table public.verification_questions force  row level security;

create policy verification_questions_owner_select on public.verification_questions
  for select
  using (
    exists (
      select 1 from public.error_entries ee
      where ee.id = verification_questions.error_id
        and (ee.user_id = public.auth_uid() or public.is_service_role())
    )
    or public.is_service_role()
  );

create policy verification_questions_insert_service on public.verification_questions
  for insert
  with check (public.is_service_role());

-- -------------------------------------------------------------
-- Phase 11: planner_task_events (append-only history)
--
-- No direct user_id; ownership is via the planner_tasks join.
-- INSERT via service role only (append-only audit trail).
-- -------------------------------------------------------------
alter table public.planner_task_events enable row level security;
alter table public.planner_task_events force  row level security;

create policy planner_task_events_owner_select on public.planner_task_events
  for select
  using (
    exists (
      select 1 from public.planner_tasks pt
      where pt.id = planner_task_events.task_id
        and (pt.user_id = public.auth_uid() or public.is_service_role())
    )
    or public.is_service_role()
  );

create policy planner_task_events_insert_service on public.planner_task_events
  for insert
  with check (public.is_service_role());

-- -------------------------------------------------------------
-- Phase 11: backlog_recovery_events (per-user)
-- -------------------------------------------------------------
alter table public.backlog_recovery_events enable row level security;
alter table public.backlog_recovery_events force  row level security;

create policy backlog_recovery_owner_select on public.backlog_recovery_events
  for select
  using (user_id = public.auth_uid() or public.is_service_role());

create policy backlog_recovery_insert_service on public.backlog_recovery_events
  for insert
  with check (user_id = public.auth_uid() or public.is_service_role());
