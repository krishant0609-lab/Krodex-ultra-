-- =============================================================
-- KRODEX — migration 10: progress_evidence dedup index
-- Phase 3 (Event & Connectivity Layer)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- Per PHASE3_PLAN.md §13 decision 1, both writers of progress_evidence
-- (the source RPCs/service-layer calls AND the worker handler
-- project_progress_evidence) coexist and rely on a single
-- uniqueness invariant: (user_id, dimension, ref_kind, ref_id).
-- A second writer seeing the same (user, dimension, ref) pair
-- must no-op rather than double-count.
--
-- Postgres does not have a built-in "INSERT or no-op" that keys
-- on an arbitrary column set without a unique constraint. We add
-- a unique index here so the handler can do:
--   insert into progress_evidence (...) on conflict do nothing;
-- and the conflict target is unambiguous.
--
-- Existing rows: in production this would be a backfill concern.
-- For Phase 3 dev we re-create the index IF NOT EXISTS. Any
-- pre-existing duplicates will fail the migration and surface
-- in the report.
-- =============================================================

set search_path = public, extensions;

create unique index if not exists uq_progress_evidence_user_dim_ref
  on public.progress_evidence (user_id, dimension, ref_kind, ref_id);

comment on index public.uq_progress_evidence_user_dim_ref is
  'Per PHASE3_PLAN.md §13 decision 1: the dedup primitive that lets both the source mutation AND the worker handler project_progress_evidence write to progress_evidence idempotently. The (user_id, dimension, ref_kind, ref_id) tuple identifies a single evidence event.';
