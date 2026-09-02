-- =============================================================
-- KRODEX — migration 02: helper functions + triggers
-- Phase 1
-- =============================================================
--
-- 1. auth.uid() shim
--    The real Supabase auth.uid() only exists inside the `auth` schema
--    on a live Supabase project. In a vanilla Postgres environment
--    (e.g. a future CI Postgres-only container) this shim lets RLS
--    policies and our trigger-based user_id assignment still work.
--    On a real Supabase project, the public.auth_uid() wrapper reads
--    from auth.uid() first and falls back to current_setting().

create or replace function public.auth_uid()
returns uuid
language sql
stable
as $$
  -- On real Supabase: prefer auth.uid() (returns the JWT subject).
  -- On vanilla Postgres: read a session-scoped GUC set by the API.
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    nullif(current_setting('app.current_user_id', true), '')::uuid
  );
$$;

comment on function public.auth_uid() is
  'Returns the currently authenticated user UUID. Prefers Supabase auth.uid(); falls back to the app.current_user_id GUC.';

-- 2. updated_at trigger
--    Every table with an updated_at column gets this trigger. See
--    TRD §2.3 ("timestamps maintained by triggers").

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger that stamps new.updated_at = now().';

-- 3. set_user_id_on_insert
--    For tables where the API does not (or must not) supply user_id
--    directly, this trigger auto-populates it from auth.uid(). Defence
--    in depth: even if the API forgets, the row is owned by the caller.

create or replace function public.set_user_id_on_insert()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is null then
    new.user_id = public.auth_uid();
  end if;
  return new;
end;
$$;

comment on function public.set_user_id_on_insert() is
  'BEFORE INSERT trigger that sets new.user_id = auth.uid() if it is null.';

-- 4. prevent_user_id_mutation
--    Once written, a row's user_id must not be reassigned. This blocks
--    a class of cross-tenant mutation bugs (see Schema-Ready §3
--    "ownership must not be reassignable").

create or replace function public.prevent_user_id_mutation()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable (table %, id %)', tg_table_name, old.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

comment on function public.prevent_user_id_mutation() is
  'BEFORE UPDATE trigger that rejects changes to user_id.';
