-- =============================================================
-- KRODEX — migration 08: event bus
-- Phase 3 (Event & Connectivity Layer)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- The event bus decouples "the domain mutation happened" from
-- "every projection (progress evidence, notifications, analytics
-- rollups) has been updated". Producers write to event_outbox in
-- the same transaction as the source mutation. A worker polls
-- event_outbox, dispatches to registered handlers, and writes
-- event_log rows that record the outcome. Handlers are idempotent;
-- duplicate delivery is a no-op via the (event_id, handler_name)
-- unique index on event_log.
--
-- RLS posture: BOTH tables are service_role only. Users never read
-- or write them — the API only exposes the derived projections
-- (notifications, progress_evidence) which the worker writes. RLS
-- is enabled with no policies (= default deny for authenticated).
--
-- This migration is intentionally idempotent so it can be re-run
-- safely on a partially-applied database.
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- 08.1  Outbox. Source-of-truth for "this domain mutation
--       emitted these events". One row per (transaction, event).
--       Multiple events per source mutation => multiple rows.
--       aggregate_version carries optimistic-concurrency for
--       downstream consumers.
-- -------------------------------------------------------------
create table if not exists public.event_outbox (
  id                uuid primary key default extensions.gen_random_uuid(),
  occurred_at       timestamptz not null default now(),
  event_id          text not null unique,
  event_type        text not null,
  schema_version    int  not null default 1,
  user_id           uuid not null references public.users(id) on delete cascade,
  actor_id          uuid references public.users(id),
  aggregate_type    text not null,
  aggregate_id      text not null,
  aggregate_version int  not null default 1,
  payload           jsonb not null,
  idempotency_key   text not null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_event_outbox_user_occurred
  on public.event_outbox(user_id, occurred_at desc);
create index if not exists idx_event_outbox_aggregate
  on public.event_outbox(aggregate_type, aggregate_id);
create unique index if not exists uq_event_outbox_idem
  on public.event_outbox(user_id, event_type, idempotency_key);

comment on table public.event_outbox is
  'Transactional outbox: domain events written in the same tx as the source mutation. Service-role only. Worker polls this table; handlers are idempotent on (event_id, handler_name) via event_log.';

-- -------------------------------------------------------------
-- 08.2  Log. One row per (event, handler) attempt. Authoritative
--       record of "this handler has processed this event with
--       this outcome". The unique (event_id, handler_name)
--       constraint is the idempotency primitive for handlers.
-- -------------------------------------------------------------
create table if not exists public.event_log (
  id                uuid primary key default extensions.gen_random_uuid(),
  event_id          text not null references public.event_outbox(event_id) on delete cascade,
  handler_name      text not null,
  status            text not null check (status in ('succeeded','failed','dead_letter')),
  attempt_count     int  not null default 1,
  last_error        text,
  first_attempted_at  timestamptz not null default now(),
  last_attempted_at   timestamptz not null default now(),
  completed_at      timestamptz,
  unique (event_id, handler_name)
);

create index if not exists idx_event_log_handler_status
  on public.event_log(handler_name, status, last_attempted_at);
create index if not exists idx_event_log_event
  on public.event_log(event_id);

comment on table public.event_log is
  'Per-handler audit of outbox events. The unique (event_id, handler_name) index makes handler delivery exactly-once. status=dead_letter stops the worker from re-claiming.';

-- -------------------------------------------------------------
-- 08.3  Dead-letter view. Joins outbox so operators see full
--       context (handler, error, source payload) for events
--       that exhausted their retry budget.
-- -------------------------------------------------------------
create or replace view public.event_dead_letter as
  select
    el.event_id,
    el.handler_name,
    el.attempt_count,
    el.last_error,
    el.last_attempted_at,
    eo.event_type,
    eo.user_id,
    eo.aggregate_type,
    eo.aggregate_id,
    eo.payload
  from public.event_log el
  join public.event_outbox eo on eo.event_id = el.event_id
 where el.status = 'dead_letter';

comment on view public.event_dead_letter is
  'Read-only view of outbox events whose handlers exhausted their retry budget. Service-role only (joins event_log and event_outbox which are RLS-locked).';

-- -------------------------------------------------------------
-- 08.4  Worker claim function. SECURITY DEFINER. Atomically
--       picks up to N events that have no (succeeded) log row
--       yet for the given handler. Uses FOR UPDATE SKIP LOCKED
--       so concurrent workers do not double-deliver. Dead-
--       lettered events are skipped.
-- -------------------------------------------------------------
create or replace function public.claim_pending_events(
  p_handler   text,
  p_batch     int  default 25,
  p_lease_for interval default interval '60 seconds'
) returns setof public.event_outbox
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  with claimed as (
    select eo.event_id
      from public.event_outbox eo
     where not exists (
             select 1 from public.event_log el
              where el.event_id = eo.event_id
                and el.handler_name = p_handler
                and el.status = 'succeeded'
           )
       and not exists (
             select 1 from public.event_log el
              where el.event_id = eo.event_id
                and el.handler_name = p_handler
                and el.status = 'dead_letter'
           )
     order by eo.occurred_at asc
     limit p_batch
     for update skip locked
  )
  select eo.* from public.event_outbox eo join claimed using (event_id);
end;
$$;

comment on function public.claim_pending_events(text, int, interval) is
  'Service-role claim of up to p_batch events with no succeeded log row for the handler. Uses FOR UPDATE SKIP LOCKED so concurrent workers do not double-deliver. Dead-lettered events are skipped. Caller MUST write an event_log row (succeeded or failed) within p_lease_for; otherwise the next poll re-claims them.';

-- -------------------------------------------------------------
-- 08.5  RLS. Both tables are service_role only.
-- -------------------------------------------------------------
alter table public.event_outbox enable row level security;
alter table public.event_log   enable row level security;

-- -------------------------------------------------------------
-- 08.6  Idempotency-key table extension. Phase 2's
--       idempotency_keys table gains an event_emitted flag so
--       Phase 3 can record "this HTTP request emitted its
--       outbox events" without re-emitting on retry.
-- -------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'idempotency_keys'
       and column_name  = 'event_emitted'
  ) then
    alter table public.idempotency_keys
      add column event_emitted boolean not null default false;
  end if;
end$$;
