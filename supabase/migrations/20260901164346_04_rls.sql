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
    'student_model_features'
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
