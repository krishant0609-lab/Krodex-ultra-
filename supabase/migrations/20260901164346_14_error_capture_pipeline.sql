-- =============================================================
-- KRODEX — migration 14: Error Capture Pipeline (Phase 9) —
-- Storage bucket and capture_sources seed only.
--
-- The three new tables (error_evidence, evidence_assets,
-- error_lifecycle_events) live in migration 03 (core schema)
-- alongside every other user-scoped table. Their RLS policies
-- live in migration 04. This migration only adds:
--   * the `error-evidence` Supabase Storage bucket (private)
--   * the storage.objects RLS policies that scope bucket access
--     to the owning user
--   * one `capture_sources` seed row for "captured" snapshots
--     (forward-compatibility; not used by Phase 9 code yet)
--
-- See TRD §9–13 and PIP §369–406.
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- Supabase Storage bucket for error evidence snapshots
-- Private bucket — no permanent public URLs.
-- Access via signed authorized-url endpoints only.
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'error-evidence',
  'error-evidence',
  false,
  5242880,            -- 5 MB per snapshot
  array['image/png','image/svg+xml']
)
on conflict (id) do nothing;

-- RLS on storage.objects: student can only access their own prefix
-- (the path convention is error-evidence/{userId}/{evidenceId}/{assetId}.{ext}).
-- The service generates signed URLs for authorized access; the
-- storage.objects row-level policies below scope those URLs to
-- the bucket's owner.
create policy error_evidence_storage_owner_upload on storage.objects
  for insert
  with check (
    bucket_id = 'error-evidence'
    and (auth.uid()::text = split_part(storage.foldername(name), '/', 1)
         or public.is_service_role())
  );

create policy error_evidence_storage_owner_select on storage.objects
  for select
  using (
    bucket_id = 'error-evidence'
    and (auth.uid()::text = split_part(storage.foldername(name), '/', 1)
         or public.is_service_role())
  );

-- Soft delete: only the service role can physically remove a
-- snapshot binary. The application sets `status = 'deleted'`
-- on the EvidenceAsset row to preserve the audit trail.
create policy error_evidence_storage_owner_delete on storage.objects
  for delete
  using (
    bucket_id = 'error-evidence'
    and public.is_service_role()
  );
