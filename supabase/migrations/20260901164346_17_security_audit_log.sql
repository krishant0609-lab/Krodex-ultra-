-- =============================================================
-- KRODEX — migration 17: security audit log
-- Phase 14 (Security Hardening)
-- UTC timestamp: 2026-09-04
-- =============================================================
--
-- Per PHASE14_PLAN §1a, the API must record an audit row for
-- every privileged operation. Privileged operations in Phase 0–13:
--   - POST /analytics/admin/recompute     — service-role recompute
--   - POST /student-model/admin/recompute — service-role recompute
--   - POST /planner/check-missed           — admin / cron miss sweep
--   - softDeleteAsset() (the only evidence-physical-delete path;
--     no public route today, but the service layer is what does
--     the work and is what gets audited)
--   - Any future admin / service-role route added in Phase 16+
--
-- The table is INSERT-only from the API and SELECT for admins via
-- the service role. RLS keeps the rows visible only to the
-- service role; ordinary users cannot read audit rows.
--
-- Storage budget: one row per privileged operation. Metadata is
-- capped at 4 KB by application convention; we do not enforce a
-- hard limit at the DB level to keep the migration small.
-- =============================================================

set search_path = public, extensions;

create table if not exists public.audit_events (
  id           uuid        primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  actor_id     text        not null,
  action       text        not null,
  resource     text,
  resource_id  text,
  metadata     jsonb       not null default '{}'::jsonb,
  request_id   text
);

create index if not exists idx_audit_events_occurred_at
  on public.audit_events (occurred_at desc);

create index if not exists idx_audit_events_actor
  on public.audit_events (actor_id, occurred_at desc);

create index if not exists idx_audit_events_action
  on public.audit_events (action, occurred_at desc);

comment on table public.audit_events is
  'Phase 14 security audit log. One row per privileged operation. INSERT-only from the API; SELECT via service role. RLS enabled and forced below.';

-- -------------------------------------------------------------
-- RLS: only the service role can read or insert. Regular users
-- see no rows. This is the same posture we use for the
-- outbox / event_log tables.
-- -------------------------------------------------------------
alter table public.audit_events enable row level security;
alter table public.audit_events force  row level security;

-- No policies. With force RLS and no policy, every principal
-- (including the table owner) is denied. The service role
-- bypasses RLS, so the API can write + read. Application
-- migrations also bypass.
