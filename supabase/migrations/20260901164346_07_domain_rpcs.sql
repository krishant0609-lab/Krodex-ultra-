-- =============================================================
-- KRODEX — migration 07: domain RPCs
-- Phase 2 (Domain Services + API Contracts)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- Three RPCs implement the transactional units the API cannot
-- safely express via a single Supabase REST call. They are the only
-- "fat" code path Phase 2 introduces on the database side.
--
--   1. public.submit_test_attempt(p_attempt_id uuid)
--        Grading is governed by docs/PHASE2_GRADING_DECISIONS.md.
--        All grading happens inside a single transaction so the
--        attempt, its answers, the error entries, and the progress
--        evidence either all land or none do.
--
--   2. public.schedule_review_for_error(p_error_id uuid,
--                                       p_strategy  text,
--                                       p_due_at    timestamptz)
--        Creates a review_schedules row for the given error. The
--        strategy and due_at are validated here; the service layer
--        does the strategy selection.
--
--   3. public.record_progress_evidence(p_dimension text,
--                                       p_delta      numeric,
--                                       p_ref_kind   text,
--                                       p_ref_id     uuid,
--                                       p_metadata   jsonb default '{}'::jsonb)
--        Inserts a progress_evidence row and refreshes the matching
--        syllabus_progress.evidence_count / last_activity_at. Phase 4
--        will add the analytics rollup here too.
--
-- Why a Postgres function, not a Supabase Edge Function or API-side
-- loop? Because all three need to be atomic and they all need to
-- touch RLS-protected tables; the Supabase REST surface cannot do
-- both in a single round trip.
-- =============================================================

set search_path = public, extensions;

-- ------------------------------------------------------------
-- Ensure error_entries enforces "one error per (user, question)"
-- so the submit RPC can upsert cleanly. The Schema-Ready spec
-- (§7) states the same invariant at the application layer; the
-- UNIQUE makes it atomic.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'uq_error_entries_user_question'
       and conrelid = 'public.error_entries'::regclass
  ) then
    alter table public.error_entries
      add constraint uq_error_entries_user_question
      unique (user_id, question_id);
  end if;
end$$;

-- ============================================================
-- 1. submit_test_attempt
-- ============================================================
--
-- Grading contract: see docs/PHASE2_GRADING_DECISIONS.md.
--
-- Behaviour:
--   * Lock the test_attempts row FOR UPDATE so two concurrent submits
--     cannot race. If state != 'in_progress', raise.
--   * For every test_questions row attached to the test, ensure a
--     test_answers row exists (insert 'skipped' if not). [Decision 4]
--   * Grade each answer using the rule at
--     test_definitions.source_payload->'scoring'->'byQuestionType'.
--     Fallback is the per-test 'defaultOutcome' field. [Decisions 1, 2]
--   * comprehension and assertion_reason always resolve to 'partial'.
--     [Decision 5]
--   * Compute correct_count / incorrect_count / partial_count /
--     skipped_count and accuracy = correct / (c+i+p). [Decision 3]
--   * For every 'incorrect' answer, upsert an error_entries row and
--     an error_question_links row. [Decision 6]
--   * Update the test_attempts row to state='submitted' with the
--     computed counts and accuracy.
--   * For every question that carries a subject_id, append a
--     progress_evidence row (dimension = 'test_accuracy') and bump
--     the matching syllabus_progress.evidence_count.
--
-- Returns: the new test_attempts row as jsonb.
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
    elsif v_outcome = 'incorrect' then v_incorrect_count := v_incorrect_count + 1;
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

  return to_jsonb(v_attempt);
end;
$$;

comment on function public.submit_test_attempt(uuid) is
  'Atomically grade a test attempt using the scoring config in test_definitions.source_payload->''scoring''. Inserts skipped rows, computes counts + accuracy, creates error_entries for incorrect answers, and appends progress_evidence. Returns the updated attempt row. See docs/PHASE2_GRADING_DECISIONS.md.';

-- ============================================================
-- 2. schedule_review_for_error
-- ============================================================
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

  return v_row;
end;
$$;

comment on function public.schedule_review_for_error(uuid, text, timestamptz) is
  'Create a review_schedules row for the given error and bump the error to in_review. Validates strategy and due_at.';

-- ============================================================
-- 3. record_progress_evidence
-- ============================================================
create or replace function public.record_progress_evidence(
  p_dimension text,
  p_delta      numeric,
  p_ref_kind   text,
  p_ref_id     uuid,
  p_metadata   jsonb default '{}'::jsonb
) returns public.progress_evidence
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_user uuid := public.auth_uid();
  v_row  public.progress_evidence%rowtype;
  v_subject uuid;
  v_topic   uuid;
  v_sub_topic uuid;
begin
  if v_user is null then
    raise exception 'record_progress_evidence requires an authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  if p_dimension not in (
    'syllabus_coverage', 'test_accuracy', 'test_attempts',
    'errors_created', 'errors_resolved', 'errors_reopened',
    'review_completed', 'planner_completion', 'planner_backlog',
    'backlog_recovered', 'consistency', 'practice_volume', 'other'
  ) then
    raise exception 'unknown progress dimension %', p_dimension
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.progress_evidence
    (user_id, dimension, delta, ref_kind, ref_id, captured_at, metadata)
  values
    (v_user, p_dimension, p_delta, p_ref_kind, p_ref_id, now(), coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  -- If the ref_kind is a question, also bump the matching syllabus_progress.
  if p_ref_kind = 'question' then
    select subject_id, topic_id, sub_topic_id
      into v_subject, v_topic, v_sub_topic
      from public.questions
     where id = p_ref_id;
    if v_subject is not null then
      insert into public.syllabus_progress
        (user_id, scope, scope_id, coverage_state, evidence_count, last_activity_at)
      values
        (v_user, 'subject', v_subject, 'in_progress', 1, now())
      on conflict (user_id, scope, scope_id) do update
        set evidence_count   = public.syllabus_progress.evidence_count + 1,
            last_activity_at = now();
    end if;
  end if;

  return v_row;
end;
$$;

comment on function public.record_progress_evidence(text, numeric, text, uuid, jsonb) is
  'Append a progress_evidence row and (when ref_kind = question) bump the matching syllabus_progress. Auth via public.auth_uid().';
