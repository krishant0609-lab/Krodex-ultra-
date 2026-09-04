-- =============================================================
-- KRODEX — migration 16: notification dedup index
-- Phase 12 (Notifications & Scheduling)
-- UTC timestamp: 2026-09-04
-- =============================================================
--
-- Per PHASE12_PLAN §6, every notification row carries a
-- `dedup_key = sha256(kind | source_aggregate_id | user_id | date_bucket)`
-- where `date_bucket` is the YYYY-MM-DD of the event for recurring
-- events (review_due, review_overdue) and null for one-shot events
-- (error_recorded, error_reopened, attempt_analyzed, task_missed,
-- task_completed, backlog_recovery, review_outcome_recorded).
--
-- The notification projector is the only writer of notifications
-- rows. The worker event_log table already prevents duplicate
-- handler invocations per (event_id, handler_name), but the same
-- domain occurrence can be projected by two distinct domain events
-- (e.g. an `error.lifecycle.active` AND the outbox replaying the
-- same on restart). The dedup_key is the second line of defense.
--
-- This migration:
--   1. Adds the `dedup_key` text column to public.notifications
--   2. Creates a unique index on (user_id, dedup_key) so the handler
--      can do an idempotent INSERT...ON CONFLICT DO NOTHING
-- =============================================================

set search_path = public, extensions;

alter table public.notifications
  add column if not exists dedup_key text;

create unique index if not exists uq_notifications_user_dedup
  on public.notifications (user_id, dedup_key)
  where dedup_key is not null;

create index if not exists idx_notifications_kind
  on public.notifications (user_id, kind);

comment on column public.notifications.dedup_key is
  'Per PHASE12_PLAN §6: sha256(kind | source_aggregate_id | user_id | date_bucket). The unique index on (user_id, dedup_key) is the idempotency primitive for the project_notification handler.';
