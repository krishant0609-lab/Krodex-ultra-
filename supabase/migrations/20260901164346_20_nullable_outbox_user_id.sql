-- ============================================================================
-- KRODEX v1.0 — system.tick remediation
-- Migration 20: make public.event_outbox.user_id nullable + NULLS NOT DISTINCT
--                unique index
--
-- Root cause (KRODEX-PHA-2026-08-FK1):
--   Four scheduled jobs (mark_review_due, detect_task_missed,
--   recompute_analytics_rollup, recompute_student_model) emit
--   EventEnvelope.accountId = '00000000-0000-0000-0000-000000000000' for
--   system.tick events. The nil UUID is not a real user, so the FK
--   event_outbox.user_id -> public.users(id) rejects the insert with
--   SQLSTATE 23503.
--
-- Domain model (pre-existing, unchanged by this migration):
--   accountId = owning user (nullable; NULL for system-owned events)
--   actorId   = causing principal (already nullable)
--
-- What this migration does:
--   1. Drops NOT NULL on public.event_outbox.user_id.
--   2. Preserves the existing FK event_outbox.user_id -> public.users(id)
--      (no CASCADE change; FK is preserved as-is).
--   3. Replaces uq_event_outbox_idem with a NULLS NOT DISTINCT version so
--      system.tick events with idempotency_key = (e.g.) a fixed period
--      dedup correctly when user_id is NULL.
--   4. Documents the nullable semantics with a column comment.
--
-- What this migration does NOT do:
--   - No data backfill (production event_outbox is empty; no rows to convert).
--   - No FK drop / weaken / change.
--   - No RLS change.
--   - No change to event_log, claim_pending_events, or any RPC.
--   - No change to the nil-UUID-hardcoded application code; that is fixed
--     by the application-level commit that accompanies this migration
--     (4 scheduled jobs now emit accountId: null).
-- ============================================================================

begin;

-- (1) Drop NOT NULL on event_outbox.user_id.
--     The FK event_outbox_user_id_fkey is preserved (no change to its
--     definition; only the NOT NULL constraint on the column is dropped).
alter table public.event_outbox
  alter column user_id drop not null;

-- (2) Recreate the composite unique index as NULLS NOT DISTINCT.
--     Default is NULLS DISTINCT, which would let two system.tick rows with
--     the same (user_id=NULL, event_type, idempotency_key) coexist. We
--     require NULLS NOT DISTINCT (PostgreSQL 15+, production is PG 17.6) so
--     dedup still works for system-owned events.
drop index if exists public.uq_event_outbox_idem;
create unique index uq_event_outbox_idem
  on public.event_outbox (user_id, event_type, idempotency_key)
  nulls not distinct;

-- (3) Document the semantics.
comment on column public.event_outbox.user_id is
  'Owning user (accountId from the event envelope). NULL for system-owned events such as system.tick. FK to public.users(id) is preserved.';

-- (4) The existing non-unique helper index idx_event_outbox_user_occurred
--     and idx_event_outbox_user_type_time remain valid b-tree indexes on
--     a now-nullable column. B-tree indexes on nullable columns are
--     supported by PostgreSQL — no rebuild required. (PostgreSQL stores
--     NULL entries at one end of the index and indexes them normally.)
--
-- No data migration is required: production event_outbox has 0 rows.

commit;
