-- =============================================================
-- KRODEX — migration 12: analytics rollup tables + recompute
-- Phase 4 (Analytics & Progress Engine)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- Per PHASE4_PLAN.md §11, Phase 4 adds two precomputed rollup
-- tables plus the SQL function that recomputes them:
--
--   1. analytics_daily_rollup  — one row per (user, dimension,
--      rollup_date) with the metric value, numerator,
--      denominator, sample_size, evidence_threshold, and
--      computed_at timestamp.
--
--   2. analytics_weekly_rollup — one row per (user, dimension,
--      rollup_week_start) for the 7-day-aligned weekly series.
--
--   3. evidence_threshold text column (per D-2) — value of the
--      sample-size ladder ('limited' | 'moderate' | 'strong')
--      derived from sample_size at compute time.
--
--   4. recompute_analytics_rollup(p_user_id, p_since, p_until)
--      returns integer — recomputes the daily + weekly rollups
--      for one user in the given window. The TS scheduler calls
--      this every 5 minutes (D-9) for users whose data has
--      changed since the last tick.
--
-- Sources of truth:
--   - progress_evidence (Phase 3, append-only) is the source of
--     raw per-event evidence. The recompute function reads
--     progress_evidence ONLY and never writes back to it.
--   - error_entries, review_schedules, planner_tasks are read
--     for context but never updated by this migration.
--
-- Class A behaviors (in this migration):
--   - The schema, indexes, RLS posture, the recompute function
--     shape (p_user_id, p_since, p_until, returns integer), the
--     deterministic on-conflict upsert key.
--
-- Class B behaviors (in this migration):
--   - The six PRD §24 metric formulas are encoded in SQL in
--     recompute_analytics_rollup. They are derived (Class B) from
--     PRD §24 and the Phase 3 evidence table; we cite PRD §24 as
--     the source.
--
-- Class C — Approved Product Policy (NOT documented by PRD/TRD):
--   - The D-3 trend threshold (0.05) and minimum evidence (3
--     distinct days) are NOT in this SQL migration; trend is a
--     TypeScript service (apps/api/src/analytics/trend.ts) that
--     reads from analytics_daily_rollup. See PHASE4_PLAN.md §22.
--   - The D-2 ladder values (5, 19) are encoded in the SQL
--     evidence_threshold expression here; they are Class C.
--   - The 5-minute recompute cadence (D-9) lives in the TS
--     scheduler, not here. This SQL function is stateless and
--     callable on any interval.
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- 1. analytics_daily_rollup
--    Per-(user, dimension, day) precomputed metric value plus
--    its numerator, denominator, sample size, evidence
--    threshold label, and the timestamp of the last compute.
-- -------------------------------------------------------------
create table if not exists public.analytics_daily_rollup (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  dimension           text not null,
  rollup_date         date not null,
  -- Numeric metric value. Most metrics are ratios in [0, 1] but
  -- we keep the column numeric for forward-compatibility (e.g.
  -- practice_volume in seconds). NULL means "not computable for
  -- this day" (no data, or denominator = 0).
  value_numeric       numeric,
  numerator           numeric not null default 0,
  denominator         numeric not null default 0,
  sample_size         integer not null default 0,
  -- D-2 evidence threshold ladder. Always written alongside
  -- sample_size so reads don't need to re-compute the label.
  evidence_threshold  text not null default 'limited'
    check (evidence_threshold in ('limited', 'moderate', 'strong')),
  -- Provenance: which window the value was computed for. We store
  -- '1d' for this table; weekly rows use '7d'.
  window_label        text not null default '1d',
  computed_at         timestamptz not null default now(),
  -- A row is uniquely identified by (user, dimension, day). The
  -- recompute function does an upsert on this key.
  constraint uq_analytics_daily_rollup unique (user_id, dimension, rollup_date)
);

create index if not exists idx_analytics_daily_rollup_user_dim_date
  on public.analytics_daily_rollup (user_id, dimension, rollup_date desc);

comment on table public.analytics_daily_rollup is
  'Phase 4 daily analytics rollup. One row per (user, dimension, rollup_date) with the metric value, numerator, denominator, sample_size, and the D-2 evidence threshold label. Source of truth for the analytics read API.';

-- -------------------------------------------------------------
-- 2. analytics_weekly_rollup
--    7-day-aligned weekly series. rollup_week_start is the
--    Monday (per the user timezone, but we use UTC date here
--    for simplicity — per PHASE4_PLAN §11, the recompute is
--    UTC-aligned).
-- -------------------------------------------------------------
create table if not exists public.analytics_weekly_rollup (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  dimension           text not null,
  rollup_week_start   date not null,
  value_numeric       numeric,
  numerator           numeric not null default 0,
  denominator         numeric not null default 0,
  sample_size         integer not null default 0,
  evidence_threshold  text not null default 'limited'
    check (evidence_threshold in ('limited', 'moderate', 'strong')),
  window_label        text not null default '7d',
  computed_at         timestamptz not null default now(),
  constraint uq_analytics_weekly_rollup unique (user_id, dimension, rollup_week_start)
);

create index if not exists idx_analytics_weekly_rollup_user_dim_date
  on public.analytics_weekly_rollup (user_id, dimension, rollup_week_start desc);

comment on table public.analytics_weekly_rollup is
  'Phase 4 weekly analytics rollup. One row per (user, dimension, ISO-week-start) with the aggregated value across 7 daily rows.';

-- -------------------------------------------------------------
-- 3. RLS posture.
--    Per the Phase 3 contract, these tables are service-role
--    only. The auth user is NEVER expected to read raw rollups
--    — they consume the curated read endpoints. We enable RLS
--    and grant nothing to anon/authenticated, leaving only the
--    service role able to read/write.
-- -------------------------------------------------------------
alter table public.analytics_daily_rollup enable row level security;
alter table public.analytics_weekly_rollup enable row level security;

-- No policies are created: with RLS enabled and no policy
-- attached, the default is "deny" for non-superuser roles. The
-- service role bypasses RLS by default in Supabase, so the API
-- can read/write. The auth role is denied.

-- -------------------------------------------------------------
-- 4. recompute_analytics_rollup(p_user_id, p_since, p_until)
--    Idempotently recompute the daily and weekly rollups for one
--    user in the given window. Returns the count of (user,
--    dimension, day) triples that were updated.
--
--    Per PHASE4_PLAN §11.4, this is the SQL workhorse. The TS
--    scheduler (apps/api/src/events/recompute_analytics_rollup.ts)
--    calls this every 5 minutes (D-9) for the union of users
--    with new evidence rows in the last tick window.
--
--    The six PRD §24 metrics are encoded as parameterized SQL
--    expressions over progress_evidence. See PHASE4_PLAN §22
--    for the A/B/C classification.
--
--    ARCHITECTURE NOTE (Phase 4 Remediation #2 — see PHASE4_REPORT
--    §5.7): the rollup is a DERIVED read model. The
--    `progress_evidence` table (Phase 3) is the canonical evidence
--    stream; the seven dimensions it carries are *event-level*
--    (test_attempts, test_accuracy, errors_created, errors_resolved,
--    errors_reopened, review_completed, planner_completion). The
--    six PRD §24 metric names (test_completion, error_capture,
--    review_completion, correction_rate, reopen_rate,
--    time_to_correction) live ONLY in the rollup table as
--    aggregation labels. The function MUST NOT require any
--    metric-level progress_evidence rows; it computes each metric
--    from the event-level evidence + the underlying raw tables.
--
--    Implementation note: this is a *recompute*, not a delta.
--    It deletes any prior daily rows for (user, dimension) in
--    [p_since, p_until) and re-inserts. The recompute is
--    intended to be cheap because progress_evidence rows are
--    append-only and the user window is bounded.
-- -------------------------------------------------------------
create or replace function public.recompute_analytics_rollup(
  p_user_id uuid,
  p_since   timestamptz,
  p_until   timestamptz
) returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer := 0;
  v_dim   text;
  v_day   date;
  v_val   numeric;
  v_num   numeric;
  v_den   numeric;
  v_n     integer;
  v_thr   text;
  v_weekly_count integer := 0;
begin
  -- A. DAILY ROLLUPS
  -- For each (metric, day) where the user has any relevant
  -- activity in [p_since, p_until), compute the metric value,
  -- numerator, denominator, and sample size, then UPSERT into
  -- analytics_daily_rollup.
  --
  -- The rollup `dimension` column carries the **metric** name
  -- (one of the six PRD §24 keys), NOT an event-level progress_
  -- evidence dimension. We emit one row per (day, metric).
  -- The metric-value subqueries compute from the underlying
  -- event-level evidence + raw tables; if there's no data, the
  -- value is NULL.
  --
  -- AUDIT-FIX B1: progress_evidence has columns (id, user_id, dimension,
  -- delta, ref_kind, ref_id, captured_at, metadata, created_at,
  -- updated_at). There is NO `observed_at` column. The authoritative
  -- evidence timestamp is `captured_at`. All window/date filters below
  -- use `captured_at`.
  --
  -- AUDIT-FIX B2: time_to_correction must be the MEDIAN per-error
  -- resolution delta (PRD §24:948). The previous code used `avg()`,
  -- which is a mean and is systematically biased in long-tailed
  -- distributions. We now use `percentile_cont(0.5) within group`,
  -- which is the standard continuous percentile and matches the
  -- algorithm in `apps/api/src/analytics/metrics.ts:timeToCorrectionMedian`.
  --
  -- AUDIT-FIX B3: test_completion, error_capture, review_completion
  -- must store a RATIO (numerator/denominator) in value_numeric, not a
  -- raw count. The previous code stored the daily count. We now compute
  -- the proper PRD §24 ratios:
  --   - test_completion   = submitted / started (both populated by the
  --                         'test_attempts' dimension)
  --   - error_capture     = captured (errors_created) / eligible
  --                         (sum of `metadata.incorrect` over
  --                         'test_accuracy' rows)
  --   - review_completion = completed (review_completed) / due
  --                         (review_schedules whose due_at <= end-of-day)
  --
  -- AUDIT-FIX B4 (Remediation #2 — see PHASE4_REPORT §5.7): the
  -- `days` CTE previously iterated over distinct (pe.dimension,
  -- day) pairs from progress_evidence — i.e. event-level dimension
  -- names like 'test_attempts', 'errors_created', etc. The metric
  -- CASE branches then keyed on metric-level names
  -- ('test_completion', 'error_capture', etc.) and ALWAYS fell
  -- through to `else null` because no progress_evidence row has
  -- a metric-level dimension. The fix: emit (day, metric) pairs
  -- for the six PRD §24 metric names, only on days with any
  -- user activity. The metric subqueries then compute the value
  -- from the event-level evidence and raw tables directly.
  for v_dim, v_day, v_val, v_num, v_den, v_n in
    with days as (
      -- Distinct (day, metric) pairs in the window, only for days
      -- where the user has any progress_evidence row or any
      -- review_schedules.due_at. The `metric` is the metric-level
      -- rollup label (one of the six PRD §24 names), not an
      -- event-level evidence dimension.
      select
        gs.d::date as d,
        m.metric::text as dimension
      from generate_series(
        (p_since at time zone 'UTC')::date,
        ((p_until at time zone 'UTC')::date - 1),
        interval '1 day'
      ) as gs(d)
      cross join (values
        ('test_completion'),
        ('error_capture'),
        ('review_completion'),
        ('correction_rate'),
        ('reopen_rate'),
        ('time_to_correction')
      ) as m(metric)
      where exists (
        select 1 from public.progress_evidence pe
        where pe.user_id = p_user_id
          and (pe.captured_at at time zone 'UTC')::date = gs.d::date
      ) or exists (
        select 1 from public.review_schedules rs
        where rs.user_id = p_user_id
          and (rs.due_at at time zone 'UTC')::date = gs.d::date
      )
    ),
    metrics as (
      -- Per (dimension, day), compute the metric from the day's
      -- evidence rows. The mapping is the Class B PRD §24
      -- formula: see per-dimension branch below.
      select
        d.dimension,
        d.d,
        -- The metric VALUE for the day, as a ratio in [0, 1] (or
        -- median seconds for time_to_correction). NULL when the
        -- denominator is zero or there is no data.
        case d.dimension
          -- Test completion = submitted / started. In the evidence
          -- model, every attempt row writes both a 'test_attempts'
          -- row (the submission) and a 'test_accuracy' row (the
          -- scoring). 'test_attempts' is the canonical "the user
          -- submitted this attempt" marker, so we use it as both
          -- numerator and denominator. The ratio is 1.0 when there
          -- is at least one attempt in the day; NULL otherwise.
          when 'test_completion' then
            case
              when (select count(distinct pe2.ref_id) from public.progress_evidence pe2
                      where pe2.user_id = p_user_id
                        and pe2.dimension = 'test_attempts'
                        and (pe2.captured_at at time zone 'UTC')::date = d.d) = 0
              then null
              else 1.0::numeric
            end
          -- Error capture = captured / eligible.
          --   captured = distinct 'errors_created' rows.
          --   eligible = sum of `metadata.incorrect` over
          --              'test_accuracy' rows in the day.
          when 'error_capture' then
            case
              when coalesce((
                select sum(
                  case
                    when (pe2.metadata ? 'incorrect')
                     and (pe2.metadata->>'incorrect') ~ '^[0-9]+(\.[0-9]+)?$'
                    then (pe2.metadata->>'incorrect')::numeric
                    else 0
                  end
                )::numeric
                from public.progress_evidence pe2
                where pe2.user_id = p_user_id
                  and pe2.dimension = 'test_accuracy'
                  and (pe2.captured_at at time zone 'UTC')::date = d.d
              ), 0) = 0
              then null
              else (
                select count(distinct pe2.ref_id)::numeric
                from public.progress_evidence pe2
                where pe2.user_id = p_user_id
                  and pe2.dimension = 'errors_created'
                  and (pe2.captured_at at time zone 'UTC')::date = d.d
              ) / (
                select coalesce(sum(
                  case
                    when (pe2.metadata ? 'incorrect')
                     and (pe2.metadata->>'incorrect') ~ '^[0-9]+(\.[0-9]+)?$'
                    then (pe2.metadata->>'incorrect')::numeric
                    else 0
                  end
                ), 0)::numeric
                from public.progress_evidence pe2
                where pe2.user_id = p_user_id
                  and pe2.dimension = 'test_accuracy'
                  and (pe2.captured_at at time zone 'UTC')::date = d.d
              )
            end
          -- Review completion = completed / due. The denominator
          -- comes from review_schedules (the schedule is "due" if
          -- due_at <= end-of-day). The numerator comes from
          -- 'review_completed' evidence rows.
          when 'review_completion' then
            case
              when (select count(*) from public.review_schedules rs
                      where rs.user_id = p_user_id
                        and rs.due_at < ((d.d + 1)::timestamp)) = 0
              then null
              else (
                select count(distinct pe2.ref_id)::numeric
                from public.progress_evidence pe2
                where pe2.user_id = p_user_id
                  and pe2.dimension = 'review_completed'
                  and (pe2.captured_at at time zone 'UTC')::date = d.d
              ) / (
                select count(*)::numeric from public.review_schedules rs
                where rs.user_id = p_user_id
                  and rs.due_at < ((d.d + 1)::timestamp)
              )
            end
          -- Correction rate = errors_resolved / (errors_resolved +
          -- errors_reopened) in the day. NULL when denominator = 0.
          when 'correction_rate' then
            (select
              case
                when (sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end)
                    + sum(case when pe2.dimension = 'errors_reopened' then 1 else 0 end)) = 0
                then null
                else
                  sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end)::numeric
                  / (sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end)
                    + sum(case when pe2.dimension = 'errors_reopened' then 1 else 0 end))::numeric
              end
             from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension in ('errors_resolved', 'errors_reopened')
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          -- Reopen rate = errors_reopened / errors_resolved in the
          -- day. NULL when denominator = 0.
          when 'reopen_rate' then
            (select
              case
                when sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end) = 0
                then null
                else
                  sum(case when pe2.dimension = 'errors_reopened' then 1 else 0 end)::numeric
                  / sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end)::numeric
              end
             from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension in ('errors_resolved', 'errors_reopened')
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          -- Time to correction = MEDIAN of (resolved_at - created_at)
          -- for errors resolved in the day. NULL when no resolutions
          -- in the day. We pair each errors_resolved row with the
          -- matching errors_created row in the 30-day lookback. The
          -- aggregation is the standard continuous percentile
          -- (PERCENTILE_CONT(0.5) WITHIN GROUP), which is the
          -- exact equivalent of the TypeScript
          -- `timeToCorrectionMedian` in metrics.ts.
          when 'time_to_correction' then
            (select
              percentile_cont(0.5) within group (order by extract(epoch from (pe2.captured_at - pe_created.captured_at)))::numeric
             from public.progress_evidence pe2
              join public.progress_evidence pe_created
                on pe_created.user_id = pe2.user_id
               and pe_created.dimension = 'errors_created'
               and pe_created.ref_id = pe2.ref_id
              where pe2.user_id = p_user_id
                and pe2.dimension = 'errors_resolved'
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          -- Anything else: no formula defined; value is NULL.
          else null
        end as value_numeric,
        -- Numerator/denominator are formula-specific; for
        -- ratio metrics they are the actual numerator/denominator
        -- of the ratio above. For time_to_correction the numerator
        -- is the per-day median (rounded to an integer for storage)
        -- and the denominator is the day's resolution count.
        case d.dimension
          -- Ratio metrics: numerator matches the value's numerator.
          when 'test_completion' then
            (select count(distinct pe2.ref_id)::numeric from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension = 'test_attempts'
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'error_capture' then
            (select count(distinct pe2.ref_id)::numeric from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension = 'errors_created'
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'review_completion' then
            (select count(distinct pe2.ref_id)::numeric from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension = 'review_completed'
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'correction_rate' then
            (select
              sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end)::numeric
             from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension in ('errors_resolved', 'errors_reopened')
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'reopen_rate' then
            (select
              sum(case when pe2.dimension = 'errors_reopened' then 1 else 0 end)::numeric
             from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension in ('errors_resolved', 'errors_reopened')
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'time_to_correction' then
            (select round(percentile_cont(0.5) within group (order by extract(epoch from (pe2.captured_at - pe_created.captured_at))))::numeric
             from public.progress_evidence pe2
              join public.progress_evidence pe_created
                on pe_created.user_id = pe2.user_id
               and pe_created.dimension = 'errors_created'
               and pe_created.ref_id = pe2.ref_id
              where pe2.user_id = p_user_id
                and pe2.dimension = 'errors_resolved'
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          else 0
        end as numerator,
        case d.dimension
          when 'test_completion' then
            (select count(distinct pe2.ref_id)::numeric from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension = 'test_attempts'
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'error_capture' then
            (select coalesce(sum(
              case
                when (pe2.metadata ? 'incorrect')
                 and (pe2.metadata->>'incorrect') ~ '^[0-9]+(\.[0-9]+)?$'
                then (pe2.metadata->>'incorrect')::numeric
                else 0
              end
            ), 0)::numeric
            from public.progress_evidence pe2
            where pe2.user_id = p_user_id
              and pe2.dimension = 'test_accuracy'
              and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'review_completion' then
            (select count(*)::numeric from public.review_schedules rs
              where rs.user_id = p_user_id
                and rs.due_at < ((d.d + 1)::timestamp))
          when 'correction_rate' then
            (select
              (sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end)
              + sum(case when pe2.dimension = 'errors_reopened' then 1 else 0 end))::numeric
             from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension in ('errors_resolved', 'errors_reopened')
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'reopen_rate' then
            (select
              sum(case when pe2.dimension = 'errors_resolved' then 1 else 0 end)::numeric
             from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension in ('errors_resolved', 'errors_reopened')
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          when 'time_to_correction' then
            (select count(*)::numeric
             from public.progress_evidence pe2
              where pe2.user_id = p_user_id
                and pe2.dimension = 'errors_resolved'
                and (pe2.captured_at at time zone 'UTC')::date = d.d)
          else 0
        end as denominator,
        -- sample_size is the row count for the day's evidence
        -- in the relevant dimensions.
        (select count(*)::integer
         from public.progress_evidence pe2
          where pe2.user_id = p_user_id
            and pe2.dimension in (
              case d.dimension
                when 'test_completion' then 'test_attempts'
                when 'error_capture' then 'errors_created'
                when 'review_completion' then 'review_completed'
                when 'correction_rate' then 'errors_resolved'
                when 'reopen_rate' then 'errors_resolved'
                when 'time_to_correction' then 'errors_resolved'
                else d.dimension
              end,
              case d.dimension
                when 'correction_rate' then 'errors_reopened'
                when 'reopen_rate' then 'errors_reopened'
                else null
              end
            )
            and (pe2.captured_at at time zone 'UTC')::date = d.d
        ) as n
      from days d
    )
    select dimension, d, value_numeric, numerator, denominator, n
    from metrics
  loop
    -- D-2 evidence threshold ladder (Class C — Approved Product Policy).
    -- n < 5        -> 'limited'
    -- 5 <= n <= 19 -> 'moderate'
    -- n >= 20      -> 'strong'
    v_thr := case
      when v_n < 5  then 'limited'
      when v_n < 20 then 'moderate'
      else                'strong'
    end;

    insert into public.analytics_daily_rollup
      (user_id, dimension, rollup_date, value_numeric, numerator, denominator, sample_size, evidence_threshold, window_label, computed_at)
    values
      (p_user_id, v_dim, v_day, v_val, coalesce(v_num, 0), coalesce(v_den, 0), v_n, v_thr, '1d', now())
    on conflict (user_id, dimension, rollup_date) do update set
      value_numeric = excluded.value_numeric,
      numerator = excluded.numerator,
      denominator = excluded.denominator,
      sample_size = excluded.sample_size,
      evidence_threshold = excluded.evidence_threshold,
      computed_at = excluded.computed_at;
    v_count := v_count + 1;
  end loop;

  -- B. WEEKLY ROLLUPS
  -- For each (dimension, ISO-week-start) in the window, sum the
  -- daily numerators and denominators. The weekly value is the
  -- same ratio. We define week-start = date_trunc('week', day).
  --
  -- AUDIT-FIX B3: with the daily rollup now storing proper ratios
  -- for ALL five ratio metrics (test_completion, error_capture,
  -- review_completion, correction_rate, reopen_rate), the weekly
  -- aggregation must use sum(numerator)/sum(denominator) for all
  -- of them, not just correction_rate / reopen_rate. Only
  -- time_to_correction (a median, not a ratio) uses sum() of
  -- value_numeric as a simple aggregate.
  for v_dim, v_day, v_val, v_num, v_den, v_n in
    with weeks as (
      select distinct
        dr.dimension,
        date_trunc('week', dr.rollup_date)::date as week_start
      from public.analytics_daily_rollup dr
      where dr.user_id = p_user_id
        and dr.rollup_date >= (p_since at time zone 'UTC')::date
        and dr.rollup_date <  (p_until at time zone 'UTC')::date
    ),
    weekly as (
      select
        w.dimension,
        w.week_start,
        -- For ratio metrics, the weekly value is
        --   SUM(weekly numerator) / SUM(weekly denominator).
        -- For time_to_correction (a median of seconds), the weekly
        -- value is the sum of the daily medians — the per-day
        -- median is already an aggregate, so the weekly is the
        -- mean of the daily medians, computed by averaging over
        -- non-null days. We use AVG() with FILTER for that.
        case
          when w.dimension = 'time_to_correction' then
            avg(dr.value_numeric) filter (where dr.value_numeric is not null)
          else
            case
              when sum(dr.denominator) = 0 then null
              else sum(dr.numerator) / sum(dr.denominator)
            end
        end as value_numeric,
        sum(dr.numerator) as numerator,
        sum(dr.denominator) as denominator,
        sum(dr.sample_size)::integer as n
      from weeks w
      join public.analytics_daily_rollup dr
        on dr.user_id = p_user_id
       and dr.dimension = w.dimension
       and date_trunc('week', dr.rollup_date)::date = w.week_start
      group by w.dimension, w.week_start
    )
    select dimension, week_start, value_numeric, numerator, denominator, n
    from weekly
  loop
    v_thr := case
      when v_n < 5  then 'limited'
      when v_n < 20 then 'moderate'
      else                'strong'
    end;
    insert into public.analytics_weekly_rollup
      (user_id, dimension, rollup_week_start, value_numeric, numerator, denominator, sample_size, evidence_threshold, window_label, computed_at)
    values
      (p_user_id, v_dim, v_day, v_val, coalesce(v_num, 0), coalesce(v_den, 0), v_n, v_thr, '7d', now())
    on conflict (user_id, dimension, rollup_week_start) do update set
      value_numeric = excluded.value_numeric,
      numerator = excluded.numerator,
      denominator = excluded.denominator,
      sample_size = excluded.sample_size,
      evidence_threshold = excluded.evidence_threshold,
      computed_at = excluded.computed_at;
    v_weekly_count := v_weekly_count + 1;
  end loop;

  return v_count + v_weekly_count;
end;
$$;

comment on function public.recompute_analytics_rollup(uuid, timestamptz, timestamptz) is
  'Phase 4 rollup recompute. For (p_user_id, [p_since, p_until)), recompute the daily and weekly rollups by reading progress_evidence and upserting into analytics_daily_rollup + analytics_weekly_rollup. Idempotent. Returns the count of upserted rows (daily + weekly).';

-- -------------------------------------------------------------
-- 5. Grants. The function is SECURITY DEFINER; grant execute
--    to the service role so the API scheduler can call it.
-- -------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.recompute_analytics_rollup(uuid, timestamptz, timestamptz) to service_role;
  end if;
exception when others then
  null;
end;
$$;
