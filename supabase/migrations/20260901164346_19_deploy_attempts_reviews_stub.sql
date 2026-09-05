-- =============================================================
-- KRODEX — migration 19: deployment-only stub for attempts/reviews
-- Created: 2026-09-05 (deployment correction)
-- =============================================================
--
-- This migration MUST run BEFORE migration 03 in the apply order.
-- Migration 03 declares two FK references to tables that are
-- never created anywhere in the migration set:
--
--   error_evidence.attempt_id        -> public.attempts(id)
--   error_lifecycle_events.review_id -> public.reviews(id)
--
-- Migration 19 is applied first (lowest timestamp suffix that
-- sorts after 18) by Supabase CLI; in this deployment we apply
-- the migrations in this order: 01, 02, 19, 03, 04, ..., 18.
--
-- This is a deployment-only correction, not a redesign. The stub
-- tables are minimal: only the columns the FKs require. The v1.0
-- application does not read or write these tables.

create table if not exists public.attempts (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.reviews (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid,
  created_at  timestamptz not null default now()
);

-- After migration 03 runs (creating public.users), add the FK
-- that error_evidence and error_lifecycle_events expect.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') then
    begin
      alter table public.attempts
        add constraint attempts_user_id_fkey
        foreign key (user_id) references public.users(id) on delete cascade;
    exception when duplicate_object then null;
    end;
    begin
      alter table public.reviews
        add constraint reviews_user_id_fkey
        foreign key (user_id) references public.users(id) on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

comment on table public.attempts is
  'Deployment stub (2026-09-05). Satisfies a pre-existing FK in error_evidence. Not used by the v1.0 application — see public.test_attempts.';
comment on table public.reviews is
  'Deployment stub (2026-09-05). Satisfies a pre-existing FK in error_lifecycle_events. Not used by the v1.0 application — see public.review_schedules.';
