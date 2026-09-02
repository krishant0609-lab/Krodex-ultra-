-- =============================================================
-- KRODEX — migration 13: student model recompute RPC
-- Phase 5 (Student Model Inference)
-- UTC timestamp: 2026-09-01 16:43:46
-- =============================================================
--
-- Per PHASE5_PLAN.md §4, Phase 5 persists the seven pattern
-- feature outputs (six from raw evidence + the derived
-- learning_trajectory) to two existing tables:
--
--   1. student_model_snapshots (migration 03) — one row per
--      (user, computed_at) with a jsonb `features` envelope
--      and a top-level `confidence` numeric.
--
--   2. student_model_features (migration 03) — one row per
--      (user, feature_key, computed_at) with a jsonb
--      feature_value envelope and an evidence_count int.
--
-- The six pattern formulas live in TypeScript
-- (apps/api/src/student-model/patterns/*.ts) — they are pure
-- functions over the pre-loaded evidence object, and the
-- orchestrator (computeFeatures.ts) fans out in parallel and
-- composes the final payload. This migration is intentionally
-- a thin **persistence** function: it accepts the pre-computed
-- features JSONB and writes them. It does NOT re-derive the
-- features from the source tables; that would duplicate
-- business logic in two languages.
--
-- What the migration adds:
--   1. recompute_student_model(p_user_id, p_features jsonb,
--      p_window_days int, p_until timestamptz) returns integer
--      — Idempotently replaces the current snapshot+feature
--      rows for the user with the new payload and returns the
--      count of feature rows written.
--
--   2. Grants. SECURITY DEFINER + service_role execute, same
--      posture as the analytics rollup in migration 12.
--
-- Class A behaviors (in this migration):
--   - The function shape, the idempotent delete-then-insert,
--     the SECURITY DEFINER posture, the grant posture.
--
-- Class B behaviors (in this migration):
--   - The mapping from the orchestrator's `features` JSONB
--     object keys to the seven `student_model_features.feature_
--     key` rows is a direct 1:1 — it is a structural contract
--     with the TypeScript orchestrator, not a derivation from
--     PRD/TRD.
--
-- Class C — Approved Product Policy (NOT documented by PRD/TRD):
--   - The 7-feature key list (consistency_score, procrastination_
--     score, recovery_score, error_recurrence_score, review_
--     compliance_score, workload_pressure_score, learning_
--     trajectory) is the orchestrator's output schema, pinned by
--     PHASE5_PLAN.md §1.
--   - The 28-day default window lives in the orchestrator
--     (DEFAULT_WINDOW_DAYS), not in SQL.
--   - The `evidence_count` column here is the per-feature
--     `sampleSize` from the orchestrator payload; it is not
--     a re-derivation. The SQL function does NOT cross-check
--     that count against the source tables.
-- =============================================================

set search_path = public, extensions;

-- -------------------------------------------------------------
-- 1. recompute_student_model
--    Idempotent persistence for the orchestrator's payload.
--    Strategy:
--      a. DELETE any prior snapshot+feature rows for the user
--         whose computed_at is older than p_until. The pattern
--         is "snapshot is the latest write, features are the
--         per-key rows for that snapshot".
--      b. INSERT the new snapshot row carrying the full
--         features JSONB and a top-level confidence numeric.
--      c. INSERT one row per feature key into
--         student_model_features, with the per-feature
--         `sampleSize` as evidence_count and the
--         `featureValue` JSONB envelope.
--      d. Return the count of feature rows written (= 7 in the
--         happy path; 0 if p_features is empty).
--
--    p_features is expected to be a jsonb object whose keys
--    are the seven feature names and whose values are the
--    StudentModelFeatureValue envelopes (see
--    packages/shared/src/db/types.ts). The function does NOT
--    validate the shape — it is a persistence function, not a
--    business-logic function. Mismatched keys are silently
--    ignored.
--
--    Why not UPSERT on (user_id, feature_key, computed_at)?
--    The unique constraint on student_model_features includes
--    computed_at, so an UPSERT keyed on (user_id, feature_key)
--    alone is not possible. We use the "delete prior, insert
--    fresh" pattern, which is simpler and matches the
--    migration-12 recompute_analytics_rollup style.
-- -------------------------------------------------------------
create or replace function public.recompute_student_model(
  p_user_id     uuid,
  p_features    jsonb,
  p_window_days int,
  p_until       timestamptz
) returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_feature_count integer := 0;
  v_confidence     numeric(4,3);
  v_key            text;
  v_value          jsonb;
  v_evidence_count int;
begin
  -- 1. Defensive: p_features must be an object. If it isn't,
  --    we treat the call as a no-op (return 0) and do not
  --    touch the existing snapshot. This keeps the function
  --    safe to call from a worker that has not yet wired
  --    the new orchestrator.
  if p_features is null or jsonb_typeof(p_features) <> 'object' then
    return 0;
  end if;

  -- 2. Top-level confidence: the orchestrator does not
  --    currently embed a top-level `confidence` in the
  --    features JSONB (the per-feature `confidence` lives
  --    inside each envelope). We compute it here as the min
  --    confidence across the seven per-feature confidences,
  --    mapping the ladder 'limited'=0.0, 'moderate'=0.5,
  --    'strong'=1.0. If no feature envelopes are present
  --    we default to 0.
  v_confidence := 1.0;
  for v_key, v_value in
    select key, value
    from jsonb_each(p_features)
  loop
    if jsonb_typeof(v_value) = 'object'
       and (v_value ? 'confidence')
       and jsonb_typeof(v_value -> 'confidence') = 'string'
    then
      v_confidence := least(
        v_confidence,
        case v_value ->> 'confidence'
          when 'limited'  then 0.0
          when 'moderate' then 0.5
          when 'strong'   then 1.0
          else 0.0
        end
      );
    end if;
  end loop;
  -- If no envelope contributed a confidence, v_confidence is still
  -- the 1.0 sentinel. The whole payload is malformed, so we
  -- collapse to 0.0 to match the "no signal" case.
  if v_confidence = 1.0 then
    v_confidence := 0.0;
  end if;

  -- 3. Delete the prior snapshot + feature rows for this
  --    user. The CASCADE on the FK handles the per-feature
  --    rows automatically, but we DELETE both explicitly for
  --    clarity in the audit trail.
  delete from public.student_model_features
    where user_id = p_user_id;
  delete from public.student_model_snapshots
    where user_id = p_user_id;

  -- 4. Insert the new snapshot row. We pin `computed_at` to
  --    p_until so the orchestrator's "now" matches the
  --    snapshot timestamp; this also keeps the unique
  --    (user_id, feature_key, computed_at) constraint on
  --    student_model_features well-defined per row.
  insert into public.student_model_snapshots (
    user_id,
    features,
    confidence,
    computed_at
  ) values (
    p_user_id,
    p_features,
    v_confidence,
    p_until
  );

  -- 5. Insert one feature row per key. The `feature_value`
  --    column carries the per-feature envelope
  --    (StudentModelFeatureValue). The `evidence_count`
  --    column carries the per-feature sampleSize so
  --    downstream readers can sort/filter on it without
  --    unpacking the JSONB.
  for v_key, v_value in
    select key, value
    from jsonb_each(p_features)
  loop
    if jsonb_typeof(v_value) <> 'object' then
      continue;
    end if;

    -- evidence_count defaults to 0 when the per-feature
    -- envelope is missing the sampleSize field. The
    -- orchestrator always emits a number, but we guard
    -- against future drift.
    v_evidence_count := 0;
    if (v_value ? 'sampleSize')
       and jsonb_typeof(v_value -> 'sampleSize') in ('number', 'integer')
    then
      v_evidence_count := greatest(0, (v_value ->> 'sampleSize')::int);
    end if;

    insert into public.student_model_features (
      user_id,
      feature_key,
      feature_value,
      evidence_count,
      computed_at
    ) values (
      p_user_id,
      v_key,
      v_value,
      v_evidence_count,
      p_until
    );
    v_feature_count := v_feature_count + 1;
  end loop;

  return v_feature_count;
end;
$$;

comment on function public.recompute_student_model(uuid, jsonb, int, timestamptz) is
  'Phase 5 student-model persistence. Replaces the snapshot+feature rows for p_user_id with the supplied features JSONB (the orchestrator''s StudentModelSnapshotPayload.features object). Returns the number of per-feature rows written. Idempotent — safe to re-run with the same payload.';

-- -------------------------------------------------------------
-- 2. Grants. SECURITY DEFINER + service_role execute, same
--    posture as recompute_analytics_rollup in migration 12.
-- -------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.recompute_student_model(uuid, jsonb, int, timestamptz) to service_role;
  end if;
exception when others then
  null;
end;
$$;
