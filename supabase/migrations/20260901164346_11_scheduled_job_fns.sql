-- =============================================================
-- KRODEX — migration 11: scheduled-job SQL functions
-- Phase 3 (Event & Connectivity Layer)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- Per PHASE3_PLAN.md §6.3, the scheduled jobs in Phase 3 are:
--
--   1. mark_review_due     — every 5 min: flip review_schedules
--                            state 'scheduled' -> 'due' when
--                            due_at <= now(), and emit one
--                            'review.started' event per row.
--
--   2. detect_task_missed  — every 15 min: flip planner_tasks
--                            state 'planned' -> 'missed' for
--                            dates in the 7-day lookback, create
--                            a matching backlog_items row, and
--                            emit one 'task.missed' event per row.
--
-- Both jobs run in the API process via the in-process scheduler
-- (apps/api/src/events/scheduled-jobs.ts) which simply calls the
-- SECURITY DEFINER functions below. Putting the state transition
-- + outbox emission in a single SQL function gives us:
--
--   - Atomicity: the state flip and the outbox insert commit
--     together. If the emission fails, the transition is rolled
--     back and the next tick retries.
--   - RLS bypass: the worker calls these functions as service_role
--     but the SECURITY DEFINER owner is migration 11's grant
--     (postgres, who already owns the function body). This
--     avoids having to grant the worker direct write on
--     review_schedules / planner_tasks / backlog_items.
--   - Determinism: idempotency on the emitted events is enforced
--     by uq_event_outbox_idem (user_id, event_type, idempotency_key).
--     The idempotency_key is sha256('review.started'|'review_schedule'|
--     <schedule_id>|1) so a second call within the same version is
--     a no-op on the outbox. To make repeated runs SAFE (the same
--     function may be called every 5 min), the state filter
--     'state = scheduled' (or 'state = planned' for tasks) ensures
--     the transition only fires once per row.
--
-- Audit: the scheduler still writes one 'system.tick' event per
-- run so the existing worker/handler contract records the
-- tick in event_log. The functions below emit the domain events;
-- the scheduler separately emits the audit event.
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- 1. mark_due_reviews()
--    Transition due reviews and emit a 'review.started' event
--    for each row whose state transitions from 'scheduled' to
--    'due'. Idempotent: subsequent calls find no rows in
--    state='scheduled' that are also due.
--
-- Returns: set of (schedule_id, event_id) for every row that
--          transitioned on this call. Empty if nothing was due.
-- -------------------------------------------------------------
create or replace function public.mark_due_reviews()
returns table(schedule_id uuid, event_id text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
  v_event_id text;
  v_idem_key text;
begin
  for v_row in
    select rs.id, rs.user_id, rs.error_id, rs.due_at
      from public.review_schedules rs
     where rs.state = 'scheduled'
       and rs.due_at <= now()
     order by rs.due_at asc
     for update skip locked
  loop
    -- 1. Flip the state. The set_updated_at trigger refreshes updated_at.
    update public.review_schedules
       set state = 'due'
     where id = v_row.id;

    -- 2. Emit the event. event_id and idempotency_key are derived
    --    from the same formula used by the worker's project_progress_evidence
    --    family: sha256('event_type'|'aggregate_type'|'aggregate_id'|'version').
    v_event_id := encode(public.digest(
      'review.started|review_schedule|' || v_row.id::text || '|1', 'sha256'), 'hex');
    v_idem_key := v_event_id;

    insert into public.event_outbox
      (event_id, event_type, schema_version, user_id, actor_id,
       aggregate_type, aggregate_id, aggregate_version, payload,
       idempotency_key, occurred_at)
    values
      (v_event_id, 'review.started', 1, v_row.user_id, null,
       'review_schedule', v_row.id::text, 1,
       jsonb_build_object(
         'schedule_id', v_row.id,
         'error_id', v_row.error_id,
         'previous_state', 'scheduled'
       ),
       v_idem_key, now())
    on conflict (user_id, event_type, idempotency_key) do nothing;

    return next;
  end loop;
end;
$$;

comment on function public.mark_due_reviews() is
  'Scheduled job: for every review_schedules row with state=scheduled and due_at<=now(), transition to state=due and emit a ''review.started'' event. Idempotent on (user_id, ''review.started'', idempotency_key).';

-- -------------------------------------------------------------
-- 2. detect_missed_tasks()
--    Transition tasks from 'planned' to 'missed' for the
--    7-day lookback window (per PHASE3_PLAN §6.3 #5), create a
--    backlog_items row for each transition, and emit a
--    'task.missed' event. Idempotent: subsequent calls find no
--    rows in state='planned' inside the window.
--
-- Returns: set of (task_id, backlog_item_id, event_id) for every
--          row that transitioned on this call.
-- -------------------------------------------------------------
create or replace function public.detect_missed_tasks()
returns table(task_id uuid, backlog_item_id uuid, event_id text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
  v_backlog_id uuid;
  v_event_id text;
  v_idem_key text;
begin
  for v_row in
    select pt.id, pt.user_id, pt.plan_date, pt.subject_id
      from public.planner_tasks pt
     where pt.state = 'planned'
       and pt.plan_date < (now() at time zone 'UTC')::date
       and pt.plan_date >= ((now() at time zone 'UTC')::date - interval '7 days')::date
     order by pt.plan_date asc
     for update skip locked
  loop
    -- 1. Flip the task state. The set_updated_at trigger refreshes updated_at.
    update public.planner_tasks
       set state = 'missed'
     where id = v_row.id;

    -- 2. Create a backlog_items row. reason='missed', state='open'.
    insert into public.backlog_items (user_id, source_task_id, reason, state)
      values (v_row.user_id, v_row.id, 'missed', 'open')
      returning id into v_backlog_id;

    -- 3. Emit the event. Same deterministic-hash idempotency
    --    contract as mark_due_reviews.
    v_event_id := encode(public.digest(
      'task.missed|planner_task|' || v_row.id::text || '|1', 'sha256'), 'hex');
    v_idem_key := v_event_id;

    insert into public.event_outbox
      (event_id, event_type, schema_version, user_id, actor_id,
       aggregate_type, aggregate_id, aggregate_version, payload,
       idempotency_key, occurred_at)
    values
      (v_event_id, 'task.missed', 1, v_row.user_id, null,
       'planner_task', v_row.id::text, 1,
       jsonb_build_object(
         'task_id', v_row.id,
         'plan_date', v_row.plan_date,
         'subject_id', v_row.subject_id
       ),
       v_idem_key, now())
    on conflict (user_id, event_type, idempotency_key) do nothing;

    return next;
  end loop;
end;
$$;

comment on function public.detect_missed_tasks() is
  'Scheduled job: for every planner_tasks row with state=planned and plan_date in the 7-day lookback window (today - 7 days <= plan_date < today), transition to state=missed, create a backlog_items row (reason=missed, state=open), and emit a ''task.missed'' event. Idempotent on (user_id, ''task.missed'', idempotency_key).';

-- -------------------------------------------------------------
-- 3. Grants. The functions are SECURITY DEFINER, so the grant
--    is to the role the API service-role client runs as.
--    In Supabase that role is `service_role`; in plain Postgres
--    tests it is the user running the migration (usually
--    `postgres`). We grant to both, idempotently.
-- -------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mark_due_reviews() to service_role;
    grant execute on function public.detect_missed_tasks() to service_role;
  end if;
exception when others then
  -- no-op; the function owner is the migration runner and that
  -- role can already execute.
  null;
end;
$$;
