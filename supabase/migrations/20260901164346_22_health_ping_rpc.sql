-- =============================================================
-- KRODEX — migration 22: health_ping RPC
-- UTC timestamp: 2026-09-05
-- =============================================================
--
-- The API health probe (apps/api/src/db/health.ts) calls
-- client.rpc('health_ping').maybeSingle() as the cheapest
-- connectivity check. Until now the RPC didn't exist; the
-- fallback path tried a count on `subjects` and (because the
-- RLS on subjects gates on auth.uid() and the service role
-- path was different) reported `db.status: "unreachable"`.
--
-- This migration creates the missing RPC. It is intentionally
-- trivial: no arguments, returns a constant, SECURITY INVOKER,
-- no table access. The service role can call it, anon can call
-- it, and the cost is one round trip of "select 1" on Postgres.

set search_path = public, extensions;

create or replace function public.health_ping()
returns int
language sql
stable
security invoker
as $$
  select 1;
$$;

comment on function public.health_ping() is
  'Minimal health-probe RPC. Returns 1, no args, no data access. Used by apps/api/src/db/health.ts.';

-- Grant to the two relevant roles. Idempotent.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.health_ping() to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.health_ping() to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.health_ping() to service_role;
  end if;
exception when others then
  null;
end$$;
