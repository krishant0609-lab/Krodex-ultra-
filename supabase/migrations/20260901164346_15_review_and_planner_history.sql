-- =============================================================
-- KRODEX — migration 15: Phase 10 + Phase 11 history tables.
--
-- Phase 10 (Review / Retest Engine):
--   * verification_questions — tracks which questions have been
--     used as verification items for a given error entry, so
--     FreshQuestionSelector can exclude already-asked questions.
--
-- Phase 11 (Planner / Backlog Automation):
--   * planner_task_events — append-only history of planner task
--     state changes (created/rescheduled/completed/missed/partial/
--     skipped/recovered/escalated). History is never updated.
--   * backlog_recovery_events — records recovery actions on
--     backlog items (rescheduled/split/downgraded/completed/
--     dismissed).
--   * planner_tasks.partial_count — counter incremented when a
--     task is marked partial.
--
-- See PIP §407-482, TRD §11-13, PRD §16-22, Schema Ready §8-14.
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- Phase 10: verification_questions
-- -------------------------------------------------------------
create table if not exists public.verification_questions (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references public.questions(id) on delete restrict,
  error_id        uuid not null references public.error_entries(id) on delete cascade,
  difficulty      int check (difficulty between 1 and 5),
  verified_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create unique index if not exists idx_vq_question_error
  on public.verification_questions(question_id, error_id);
create index if not exists idx_vq_error
  on public.verification_questions(error_id);

-- -------------------------------------------------------------
-- Phase 11: planner_task_events
-- -------------------------------------------------------------
create table if not exists public.planner_task_events (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.planner_tasks(id) on delete cascade,
  event_type      text not null
                    check (event_type in (
                      'created','rescheduled','partial','completed','missed',
                      'skipped','recovered','escalated'
                    )),
  previous_due_at timestamptz,
  new_due_at      timestamptz,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_planner_task_events_task
  on public.planner_task_events(task_id);

-- -------------------------------------------------------------
-- Phase 11: backlog_recovery_events
-- -------------------------------------------------------------
create table if not exists public.backlog_recovery_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  backlog_item_id uuid references public.backlog_items(id) on delete set null,
  task_id         uuid references public.planner_tasks(id) on delete set null,
  recovery_type   text not null check (recovery_type in (
    'rescheduled','split','downgraded','completed','dismissed'
  )),
  created_at      timestamptz not null default now()
);
create index if not exists idx_backlog_recovery_user
  on public.backlog_recovery_events(user_id);

-- -------------------------------------------------------------
-- Phase 11: planner_tasks.partial_count
-- -------------------------------------------------------------
alter table public.planner_tasks
  add column if not exists partial_count int not null default 0;

-- -------------------------------------------------------------
-- Phase 10: source_task_id on planner_tasks (linking reschedules)
-- Per PRD §820-831: rescheduling creates a NEW task linked to the
-- originating one rather than rewriting history. This column makes
-- the link queryable.
-- -------------------------------------------------------------
alter table public.planner_tasks
  add column if not exists source_task_id uuid references public.planner_tasks(id) on delete set null;
create index if not exists idx_planner_tasks_source
  on public.planner_tasks(source_task_id) where source_task_id is not null;
