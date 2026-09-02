-- =============================================================
-- KRODEX — migration 09: extend domain RPCs with outbox emission
-- Phase 3 (Event & Connectivity Layer)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- The Phase 3 event bus decouples the source mutation from its
-- projections. Producers write to event_outbox in the SAME
-- transaction as the source mutation, and the worker dispatches
-- asynchronously.
--
-- This migration extends two of the three existing Phase 2 RPCs
-- to also append an outbox row inside their transaction:
--
--   1. submit_test_attempt     -> 'attempt.submitted'
--   2. schedule_review_for_error -> 'review.scheduled'
--
-- The third RPC, record_progress_evidence, does NOT emit an event
-- on its own — the projection handler `project_progress_evidence`
-- is the canonical writer of evidence rows derived from domain
-- events, and the RPC + the handler share a unique constraint on
-- (user_id, dimension, ref_kind, ref_id) so the two can coexist
-- idempotently. See PHASE3_PLAN.md §13 decision 1.
--
-- All emitted payloads mirror the typed shape in
-- packages/shared/src/events/envelope.ts. The sha256 hex strings
-- for event_id and idempotency_key are derived inside Postgres
-- using the public.digest() helper (pgcrypto, see migration 02)
-- so the formula is identical to the one in the shared package's
-- computeEventId / computeIdempotencyKeyForEvent.
--
-- RLS posture: the event_outbox table is service_role only (no
-- policies = default deny for authenticated). These RPCs are
-- SECURITY INVOKER, so they run as the calling user; the
-- uq_event_outbox_idem unique index is what makes the call safe
-- for ordinary users without exposing the table to SELECT.
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- 1. submit_test_attempt -> attempt.submitted
-- -------------------------------------------------------------
--
-- Emitted after the attempt row is graded and progress_evidence
-- rows are written. Payload fields:
--   - test_id, attempt_id, correct_count, incorrect_count,
--     partial_count, skipped_count, accuracy, duration_ms,
--     incorrect_question_ids (uuid[])
--
-- aggregate_type = 'attempt', aggregate_id = attempt_id,
-- aggregate_version = the new submitted attempt row's
-- submitted_at-driven monotonic counter (we use the existing
-- count of test_attempts rows for this user as a poor-man's
-- version; the deterministic version comes from the
-- (test_id, attempt_id) pair in the payload).
--
-- We keep the aggregate_version = 1 for the first submission
-- (this is the "the attempt is now in the 'submitted' state"
-- event — there's exactly one per attempt). Future revisions of
-- the same attempt would be 'attempt.re_submitted' or similar.
-- -------------------------------------------------------------
create or replace function public.submit_test_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_attempt     public.test_attempts%rowtype;
  v_test        public.test_definitions%rowtype;
  v_scoring     jsonb;
  v_default_out text;
  v_by_type     jsonb;
  v_tol         numeric;
  v_q           record;
  v_answer      public.test_answers%rowtype;
  v_outcome     text;
  v_selected    jsonb;
  v_correct_ids jsonb;
  v_correct_count int := 0;
  v_incorrect_count int := 0;
  v_partial_count int := 0;
  v_skipped_count int := 0;
  v_denominator  int := 0;
  v_accuracy     numeric;
  v_started_at   timestamptz;
  v_duration_ms  int;
  v_error_id     uuid;
  v_incorrect_ids uuid[] := '{}'::uuid[];
  v_event_id     text;
  v_idem_key     text;
  v_occurred_at  timestamptz := now();
begin
  -- 1. Lock the attempt.
  select * into v_attempt
    from public.test_attempts
   where id = p_attempt_id
   for update;
  if not found then
    raise exception 'attempt not found: %', p_attempt_id
      using errcode = 'no_data_found';
  end if;
  if v_attempt.state <> 'in_progress' then
    raise exception 'attempt % is in state %; only in_progress attempts can be submitted',
      p_attempt_id, v_attempt.state
      using errcode = 'check_violation';
  end if;

  -- 2. Read the test definition and scoring config.
  select * into v_test
    from public.test_definitions
   where id = v_attempt.test_id;
  if not found then
    raise exception 'test definition % not found for attempt %',
      v_attempt.test_id, p_attempt_id
      using errcode = 'no_data_found';
  end if;
  v_scoring := coalesce(v_test.source_payload -> 'scoring', '{}'::jsonb);
  v_default_out := coalesce(v_scoring ->> 'defaultOutcome', 'incorrect');
  v_by_type := coalesce(v_scoring -> 'byQuestionType', '{}'::jsonb);
  v_tol := coalesce(nullif(v_scoring ->> 'numericTolerance', '')::numeric, 1e-9);

  -- 3. Ensure every attached question has a test_answers row.
  for v_q in
    select tq.question_id, q.question_type, q.marks_correct, q.marks_incorrect, q.prompt
      from public.test_questions tq
      join public.questions q on q.id = tq.question_id
     where tq.test_id = v_attempt.test_id
     order by tq.display_order
  loop
    select * into v_answer
      from public.test_answers
     where attempt_id = p_attempt_id and question_id = v_q.question_id;
    if not found then
      insert into public.test_answers
        (user_id, attempt_id, question_id, selected_option_ids, free_text, outcome, answered_at)
      values
        (v_attempt.user_id, p_attempt_id, v_q.question_id, '{}'::uuid[], null, 'skipped', now())
      returning * into v_answer;
    end if;
  end loop;

  -- 4. Grade each answer.
  for v_q in
    select tq.question_id, q.question_type, q.marks_correct, q.marks_incorrect
      from public.test_questions tq
      join public.questions q on q.id = tq.question_id
     where tq.test_id = v_attempt.test_id
     order by tq.display_order
  loop
    select * into v_answer
      from public.test_answers
     where attempt_id = p_attempt_id and question_id = v_q.question_id
     for update;

    v_outcome := v_answer.outcome;

    -- Pre-graded outcomes (from the client) are accepted unless they
    -- contradict the locked rules. The grade below is authoritative.
    if v_q.question_type in ('comprehension', 'assertion_reason') then
      v_outcome := 'partial';
    elsif v_answer.outcome is null or v_answer.outcome = 'skipped' then
      v_outcome := 'skipped';
    else
      -- Look up per-type rule.
      declare
        v_rule jsonb;
        v_kind text;
        v_target numeric;
        v_actual numeric;
      begin
        v_rule := v_by_type -> v_q.question_type;
        if v_rule is null then
          v_outcome := v_default_out;
        else
          v_kind := coalesce(v_rule ->> 'kind', 'mcq_strict');
          if v_kind = 'mcq_strict' then
            -- Compare selected ids to the union of correct options.
            select coalesce(jsonb_agg(id), '[]'::jsonb) into v_correct_ids
              from public.question_options
             where question_id = v_q.question_id and is_correct;
            v_selected := to_jsonb(v_answer.selected_option_ids);
            if v_selected = v_correct_ids
               and jsonb_array_length(v_selected) > 0 then
              v_outcome := 'correct';
            elsif v_selected = '[]'::jsonb then
              v_outcome := 'skipped';
            else
              v_outcome := 'incorrect';
            end if;
          elsif v_kind = 'mcq_partial' then
            -- Multi-MCQ: full marks iff exact match; partial credit
            -- iff non-empty overlap; otherwise incorrect.
            select coalesce(jsonb_agg(id), '[]'::jsonb) into v_correct_ids
              from public.question_options
             where question_id = v_q.question_id and is_correct;
            v_selected := to_jsonb(v_answer.selected_option_ids);
            if v_selected = v_correct_ids and jsonb_array_length(v_selected) > 0 then
              v_outcome := 'correct';
            elsif v_selected = '[]'::jsonb then
              v_outcome := 'skipped';
            elsif (select count(*) from jsonb_array_elements(v_selected) s
                    where v_correct_ids @> jsonb_build_array(s)) > 0 then
              v_outcome := 'partial';
            else
              v_outcome := 'incorrect';
            end if;
          elsif v_kind = 'true_false' then
            -- Strict match against the unique correct option.
            declare
              v_correct_option_id uuid;
            begin
              select id into v_correct_option_id
                from public.question_options
               where question_id = v_q.question_id and is_correct
               limit 1;
              v_selected := to_jsonb(v_answer.selected_option_ids);
              if v_selected = '[]'::jsonb then
                v_outcome := 'skipped';
              elsif jsonb_array_length(v_selected) = 1
                 and (v_selected ->> 0)::uuid = v_correct_option_id then
                v_outcome := 'correct';
              else
                v_outcome := 'incorrect';
              end if;
            end;
          elsif v_kind = 'numerical' then
            -- Free-text numeric within tolerance. If free_text is
            -- null/blank => skipped. If it parses and matches the
            -- marks_correct value within tolerance => correct, else
            -- incorrect. No partial credit for numerics.
            if v_answer.free_text is null or length(trim(v_answer.free_text)) = 0 then
              v_outcome := 'skipped';
            else
              begin
                v_actual := v_answer.free_text::numeric;
                v_target := v_q.marks_correct::numeric;
                if abs(v_actual - v_target) <= v_tol then
                  v_outcome := 'correct';
                else
                  v_outcome := 'incorrect';
                end if;
              exception when others then
                v_outcome := 'incorrect';
              end;
            end if;
          elsif v_kind = 'short_answer' then
            -- Cannot grade without teacher/AI; record as partial and
            -- let a later review finalize (Decision 5 covers
            -- comprehension/assertion_reason; short_answer shares
            -- the same human-grading path).
            if v_answer.free_text is null or length(trim(v_answer.free_text)) = 0 then
              v_outcome := 'skipped';
            else
              v_outcome := 'partial';
            end if;
          else
            v_outcome := v_default_out;
          end if;
        end if;
      end;
    end if;

    -- Persist the outcome.
    update public.test_answers
       set outcome = v_outcome
     where id = v_answer.id;

    -- Tally counts.
    if v_outcome = 'correct' then v_correct_count := v_correct_count + 1;
    elsif v_outcome = 'incorrect' then
      v_incorrect_count := v_incorrect_count + 1;
      v_incorrect_ids := array_append(v_incorrect_ids, v_q.question_id);
    elsif v_outcome = 'partial' then v_partial_count := v_partial_count + 1;
    elsif v_outcome = 'skipped' then v_skipped_count := v_skipped_count + 1;
    end if;
  end loop;

  v_denominator := v_correct_count + v_incorrect_count + v_partial_count;
  if v_denominator = 0 then
    v_accuracy := 0;
  else
    v_accuracy := v_correct_count::numeric / v_denominator::numeric;
  end if;

  v_started_at := v_attempt.started_at;
  v_duration_ms :=
    case
      when v_started_at is null then null
      else extract(epoch from (now() - v_started_at)) * 1000
    end;

  -- 5. Update the attempt row.
  update public.test_attempts
     set state             = 'submitted',
         submitted_at      = now(),
         correct_count     = v_correct_count,
         incorrect_count   = v_incorrect_count,
         partial_count     = v_partial_count,
         skipped_count     = v_skipped_count,
         accuracy          = v_accuracy::text,
         duration_ms       = v_duration_ms
   where id = p_attempt_id
   returning * into v_attempt;

  -- 6. For every 'incorrect' answer, upsert an error_entries row.
  for v_q in
    select tq.question_id, q.subject_id, q.topic_id
      from public.test_questions tq
      join public.questions q on q.id = tq.question_id
      join public.test_answers a on a.attempt_id = p_attempt_id and a.question_id = tq.question_id
     where tq.test_id = v_attempt.test_id
       and a.outcome = 'incorrect'
  loop
    -- Upsert by (user_id, question_id). One error per question.
    insert into public.error_entries
      (user_id, question_id, status, source_attempt_id, last_seen_at, recurrence_count)
    values
      (v_attempt.user_id, v_q.question_id, 'active', p_attempt_id, now(), 1)
    on conflict (user_id, question_id) do update
      set last_seen_at      = excluded.last_seen_at,
          recurrence_count  = public.error_entries.recurrence_count + 1,
          status            = case
                                when public.error_entries.status in ('resolved', 'archived')
                                  then 'reopened'
                                else public.error_entries.status
                              end
    returning id into v_error_id;
    -- Maintain the link row.
    insert into public.error_question_links (error_id, question_id, user_id)
    values (v_error_id, v_q.question_id, v_attempt.user_id)
    on conflict do nothing;
  end loop;

  -- 7. Progress evidence + syllabus progress bump.
  for v_q in
    select q.subject_id, q.topic_id, q.sub_topic_id
      from public.test_questions tq
      join public.questions q on q.id = tq.question_id
     where tq.test_id = v_attempt.test_id
  loop
    -- Global subject-level bump.
    insert into public.progress_evidence
      (user_id, dimension, delta, ref_kind, ref_id, captured_at, metadata)
    values
      (v_attempt.user_id, 'test_attempts', 1, 'test_attempt', p_attempt_id, now(),
       jsonb_build_object('subject_id', v_q.subject_id))
    on conflict do nothing;
    insert into public.syllabus_progress
      (user_id, scope, scope_id, coverage_state, evidence_count, last_activity_at)
    values
      (v_attempt.user_id, 'subject', v_q.subject_id, 'in_progress', 1, now())
    on conflict (user_id, scope, scope_id) do update
      set evidence_count   = public.syllabus_progress.evidence_count + 1,
          last_activity_at = now();
  end loop;
  -- A single accuracy evidence row per attempt.
  insert into public.progress_evidence
    (user_id, dimension, delta, ref_kind, ref_id, captured_at, metadata)
  values
    (v_attempt.user_id, 'test_accuracy', v_accuracy, 'test_attempt', p_attempt_id, now(),
     jsonb_build_object('correct', v_correct_count, 'incorrect', v_incorrect_count,
                        'partial', v_partial_count, 'skipped', v_skipped_count))
  on conflict do nothing;

  -- 8. Mark the test definition completed if all attempts finished.
  update public.test_definitions
     set state = 'completed'
   where id = v_attempt.test_id
     and not exists (
       select 1 from public.test_attempts
        where test_id = v_attempt.test_id and state = 'in_progress'
     );

  -- 9. Phase 3 — emit 'attempt.submitted' into the outbox.
  --    eventId and idempotencyKey are sha256 hex strings derived
  --    from the same canonical input shape as the shared package's
  --    computeEventId/computeIdempotencyKeyForEvent helpers:
  --      sha256(event_type|aggregate_type|aggregate_id|version)
  --    on conflict (user_id, event_type, idempotency_key) do nothing
  --    so re-submitting the same attempt in a retry is a no-op.
  v_event_id := encode(public.digest(
    'attempt.submitted|attempt|' || p_attempt_id::text || '|1', 'sha256'), 'hex');
  v_idem_key := v_event_id;
  insert into public.event_outbox
    (event_id, event_type, schema_version, user_id, actor_id,
     aggregate_type, aggregate_id, aggregate_version, payload,
     idempotency_key, occurred_at)
  values
    (v_event_id, 'attempt.submitted', 1, v_attempt.user_id, v_attempt.user_id,
     'attempt', p_attempt_id::text, 1,
     jsonb_build_object(
       'test_id', v_attempt.test_id,
       'attempt_id', p_attempt_id,
       'correct_count', v_correct_count,
       'incorrect_count', v_incorrect_count,
       'partial_count', v_partial_count,
       'skipped_count', v_skipped_count,
       'accuracy', v_accuracy::text,
       'duration_ms', v_duration_ms,
       'incorrect_question_ids', to_jsonb(v_incorrect_ids)
     ),
     v_idem_key, v_occurred_at)
  on conflict (user_id, event_type, idempotency_key) do nothing;

  return to_jsonb(v_attempt);
end;
$$;

comment on function public.submit_test_attempt(uuid) is
  'Atomically grade a test attempt using the scoring config in test_definitions.source_payload->''scoring''. Inserts skipped rows, computes counts + accuracy, creates error_entries for incorrect answers, and appends progress_evidence. Emits an ''attempt.submitted'' event into event_outbox in the same transaction. See docs/PHASE2_GRADING_DECISIONS.md and docs/PHASE3_PLAN.md §6.';

-- -------------------------------------------------------------
-- 2. schedule_review_for_error -> review.scheduled
-- -------------------------------------------------------------
create or replace function public.schedule_review_for_error(
  p_error_id uuid,
  p_strategy text,
  p_due_at   timestamptz
) returns public.review_schedules
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_error public.error_entries%rowtype;
  v_row   public.review_schedules%rowtype;
  v_event_id text;
  v_idem_key text;
  v_occurred_at timestamptz := now();
begin
  if p_strategy not in ('standard', 'spaced', 'focused', 'retest_only') then
    raise exception 'invalid strategy %', p_strategy
      using errcode = 'invalid_parameter_value';
  end if;
  if p_due_at <= now() then
    raise exception 'due_at must be in the future'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_error from public.error_entries where id = p_error_id;
  if not found then
    raise exception 'error % not found', p_error_id
      using errcode = 'no_data_found';
  end if;

  insert into public.review_schedules
    (user_id, error_id, state, due_at, scheduled_at, strategy)
  values
    (v_error.user_id, p_error_id, 'scheduled', p_due_at, now(), p_strategy)
  returning * into v_row;

  -- Bump error status to in_review.
  if v_error.status = 'active' then
    update public.error_entries
       set status = 'in_review'
     where id = p_error_id;
  end if;

  -- Phase 3 — emit 'review.scheduled'. The aggregate_id is the
  -- schedule_id (each row in review_schedules gets exactly one
  -- 'review.scheduled' event in its lifetime). aggregate_version
  -- is 1.
  v_event_id := encode(public.digest(
    'review.scheduled|review_schedule|' || v_row.id::text || '|1', 'sha256'), 'hex');
  v_idem_key := v_event_id;
  insert into public.event_outbox
    (event_id, event_type, schema_version, user_id, actor_id,
     aggregate_type, aggregate_id, aggregate_version, payload,
     idempotency_key, occurred_at)
  values
    (v_event_id, 'review.scheduled', 1, v_error.user_id, v_error.user_id,
     'review_schedule', v_row.id::text, 1,
     jsonb_build_object(
       'schedule_id', v_row.id,
       'error_id', p_error_id,
       'strategy', p_strategy,
       'due_at', p_due_at
     ),
     v_idem_key, v_occurred_at)
  on conflict (user_id, event_type, idempotency_key) do nothing;

  return v_row;
end;
$$;

comment on function public.schedule_review_for_error(uuid, text, timestamptz) is
  'Create a review_schedules row for the given error, bump the error to in_review, and emit a ''review.scheduled'' event into event_outbox. Validates strategy and due_at.';

-- -------------------------------------------------------------
-- 3. helper view for handler-side use
-- -------------------------------------------------------------
--
-- A read-only view that joins an outbox row to its source
-- aggregate when the aggregate is a test_attempt. The worker
-- handlers can SELECT from this view to resolve the context
-- (e.g. "what is the test_id of this attempt?") without having
-- to redo the lookup themselves.
create or replace view public.event_outbox_attempt_context as
  select
    eo.event_id,
    eo.user_id,
    eo.payload,
    a.test_id,
    a.state as attempt_state
  from public.event_outbox eo
  join public.test_attempts a
    on a.id = (eo.payload ->> 'attempt_id')::uuid
 where eo.event_type = 'attempt.submitted';

comment on view public.event_outbox_attempt_context is
  'Read-only join of ''attempt.submitted'' outbox rows to their source test_attempts. Service-role only (joins event_outbox which is RLS-locked). Used by the worker handler emit_attempt_analyzed to enrich derived events.';
