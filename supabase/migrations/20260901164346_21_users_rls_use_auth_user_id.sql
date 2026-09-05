-- =============================================================
-- KRODEX — migration 21: align public.users RLS with the
-- auto-provisioning flow.
-- Phase 14
-- =============================================================
--
-- Background
-- ----------
-- The original policy (migration 04) was:
--
--   create policy users_owner_all on public.users
--     for all
--     using      (id = public.auth_uid() or public.is_service_role())
--     with check (id = public.auth_uid() or public.is_service_role());
--
-- That assumed `public.users.id` was the auth user id. Phase 0–13
-- code (the dev-token path) wrote the same value into both
-- `id` and `auth_user_id`, so the policy happened to work
-- end-to-end under HS256 dev tokens.
--
-- The Phase 14 / production Supabase Auth path inserts a row with
-- a fresh synthetic `id` (default `gen_random_uuid()`) and the
-- verified JWT subject in `auth_user_id`. The old policy then
-- never matches the new row, so the per-request user client gets
-- zero rows back and `GET /users/me` / `PATCH /users/me` return
-- 404 / 500. `/syllabus/*`, `/planner/*`, `/errors`,
-- `/notifications` are unaffected because they look up
-- `user_id`, not `id` directly.
--
-- Fix
-- ---
-- Replace `id = auth_uid()` with `auth_user_id = auth_uid()` on
-- the public.users policy. This matches the policy shape used on
-- every other user-scoped table (where the link column is named
-- `user_id`).
--
-- All 12 existing rows already have a populated `auth_user_id`
-- (set by the dev-token path or by the new auto-provisioning),
-- so this is a no-op for existing data: rows that were visible
-- before are still visible, and rows that were hidden (the
-- mismatched-id dev rows) were already inaccessible to the user
-- client, so we lose nothing.
--
-- The `id` column is still the synthetic primary key — the API
-- uses it as the canonical KRODEX user id (in request bodies and
-- as the foreign key in profiles, planner_tasks, etc.). The
-- `auth_user_id` column is the linkage to Supabase Auth.
--
-- This is a minimal, additive fix:
--   * No data migration
--   * No contract change for any other table
--   * No change to the dev-token path (it already wrote
--     `auth_user_id`, so the new policy makes the user client
--     consistent with what the service client sees)

set search_path = public, extensions;

drop policy if exists users_owner_all on public.users;

create policy users_owner_all on public.users
  for all
  using      (auth_user_id = public.auth_uid() or public.is_service_role())
  with check (auth_user_id = public.auth_uid() or public.is_service_role());
