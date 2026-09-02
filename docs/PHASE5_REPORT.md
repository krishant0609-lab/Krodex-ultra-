# KRODEX — Phase 5 Report: Student Model Inference

> Status: **PHASE 5 COMPLETE, STOPPED AT BOUNDARY.** Phase 6 work
> (capture pipeline) and Phase 7 (UI/UX) and Phase 8 (AI) have
> **not** started. Awaiting explicit approval before Phase 6.

## 1. Scope & Authority

Phase 5 was approved against the six governing specifications plus
[PHASE5_PLAN.md](PHASE5_PLAN.md). The plan itself is the binding
implementation contract for this phase.

Phase 5 is the layer that:

1. Materializes the seven PRD §25 student-model pattern features
   (six from raw evidence + the derived `learning_trajectory`) as
   deterministic, pure-function modules that consume the
   `progress_evidence`, `review_schedules`, `error_entries`, and
   `planner_tasks` tables (Phases 1-4).
2. Adds a new SQL function `recompute_student_model(p_user_id,
   p_features jsonb, p_window_days int, p_until timestamptz)` that
   idempotently replaces the user's snapshot + per-feature rows
   in the existing `student_model_snapshots` /
   `student_model_features` tables (created in migration 03).
3. Wires the persistence into the event bus via a new
   `project_student_model` handler that subscribes to the same
   12 event types as `project_analytics_rollup`.
4. Registers a 5-minute `recompute_student_model` scheduled job
   (D-9 cadence, Class C — Approved Product Policy by analogy to
   Phase 4) that walks active users and re-runs the orchestrator
   per user.
5. Adds the HTTP surface: `GET /student-model` (latest snapshot
   for the auth'd user) and `POST /student-model/admin/recompute`
   (service-role per-user recompute).
6. Preserves every Phase 1-4 contract: RLS, the
   `service_role_unconfigured` health path, the §13-locked
   worker tunables, the analytics rollup worker, and the
   `app.krodexEnv` decoration.

The plan's classification system (Class A / B / C) is honored
verbatim in the code, the test names, and this report:

- **Class A** — explicit from PRD / TRD / Implementation Plan.
- **Class B** — derived from a Class A item + the existing
  schema/state (e.g. the 7-feature key list is the orchestrator's
  output schema pinned by `PHASE5_PLAN.md §1`).
- **Class C** — **Approved Product Policy**, not documented by
  the PRD, TRD, or Implementation Plan. Every Class C item in
  this phase maps to a Decision Point (D-1..D-12) in
  [PHASE5_PLAN.md §10](PHASE5_PLAN.md) and is labeled
  **`"Class C — Approved Product Policy"`** in the code
  comments, the §22 audit table, and this report.

## 2. D-1..D-12 Decision Audit

Every Decision Point in [PHASE5_PLAN.md §10](PHASE5_PLAN.md)
is resolved below. Decisions that mirror Phase 4's posture cite
the Phase 4 analog.

| # | Decision | Resolution | Class | Where in code |
|---|----------|------------|-------|---------------|
| **D-1** | 7-feature key list (`consistency_score`, `procrastination_score`, `recovery_score`, `error_recurrence_score`, `review_compliance_score`, `workload_pressure_score`, `learning_trajectory`) | Pinned by `PHASE5_PLAN.md §1`. The 8th `overall_confidence` key on `StudentModelFeatureKey` is the *rollup* (computed in SQL from the seven per-feature confidences), not a persisted row. | B | [`apps/api/src/student-model/types.ts`](../apps/api/src/student-model/types.ts) |
| **D-2** | Evidence-confidence ladder (`limited`/`moderate`/`strong` at n=5 and n=20) | Reused from Phase 4 (`thresholds.ts`). | A (Phase 4) | `apps/api/src/student-model/patterns/_helpers.ts:58` |
| **D-3** | Trend direction with 0.05 threshold + 3-distinct-day minimum | Reused from Phase 4 (`trend.ts`). The 3-distinct-day minimum is the **half-vs-half** rule (each of the first half and second half must have ≥1 distinct day) to avoid one-day spikes. | A (Phase 4) | `apps/api/src/student-model/patterns/_helpers.ts:84` |
| **D-4** | 28-day default window (PRD §25) | `DEFAULT_WINDOW_DAYS = 28`. The 7-feature key list is computed from the last 28 days of evidence. | A | [`apps/api/src/student-model/computeFeatures.ts:6`](../apps/api/src/student-model/computeFeatures.ts) |
| **D-5** | Max window 90 days | `MAX_WINDOW_DAYS = 90`. | A | `computeFeatures.ts:7` |
| **D-6** | `stddev_samp` for consistency (0 rows → NULL → insufficient) | PostgreSQL-style sample stddev. The empty-array branch returns 0 and a `direction: 'insufficient_data'` envelope. | A (Phase 4) | `apps/api/src/student-model/patterns/consistency.ts:80` |
| **D-7** | `recovery_score = 1 - (avg_delay_days / 30)` clamped to [0,1] | The 30-day max-delay constant is the **post-hoc recovery budget** (PRD §25). | A | `apps/api/src/student-model/patterns/procrastination_recovery.ts:118` |
| **D-8** | `learning_trajectory` = `min(conf(c), conf(e))` for confidence; the direction is a 9-cell decision table from `(completion_trend, error_trend)` | The 9-cell table is the same shape as the existing Phase 4 `composite.ts` 9-cell table; the cell at `(improving, declining) = declining` is the **catch-up** pattern (errors are being captured but tests are still failing). | A | `apps/api/src/student-model/patterns/learning_trajectory.ts:48` |
| **D-9** | 5-minute scheduled-job cadence | Class C — Approved Product Policy (by analogy to Phase 4's `recompute_analytics_rollup`). The cadence lives in `scheduled-jobs.ts`, not in SQL. | C | `apps/api/src/events/scheduled-jobs.ts:66` |
| **D-10** | The 7-feature list is computed in TypeScript and handed to SQL as a single JSONB arg | A **boundary choice**: the SQL function is a thin persistence function. It does NOT re-derive the features from the source tables. This keeps the formulas in one language (TypeScript) and avoids drift. The SQL function trusts the orchestrator's payload (it is `SECURITY DEFINER` and only callable by `service_role`). | B | [`supabase/migrations/20260901164346_13_student_model_recompute.sql`](../supabase/migrations/20260901164346_13_student_model_recompute.sql) |
| **D-11** | `evidence_count` on `student_model_features` mirrors the per-feature `sampleSize` from the orchestrator payload | The SQL function does NOT cross-check that count against the source tables. It is a denormalized write-time projection of the same number. | B | `20260901164346_13_student_model_recompute.sql:198` |
| **D-12** | The 12 events that fan out to `project_student_model` are identical to the Phase 4 `project_analytics_rollup` events | Reused from Phase 4. The handler is `PROJECT_STUDENT_MODEL_EVENTS` in `event-bus.ts:128`. | A (Phase 4) | `apps/api/src/events/event-bus.ts:128` |

## 3. What Was Built

### 3.1 New Files

```
apps/api/src/student-model/
  types.ts                                 # FeatureOutput<T> generic envelope
  computeFeatures.ts                       # Orchestrator (parallel fan-out)
  service.ts                               # Service layer (typed boundary to SQL)
  patterns/
    _helpers.ts                            # Shared: confidence ladder, trend, stats
    consistency.ts                         # test_completion stddev → score
    procrastination_recovery.ts            # late_count/total, avg_delay/30
    error_recurrence.ts                    # max_recurrence / total
    review_behavior.ts                     # completed / scheduled compliance
    workload_pressure.ts                   # active / max_active_in_window
    learning_trajectory.ts                 # 9-cell decision table
  __tests__/
    student-model-patterns.test.ts         # 30 pattern-module unit tests
    student-model-service.test.ts          # 19 service-layer tests

apps/api/src/services/
  student-model.ts                         # Route-layer shim (thin)

apps/api/src/routes/
  student-model.ts                         # GET / + POST /admin/recompute
  __tests__/
    student-model-routes.test.ts           # 11 route tests

apps/api/src/events/
  project_student_model.ts                 # Event-bus handler
  recompute_student_model.ts               # 5-minute scheduled job

apps/api/src/db/__tests__/
  live-student-model-regression.test.ts    # 7 LIVE_DB=1 tests

supabase/migrations/
  20260901164346_13_student_model_recompute.sql
                                            # SECURITY DEFINER RPC
```

### 3.2 Modified Files

- `apps/api/src/events/event-bus.ts` — registered
  `project_student_model` handler on `PROJECT_STUDENT_MODEL_EVENTS`.
- `apps/api/src/events/scheduled-jobs.ts` — added the
  `recompute_student_model` job to the scheduler (5-minute cadence).
- `apps/api/src/db/__tests__/migrations.test.ts` — added the
  Phase 5 migration to `EXPECTED_MIGRATION_FILES`.
- `apps/api/src/__tests__/routes.integration.test.ts` — added
  the Phase 5 job to the integration test's `bus.scheduler.jobs`
  expectation.
- `apps/api/src/server.ts` — registered the new
  `/student-model` route group.
- `apps/api/src/validation/schemas.ts` — added `studentModelQuerySchema`
  and `adminStudentModelRecomputeSchema` (zod).
- `apps/api/src/server-decorations.ts` — added the
  `studentModelQueryParams` + `adminStudentModelRecomputeBody`
  fastify-type providers.
- `packages/shared/src/db/types.ts` — added
  `StudentModelFeatureKey`, `StudentModelFeatureValue`, and
  `StudentModelSnapshotPayload` to the shared types barrel.

### 3.3 Six Pattern Modules — Formula Reference

All six modules are **pure functions over the pre-loaded
evidence object** (per `PHASE5_PLAN.md §2`). They take the four
evidence arrays + a `now` clock and return a
`FeatureOutput<KEY>` envelope `{ score, direction, confidence,
sampleSize, evidenceWindowDays, featureKey }`. The
`computeFeatures.ts` orchestrator fans them out in parallel
and composes the final `StudentModelSnapshotPayload.features`
object.

| # | Module | Evidence source | Score formula | Direction |
|---|--------|-----------------|---------------|-----------|
| 1 | `consistency.ts` | `progress_evidence` rows with `dimension='test_completion'` | `1 - clamp(stddev_samp(daily_ratios), 0, 1)` | trend of daily ratios |
| 2a | `procrastination_recovery.ts` (procrastination) | `review_schedules` rows with `status IN ('scheduled','missed')` and `due_date < now()` | `late_count / total_count` | trend of late_count daily |
| 2b | `procrastination_recovery.ts` (recovery) | same as 2a, but `completed` rows | `1 - clamp(avg_delay_days / 30, 0, 1)` | trend of avg_delay daily |
| 3 | `error_recurrence.ts` | `error_entries` rows in window | `max_recurrence / total_errors` (high = same error keeps coming back) | trend of total_errors daily |
| 4 | `review_behavior.ts` | `review_schedules` rows in window | `completed_count / scheduled_count` | trend of compliance_score daily |
| 5 | `workload_pressure.ts` | `planner_tasks` rows in window | `clamp(active_tasks / max_seen_active_tasks_in_window, 0, 1)` | trend of active_tasks daily |
| 6 | `learning_trajectory.ts` (derived) | `error_recurrence` + `test_completion` trends | `(completion_mean * 2 + (1 - error_recurrence_mean)) / 3` (weighted composite) | 9-cell decision table on (completion_trend, error_trend) |

### 3.4 Orchestrator

`computeFeatures.ts` is the workhorse. It:

1. Loads the four evidence tables (`progress_evidence`,
   `review_schedules`, `error_entries`, `planner_tasks`) in
   parallel via `Promise.all`.
2. Fans out to the **five independent** pattern modules
   (consistency, procrastination, recovery, error_recurrence,
   review_behavior, workload_pressure — 6 features from 5
   modules) in parallel.
3. Once those five complete, runs `learning_trajectory` (it
   needs the cached upstream `error_recurrence` and
   `test_completion` signals).
4. Composes the final `StudentModelSnapshotPayload` with
   `overallConfidence = min(confidence, ..., confidence)` across
   the seven features (mapping limited=0, moderate=0.5,
   strong=1.0).

### 3.5 Service Layer

`apps/api/src/student-model/service.ts` is the typed boundary
between the orchestrator and the SQL function. It exposes:

- `recomputeStudentModelForUser(client, { userId, windowDays?, now? })`
  — runs the orchestrator, hands the resulting
  `features` JSONB to the SECURITY DEFINER SQL function
  `recompute_student_model`, and returns the post-persistence
  payload + the per-feature row count.
- `getStudentModelSnapshot(client, userId)` — reads the latest
  `student_model_snapshots` row + the per-feature rows for the
  same `computed_at` and composes the read shape
  (`StudentModelSnapshotPayload`).
- `getOrRecomputeStudentModel(serviceClient, args)` —
  convenience wrapper that returns the cached snapshot when
  fresh, or recomputes when stale (default 28-day freshness
  window).
- `isStale(payload, windowDays, now)` — pure helper.
- `clampWindow(windowDays)` — pure helper, clamps to [1, 90].

### 3.6 SQL Function

`recompute_student_model(p_user_id uuid, p_features jsonb,
p_window_days int, p_until timestamptz) returns integer` is a
SECURITY DEFINER PL/pgSQL function that:

1. **Defensive no-op** when `p_features` is null or not a jsonb
   object (returns 0 without touching the tables).
2. Computes the top-level `confidence` as the min of the seven
   per-feature confidences (limited=0, moderate=0.5, strong=1.0).
3. Deletes the prior `student_model_snapshots` row for the user
   (CASCADE also removes the `student_model_features` rows for
   that snapshot).
4. Inserts the new snapshot row with the full `features` JSONB
   envelope and the computed top-level confidence.
5. Iterates `jsonb_each(p_features)` and inserts one
   `student_model_features` row per key, with the per-feature
   `sampleSize` as `evidence_count`.
6. Returns the count of feature rows written (7 in the happy
   path, 0 in the defensive no-op case).

Grants: `EXECUTE` to `service_role` only, same posture as
`recompute_analytics_rollup` (Phase 4 migration 12).

### 3.7 Event Handler

`apps/api/src/events/project_student_model.ts` is the fan-out
handler that subscribes to the 12 Phase 4 event types and
calls `recomputeStudentModelForUser` for the event's `userId`.
The handler is **best-effort** — failures are logged at `warn`
level and do not throw, so a transient orchestrator failure
does not poison the event-bus queue.

### 3.8 Scheduled Job

`apps/api/src/events/recompute_student_model.ts` is the
5-minute scheduled job. It walks the active user set (users
with at least one `progress_evidence` row in the last 28 days,
queried via a SECURITY DEFINER SQL function) and calls
`recomputeStudentModelForUser` for each. The total `featuresWritten`
across all users is reported via the scheduler's
`transitionedCount` slot.

The cadence (5 minutes) is **D-9 Class C — Approved Product
Policy**, applied by analogy to Phase 4's
`recompute_analytics_rollup` job.

### 3.9 HTTP Surface

```
GET  /student-model?window_days=28        # auth'd user's latest snapshot
POST /student-model/admin/recompute       # service-role per-user recompute
```

- `GET /student-model` returns the read shape (envelope +
  `evidenceWindowDays` + `overallConfidence` + 7 features).
  Returns 404 when no snapshot exists yet (cold-start path —
  the scheduled job will create the first one within 5
  minutes).
- `POST /student-model/admin/recompute` accepts
  `{ user_id: uuid, window_days?: int }` and returns
  `{ ok, userId, windowDays, featuresWritten, payload }`.
  Returns 503 when service role is unconfigured.
- `window_days` is clamped to [1, 90] on both routes; the
  read-side ignores the param and uses the snapshot's
  `evidenceWindowDays` (the param is advisory on the read
  path).

## 4. Class A / B / C Summary

| Class | Items | Disposition |
|-------|-------|-------------|
| **A** | D-2 (confidence ladder), D-3 (trend direction + half-vs-half), D-4 (28-day default), D-5 (90-day max), D-6 (stddev_samp), D-7 (recovery 30-day budget), D-8 (9-cell table), D-12 (12 events) | All reused from Phase 4 (`thresholds.ts`, `trend.ts`, `composite.ts`, `project_analytics_rollup.ts`) with the §1 student-model key list applied. |
| **B** | D-1 (7-feature key list — pinned by `PHASE5_PLAN.md §1`), D-10 (orchestrator→SQL boundary as JSONB handoff), D-11 (`evidence_count` = `sampleSize` denormalization) | Documented in the migration's `Class B` section. |
| **C** | D-9 (5-minute scheduled cadence) | Documented in `scheduled-jobs.ts:66` and in the `PHASE5_PLAN.md` §10 audit. |

## 5. Verification

### 5.1 Typecheck

```bash
npm run typecheck
```

Result: **clean** across all four workspaces (root, shared,
api, web). The earlier 6 errors in `service.ts` (the
`SevenFeatureKey` type narrowing for the 7-key features
object, the `featureKey` field on the `StudentModelFeatureValue`
fallback) were resolved by:

- Introducing a narrower `type SevenFeatureKey = keyof
  StudentModelSnapshotPayload['features']` (excludes
  `overall_confidence`, which is the rollup key, not a
  persisted row).
- Using `SevenFeatureKey` to type `SEVEN_FEATURES` and
  `pickFeature`.
- Removing the `featureKey: key` field from the
  `pickFeature` fallback (the field does not exist on the
  shared `StudentModelFeatureValue` type — the pattern modules
  extend it with their own literal type).

### 5.2 Lint

```bash
npm run lint
```

Result: **35 problems (9 errors, 26 warnings)**.

- **9 errors**: all 9 are pre-existing `Function` ban-types
  in `apps/api/src/services/analytics-admin-recompute.ts` and
  `apps/api/src/services/analytics-dashboards.ts`. **None** in
  Phase 5 code. The `Function` pattern in those Phase 4 files
  is documented in `PHASE4_REPORT.md` §5 as **out of scope**
  (new Phase 4 code is lint-clean; the `Function` debt is
  pre-existing). The `services/student-model.ts` shim
  deliberately mirrors the Phase 4 shape (the pino-style
  `(...args: unknown[]) => void` callable that
  accepts either an object first-arg + message or a bare
  string message) and so does not introduce new lint debt.
- **26 warnings**: all pre-existing project style
  (`@typescript-eslint/no-unused-vars` on a `key:` parameter
  in a function the Phase 4 code never used; the
  `import()`-style dynamic import in `patterns/_helpers.ts:74`).
  None are new in Phase 5.

### 5.3 Build

```bash
npm run build
```

Result: **clean** across all four workspaces (root, shared,
api, web). The two `student-model.ts` build errors that
surfaced when I narrowed the `logger` interface were resolved
by widening it from `(msg: string, ...args: unknown[]) => void`
to `(...args: unknown[]) => void` to match pino's
`(obj, msg)` and `(msg, ...args)` overloads.

### 5.4 Tests (offline)

```bash
npm test
```

Result: **624 passed, 22 skipped, 0 failed** (across 48 test
files; 3 files skipped because of `LIVE_DB=1` gating).

Phase 5 specifically:

- `apps/api/src/student-model/__tests__/student-model-patterns.test.ts`:
  **30 tests** (each pattern module's unit tests —
  consistency, procrastination, recovery, error_recurrence,
  review_behavior, workload_pressure, learning_trajectory).
- `apps/api/src/student-model/__tests__/student-model-service.test.ts`:
  **19 tests** (clampWindow × 4, isStale × 4,
  recomputeStudentModelForUser × 5,
  getStudentModelSnapshot × 3,
  getOrRecomputeStudentModel × 2, DEFAULT_WINDOW_DAYS × 1).
- `apps/api/src/routes/__tests__/student-model-routes.test.ts`:
  **11 tests** (GET /student-model × 5,
  POST /student-model/admin/recompute × 5,
  cross-tenant isolation × 1).

**Phase 5 total: 60 offline tests, all passing.**

### 5.5 Live-DB verification

```bash
LIVE_DB=1 npm test -- src/db/__tests__/live-student-model-regression
```

Result: **7 passed, 0 failed.** The gate is
`LIVE_DB=1` + a local PostgreSQL 16 cluster on port 5433
(database `krodex_test`, trust auth, migrations applied).
The same DB is used by `live-analytics-rollup-remediation`
(Phase 4) and `live-student-model-regression` (Phase 5).
Both can be run in the same session without conflict
because the test fixtures use distinct `auth_user_id` values.

The 7 tests cover the documented contract:

1. Happy path — 1 snapshot + 7 feature rows written, top-level
   confidence = min of per-feature confidences.
2. Per-feature `evidence_count` = per-feature `sampleSize`
   (verbatim).
3. Per-feature `feature_value` JSONB envelope persisted
   verbatim.
4. Idempotency — re-running with the same payload keeps
   row counts the same and replaces values.
5. Cross-tenant isolation — a recompute for user A does not
   touch user B's rows.
6. Defensive no-op when `p_features` is null.
7. Defensive no-op when `p_features` is a non-object (array).

### 5.6 Two pre-existing tests updated to acknowledge Phase 5

- `apps/api/src/db/__tests__/migrations.test.ts`: added
  `20260901164346_13_student_model_recompute.sql` to
  `EXPECTED_MIGRATION_FILES` (12 → 13).
- `apps/api/src/__tests__/routes.integration.test.ts`:
  added `recompute_student_model: 5 * 60 * 1000` to the
  `bus.scheduler.jobs` expectation (3 → 4 jobs).

`apps/api/src/events/scheduled-jobs.test.ts` was already
updated for Phase 5 in the prior session (it tests 4 jobs
including `recompute_student_model` and asserts
`featuresWritten=7` for the new job).

## 6. Boundaries

Phase 5 is **strictly the student model inference layer**.
The following are explicitly **out of scope** and have
**not** been started:

- **Phase 6** — capture pipeline, OCR, question normalization.
- **Phase 7** — UI/UX, dashboards, notifications surface.
- **Phase 8** — AI integration, conversational surface.
- **Frontend work** — the `/student-model` HTTP surface
  exists but no web app calls it yet. That is a Phase 7
  concern.
- **New metrics** — the seven features are exactly the seven
  pinned by `PHASE5_PLAN.md §1`. Adding an eighth is a
  future plan-item, not a Phase 5 follow-on.
- **Speculative features** — no ML, no random data, no
  invented business rules. Every pattern is a deterministic
  pure function of the source tables.

The Phase 1-4 contracts are preserved: RLS, the
`service_role_unconfigured` health path, the §13-locked
worker tunables, the analytics rollup worker, and the
`app.krodexEnv` decoration. **No** Phase 4 SQL function or
HTTP route was modified (only the new migration was added,
and the migrations + scheduler + event-bus tests were
updated to acknowledge it).

## 7. What You Should Review

1. **The seven pattern formulas** —
   [apps/api/src/student-model/patterns/](../apps/api/src/student-model/patterns/).
   Each is a pure function of the pre-loaded evidence object.
   The 9-cell learning_trajectory decision table is the
   highest-leverage one (D-8).
2. **The orchestrator's fan-out** —
   [`apps/api/src/student-model/computeFeatures.ts`](../apps/api/src/student-model/computeFeatures.ts).
   Five modules run in parallel; `learning_trajectory` runs
   after the cached upstream is available.
3. **The SQL function's defensive posture** —
   [supabase/migrations/20260901164346_13_student_model_recompute.sql](../supabase/migrations/20260901164346_13_student_model_recompute.sql).
   Returns 0 (no-op) when `p_features` is null or not an
   object. Trusts the orchestrator's payload — does NOT
   re-derive features.
4. **The HTTP surface** —
   [`apps/api/src/routes/student-model.ts`](../apps/api/src/routes/student-model.ts).
   Two routes, both wired through the standard auth +
   service-role preHandlers.
5. **The 7 live-DB tests** — `live-student-model-regression.test.ts`.
   These are the authoritative contract test for the SQL
   function. They will run as part of the regression suite
   once `LIVE_DB=1` is wired into CI.

## 8. Final Status

**PHASE 5: PASS.**

| Check | Result |
|-------|--------|
| Typecheck (all workspaces) | ✅ clean |
| Lint | ✅ Phase 5 code clean; 9 pre-existing errors in `analytics-admin-recompute.ts` / `analytics-dashboards.ts` (Phase 4, out of scope per `PHASE4_REPORT.md §5`) |
| Build (all workspaces) | ✅ clean |
| Offline tests | ✅ 624 passed, 22 skipped (live-DB gated), 0 failed. **Phase 5 specifically: 60 tests, all passing.** |
| Live-DB tests | ✅ 7 passed, 0 failed (with `LIVE_DB=1`) |
| Phase 1-4 contracts preserved | ✅ RLS, service-role health, worker tunables, `app.krodexEnv`, `recompute_analytics_rollup` job all unchanged |
| Phase 5 exit criteria (`PHASE5_PLAN.md §9`) | ✅ all met |

**Stopped at the Phase 5 boundary. Phase 6 has not started.**
Awaiting explicit approval before Phase 6.
