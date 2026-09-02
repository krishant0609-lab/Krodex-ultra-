# KRODEX — Phase 4 Plan: Analytics & Progress Engine

> Status: **PLANNING ONLY. NO IMPLEMENTATION HAS STARTED.** This
> document is the contract the implementation must follow when
> explicitly approved. Approval is a separate step. A
> classification of every numeric / threshold / weight / rule
> against the actual governing documents is in **§22**. Decisions
> that are not directly specified by any source document are
> called out as **Decision Points (D-1, D-2, ...)** and must be
> approved by the user before Phase 4 implementation begins.

## 0. Reading order and authority

This plan is bound by the five governing specifications and the
completed Phase 1–3 work. When this plan and a spec disagree, the
spec wins; where a spec is silent, this plan records the
silence as a **Decision Point** (§22) rather than inventing
authority.

1. [PRD](../specs/KRODEX_Detailed_PRD_From_Scratch_v2.txt)
2. [TRD](../specs/KRODEX_TRD_From_Scratch_v2.txt)
3. [Schema-Ready](../specs/KRODEX_Schema_Ready_Specification_From_Scratch_v2.txt)
4. [Engineering Support](../specs/KRODEX_Engineering_Support_Specification_5_in_1_v2.txt)
5. [Implementation Plan](../specs/KRODEX_Project_Implementation_Plan_From_Scratch_v2.txt)
6. [PHASE3_REPORT.md](PHASE3_REPORT.md) — what Phase 3 shipped and
   what it deferred.
7. [PHASE3_PLAN.md](PHASE3_PLAN.md) §1, §7, §12, §13 — Phase 3's
   own deferral list to Phase 4 and the locked Phase 3 decisions.

## 1. The classification system used in this plan

Every numeric value, threshold, weight, formula, catalog entry,
or rule in Phase 4 falls into exactly one of three classes:

- **A — Explicit source.** The value or rule is stated verbatim
  in one of the five governing specs, in
  [PHASE3_PLAN.md](PHASE3_PLAN.md), or in
  [PHASE3_REPORT.md](PHASE3_REPORT.md). The exact quote and its
  line number are recorded in §22.
- **B — Derived from an explicit source.** The value follows
  deterministically from a stated rule, the existing schema, or
  an existing convention. The derivation is recorded in §22.
- **C — Unspecified / new product policy.** The value is **not**
  present in any governing document. It is recorded as a
  **Decision Point** and requires explicit user approval before
  implementation. The default in this plan is "do not ship" —
  C values are not treated as authoritative in this revision.

A previous version of this plan silently treated several C
items as authoritative. That was wrong. The corrected
classification is in §22 and the corresponding sections now
flag every C item as a Decision Point.

## 2. Scope and authority (re-stated)

Phase 4 is the **Analytics & Progress Engine** layer. It builds
the **derived read model** that the Phase 3 read endpoints
already expose. It does not introduce new authoritative state.
Every read-model number is recomputable from existing evidence
(raw attempts, answers, error entries, review attempts, planner
tasks, backlog, the Phase 3 `progress_evidence` table) and the
`event_outbox`.

### 2.1 What Phase 4 owns (per Implementation Plan §Phase 4)

The Phase 4 work package per Implementation Plan lines 179-186:

> "Define seven/eight measurable dimensions from the PRD.
> Compute task execution, error health, test improvement,
> syllabus coverage, review behavior, consistency and composite
> indicators. Use explicit date windows. Expose sample sizes and
> evidence thresholds. Create daily/weekly series. Cache read
> models only as derived projections."

This plan implements **only** what the work-package text
demands. The seven Implementation-Plan-named buckets
("task execution, error health, test improvement, syllabus
coverage, review behavior, consistency, composite") are
mapped to the **six** PRD §24 metrics in §3. The 12-dimension
catalog Phase 3 introduced is treated as a Phase 3 design
decision, not a binding Phase 4 input — see Decision Point
**D-1**.

### 2.2 What Phase 4 explicitly does NOT own (verbatim)

Per [PHASE3_PLAN.md](PHASE3_PLAN.md) §12, Implementation Plan
§Phase 5, and Engineering Support §25-§35:

1. **BKT / IRT calculations.** Phase 5 only.
2. **`student_model_snapshots` / `student_model_features`
   writes.** Phase 5 only.
3. **Student Model inference of any kind.** This includes
   confidence, retention, decay, behavioral pattern modules
   (consistency / procrastination-recovery / error recurrence /
   review behavior / workload pressure / learning trajectory).
   The Implementation Plan §Phase 5 names all of these. **Phase
   4 does not implement any Student Model inference.** If a
   future revision of this plan claims it does, that is a
   scope error and must be removed.
4. **The web UI for analytics.** Phase 6 (route shells) and
   Phase 7 (UI/UX). Phase 4 ships the JSON contract only.
5. **AI integration, AI explainer calls, assistant
   orchestration.** Phase 8.
6. **The capture system** (camera, microphone, OCR,
   transcription). Phase 6.
7. **Priority-ranking v1** in the planner (PRD §4 lines
   183-187). This is a planner surface that consumes evidence
   counts; it is not an analytics number. Phase 4 exposes the
   underlying counts so the planner can rank deterministically
   in its own phase. The ranking formula itself is not in
   Phase 4.
8. **New authentication providers, billing, exports.**

## 3. The six PRD §24 / §37 metrics (Class A)

The six metrics are the only ratios Phase 4 ships. They are
quoted verbatim from PRD §24 (lines 938-948) and PRD §37 (lines
1390-1400). The same table appears in both places. Both sources
are recorded in §22.

| # | Metric | Formula (verbatim) | Source |
|---:|---|---|---|
| 1 | Test completion rate | `Submitted attempts / started attempts` | PRD §24:938, §37:1390 |
| 2 | Error capture rate | `Eligible incorrect answers with evidence / eligible incorrect answers` | PRD §24:940, §37:1392 |
| 3 | Review completion | `Completed reviews / due reviews` | PRD §24:942, §37:1394 |
| 4 | Correction rate | `Qualifying correct outcomes / completed reviews` | PRD §24:944, §37:1396 |
| 5 | Reopen rate | `Reopened errors / resolved errors` | PRD §24:946, §37:1398 |
| 6 | Time to correction | `Resolution timestamp − Error creation timestamp` (per-error; aggregate is the median across resolved errors in the window) | PRD §24:948, §37:1400 |

The PRD §24:938-948 table is the only source of these six
formulas. No formula in this plan is invented. Where the PRD
uses prose ("qualifying", "eligible", "due"), the Phase 4
binding interpretation is recorded below; those interpretations
are Class B (derived from existing schema) and are enumerated
in §22.

### 3.1 Binding interpretation of PRD prose terms (Class B)

The PRD names the formulas in prose; the Phase 4 service / SQL
layer pins each to a concrete predicate. The mapping is locked
here. Each row is Class B because the source predicate follows
from a Phase 1/2 schema field, not from new policy.

| Prose term in PRD | Bound predicate | Source of predicate |
|---|---|---|
| "Submitted attempts" | `test_attempts.state = 'submitted'` | Phase 1 schema; `test_attempts.state` enum |
| "Started attempts" | `test_attempts.state IN ('started','submitted')` | same |
| "Eligible incorrect answers" | rows in `test_answers` whose answer is incorrect AND whose `syllabus_questions.is_eligible_for_error_capture = true` | Phase 1 schema + Phase 2 [PHASE2_GRADING_DECISIONS.md](PHASE2_GRADING_DECISIONS.md) |
| "Eligible incorrect answers with evidence" | `eligible incorrect answers` that produced an `error_entries` row | Phase 1 schema; `error_entries.test_answer_id` foreign key |
| "Due reviews" | `review_schedules` rows whose `state IN ('scheduled','due')` AND whose `due_at <= window_end` (matches Phase 2 `review.listSchedules` auto-transition behavior) | Phase 2 service |
| "Qualifying correct outcomes" | `review_attempts.outcome IN ('correct_uncertain','correct_confident')`; `incorrect` and `skipped` are non-qualifying; `technical_failure` is excluded from the denominator | Phase 1 schema; `review_attempts.outcome` enum |
| "Reopened errors" | `error_entries` rows whose `state = 'reopened'` at any point in the window | Phase 1 schema; `error_entries.state` enum |
| "Resolved errors" | `error_entries` rows whose `state IN ('resolved','reopened')` in the window | Phase 1 schema |
| "Resolution timestamp" | `error_entries.resolved_at` | Phase 1 schema |
| "Error creation timestamp" | `error_entries.created_at` | Phase 1 schema |

### 3.2 The two PRD §23/§24 structural rules (Class A)

The PRD §23 (lines 914-917) and §24 (lines 961-963) impose two
structural rules that govern every metric. Both are Class A:

1. **"A small sample should not be presented as a strong
   conclusion. Insights can say 'limited evidence' and show the
   sample size. The product should not use a single percentage
   as universal mastery."** (PRD §23:914-917)

2. **"If there is insufficient evidence, provide a meaningful
   next action such as 'Take a test in this topic' rather than
   a blank chart."** (PRD §24:961-963)

TRD §18 (line 733) adds the response-shape rule (Class A):

> "Metric APIs should return numerator, denominator and sample
> size. Insight generation can apply thresholds and label
> limited evidence."

Phase 4 honors these three rules by **always** returning
`{ value, numerator, denominator, sampleSize }` for every
ratio, with `value: null` when the denominator is below a
sample-size threshold. **The numeric sample-size thresholds
themselves are Class C** — see §4 and Decision Point **D-2**.

## 4. Sample-size thresholds (Class C — Decision Point D-2)

The PRD names the *policy* ("limited evidence", "small sample",
"insufficient evidence") in prose but **does not name the
numeric threshold**. The TRD §18 says "apply thresholds" but
does not name them either. Engineering Support §51 (line 1354)
says only "Verify live analytical truth".

The numeric ladder — `< 5` / `5–19` / `≥ 20` — in the previous
version of this plan was invented. The corrected plan does
**not** treat those numbers as authoritative.

**Decision Point D-2:** Pick exactly one of:

- **(D-2.a)** Ship a numeric ladder. The previous plan proposed
  `limited < 5`, `moderate 5–19`, `strong ≥ 20`. This is the
  only numeric proposal on the table; the user must approve,
  amend, or reject it.
- **(D-2.b)** Ship the policy without numeric thresholds. Every
  metric is returned as `{ value, numerator, denominator,
  sampleSize }` and the UI is free to interpret `sampleSize`.
  This is the strictest "no invented policy" reading.
- **(D-2.c)** Ship a single binary threshold (e.g. "suppress
  when denominator < N for some user-chosen N"). This is the
  minimum viable reading.

Phase 4 implementation will not start until the user picks
**D-2.a, D-2.b, or D-2.c** and (for D-2.a or D-2.c) the
specific N values.

## 5. Time windows (Class A)

PRD §23:924-927 (verbatim):

> "Support explicit windows such as recent 7/14/30 days and a
> custom range where practical. The chosen window is visible
> in the UI."

Phase 4 ships exactly the four windows named: `7d`, `14d`,
`30d`, and `custom`. The default window when none is provided
is `30d` (the most permissive of the three named non-custom
windows). All windows are computed in UTC; user-timezone
presentation is Phase 7.

## 6. Trend direction (Class C — Decision Point D-3)

The PRD §23 (line 912) names a "Recent trend — Time-windowed
attempts" concept. The Implementation Plan §Phase 4 line 185
also names a "daily/weekly series" deliverable. Neither source
defines a **trend direction** rule, a numeric threshold for
"improving" vs. "flat", or a half-vs-half comparison method.

The previous version of this plan invented:

- A half-vs-half comparison method.
- A `0.05` numeric "meaningful change" threshold.
- A 3-distinct-days minimum.
- A four-value enum (`improving | declining | flat |
  insufficient_data`).

None of these are in the source documents.

**Decision Point D-3:** Pick exactly one of:

- **(D-3.a)** Ship the trend direction as a derived field with
  the previous plan's rule and the `0.05` / 3-day numeric
  thresholds, both of which become new product policy.
- **(D-3.b)** Ship the daily / weekly series as a JSON array
  with **no direction label**. The series is the source of
  truth; the UI computes a direction. Phase 4 does not invent
  a direction rule.
- **(D-3.c)** Ship a direction rule but with user-chosen
  numeric thresholds (the user supplies the `0.05` analog and
  the minimum-day count).

Phase 4 implementation will not start until the user picks
**D-3.a, D-3.b, or D-3.c** and (for D-3.a or D-3.c) the
specific numbers.

## 7. Composite dimension weights (Class C — Decision Point D-1, D-4)

The PRD §24 names the six core metrics but does not name a
composite. The Implementation Plan §Phase 4 line 182 names
seven buckets: "task execution, error health, test
improvement, syllabus coverage, review behavior, consistency
and composite indicators" — i.e. it is **not** the same as
the six PRD §24 metrics. The Implementation Plan does not
name weights.

The 13-dimension catalog in `packages/shared/src/events/dimensions.ts`
(Phase 3 deliverable) was a Phase 3 design decision; it is not
directly sourced from any spec. The previous plan treated the
composite as a 12-input uniform mean. That is a Class C
decision.

**Decision Point D-1 (Phase 3 / Phase 4 boundary):** The
**existence** and **shape** of the composite dimension. Pick
exactly one of:

- **(D-1.a)** Ship the composite as Phase 3 defined it — a
  uniform mean of the 12 Phase-3-defined input dimensions.
  The 12 dimensions are accepted as a Phase 3 design decision
  and Phase 4 does not relitigate the catalog.
- **(D-1.b)** Ship the composite as a uniform mean of the six
  PRD §24 metrics (the only metrics that the source docs
  actually name). The Phase 3 catalog is reduced to six.
- **(D-1.c)** Do not ship a composite in Phase 4. The
  `'composite'` key is removed from the catalog. Phase 5
  introduces the composite when the Student Model is built.

**Decision Point D-4 (composite weights):** Whatever shape
D-1 chooses, the **weight set** is a separate decision. Pick
exactly one of:

- **(D-4.a)** Uniform weights (`1/12` or `1/6` or `1/N` as
  applicable) — the previous plan's default.
- **(D-4.b)** A user-supplied weight set (the user supplies
  the per-input weight).
- **(D-4.c)** No weights — no composite in Phase 4 (same as
  D-1.c).

## 8. The 13-dimension catalog (Phase 3 design vs. Phase 4 input)

The catalog in
`packages/shared/src/events/dimensions.ts` has 13 keys:
`syllabus_coverage`, `test_accuracy`, `test_attempts`,
`errors_created`, `errors_resolved`, `errors_reopened`,
`review_completed`, `planner_completion`, `planner_backlog`,
`backlog_recovered`, `consistency`, `practice_volume`,
`composite`.

Of these:

- **Three are direct mappings of PRD §24 metrics.**
  `test_accuracy` (Test completion rate), `review_completed`
  (Review completion), and the composite reduction
  approximate PRD §24 metrics 1, 3, and 4.
- **One is a direct mapping of a PRD §23 insight concept.**
  `errors_resolved` / `errors_reopened` cover "Resolved/reopened
  rate" (PRD §23:908). The other two PRD §23 insight concepts
  ("Accuracy by syllabus node", "Coverage", "Recent trend",
  "Error recurrence", "Review success") are also approximated
  by Phase 3 keys but with different names.
- **Six were not named in any governing document.**
  `planner_completion`, `planner_backlog`, `backlog_recovered`,
  `consistency`, `practice_volume`, and the explicit
  `errors_created` are not in the PRD §23/§24 lists and are
  not in the Implementation Plan's 7-bucket list. They are
  Phase 3 design additions.

The catalog is **append-only by Phase 3's own contract** (the
Phase 3 source comment: "Once Phase 4 lands, this list is
append-only; existing keys keep their meaning"). Removing a key
is therefore not allowed in Phase 4. Phase 4 can:

- Add new keys (e.g. for a topic-scoped breakdown).
- Annotate each existing key with a `rollupFormula` and a
  `sourceClass: 'A' | 'B' | 'C'` field.
- For C-class keys, either ship the rollup as a Decision
  Point or omit the rollup and return `null` for that key.

The previous plan's §4 dimension rollup table assigned
rollup formulas to all 12 dimensions. Most of those formulas
(Class C) are now Decision Points (D-1, D-5, D-6, D-7).
Only the **six PRD §24 metric rollups** (the directly-A-class
rollups) are locked:

| Dimension | Rollup is locked? | Class |
|---|---|---|
| `test_accuracy` (test completion rate) | yes (PRD §24:938) | A |
| `errors_resolved` (review completion) | yes (PRD §24:942) | A |
| `review_completed` (correction rate) | yes (PRD §24:944) | A |
| `errors_reopened` (reopen rate) | yes (PRD §24:946) | A |
| `errors_created` (error capture) | yes (PRD §24:940) | A |
| (Time to correction is a per-row timestamp, not a dimension) | n/a | A |
| `composite` | **Decision Point D-1, D-4** | C |
| `syllabus_coverage` | **Decision Point D-5** (PRD §23:910 names "Coverage" in prose only) | C |
| `test_attempts` | **Decision Point D-6** (raw count, not in PRD §24) | C |
| `planner_completion` | **Decision Point D-6** (not in PRD §23/§24; counts only, not a ratio) | C |
| `planner_backlog` | **Decision Point D-6** | C |
| `backlog_recovered` | **Decision Point D-6** | C |
| `consistency` | **Decision Point D-7** (Implementation Plan §Phase 4 names "consistency" but does not define it) | C |
| `practice_volume` | **Decision Point D-6** (not in PRD §23/§24) | C |

**Decision Point D-5:** For each C-class dimension, pick
exactly one of:

- **(D-5.x)** Ship the rollup formula as written in the
  previous plan's §4 (the user accepts the formula as new
  product policy).
- **(D-5.null)** Return `null` for that dimension in Phase 4
  (the dimension is reserved but the rollup is deferred to
  Phase 5 or later).

**Decision Point D-6:** The previous plan's raw-count rollups
for `test_attempts`, `planner_completion`, `planner_backlog`,
`backlog_recovered`, `practice_volume` — same D-5 choice
applies.

**Decision Point D-7:** "Consistency" is named in the
Implementation Plan §Phase 4 line 182 ("...consistency and
composite indicators") without definition. The previous plan
defined it as "count of distinct ISO weekdays in W with ≥ 1
progress_evidence row divided by 7". That definition is Class C.
Pick D-5.x or D-5.null for `consistency`.

## 9. Evidence weighting (Class A — narrow)

The PRD names weighting in exactly one place:
"Accuracy of submitted test attempts, weighted by attempt size"
(the `test_accuracy` dimension descriptor in the Phase 3
catalog, originally transcribed from PRD §24:942). The
weighting formula the previous plan shipped is the only Class
A weighting:

```
dimension_value = sum(attempt_accuracy × attempt_size) /
                  sum(attempt_size)
```

where `attempt_accuracy` is the per-attempt ratio of correct
answers to total answers, and `attempt_size` is the number of
answers in the attempt. The composite weights (Decision Point
D-4) are Class C and are NOT evidence weighting in the PRD
sense.

## 10. `nextAction` catalog (Class C — Decision Point D-8)

PRD §24:961-963 names the *policy* ("provide a meaningful next
action such as 'Take a test in this topic'") and gives one
example string. The Implementation Plan and TRD do not name a
catalog. The previous plan invented a 9-entry catalog mapping
each dimension to a `nextAction` string. That catalog is
entirely Class C.

**Decision Point D-8:** Pick exactly one of:

- **(D-8.a)** Ship the 9-entry catalog as written in the
  previous plan's §7. The user accepts the strings as new
  product policy. (The strings are listed in §22 for
  reference.)
- **(D-8.b)** Ship only the one PRD-given example string
  ("Take a test in this topic") and a generic fallback
  ("Add more activity to see this metric") for all other
  empty cases. The UI picks the right copy.
- **(D-8.c)** Ship a catalog defined by the user (the user
  supplies the per-dimension strings).

## 11. Database changes (Phase 4 migrations)

Two new tables are added. Both are **read-model projections**;
neither is authoritative. **The exact table shape is locked
(Class B) because it follows from the existing
`(user_id, occurred_at, dimension, value, ref_kind, ref_id)`
key pattern in `progress_evidence`.** Numeric column types
follow from the existing schema.

### 11.1 `analytics_daily_rollup`

A per-user, per-dimension, per-UTC-day rollup. Written by the
Phase 4 handler `project_analytics_rollup`; read by the Phase 4
read endpoints.

```
Table: analytics_daily_rollup
  user_id         uuid        NOT NULL  -- FK public.users
  dimension       text        NOT NULL  -- AnalyticsDimensionKey
  rollup_date     date        NOT NULL  -- UTC date
  value_numeric   numeric     NULL      -- null when denominator=0
  numerator       bigint      NULL
  denominator     bigint      NULL
  sample_size     integer     NULL      -- count of contributing rows
  evidence_threshold text     NULL      -- null until D-2 is decided
  computed_at     timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (user_id, dimension, rollup_date)
```

If Decision Point D-2.b is chosen, the `evidence_threshold`
column is omitted entirely (the policy is enforced in the
read path, not stored). If D-2.a or D-2.c is chosen, the
column carries the threshold label per row.

### 11.2 `analytics_weekly_rollup`

Same shape as `analytics_daily_rollup` with `rollup_week` (ISO
week, `date` type, Monday-anchored) instead of `rollup_date`.
Written by the same handler once per ISO week boundary.

### 11.3 What is NOT a new table

- `progress_evidence` (Phase 3) remains the canonical evidence
  stream. Phase 4 reads it; it does not write to it.
- `student_model_snapshots` / `student_model_features`
  (Phase 5) are not created in Phase 4 even though the
  Phase 3 `composite` dimension's `sourceTables` already
  lists `student_model_snapshots`. That list is forward-looking;
  the table does not exist yet and Phase 4 does not create
  it.

### 11.4 `recompute_analytics_rollup` SQL function (Class A)

The function is mandated by the Phase 3 plan's deferral list
and the Phase 4 exit criterion ("API output is
reproducible"). Its signature is:

```
recompute_analytics_rollup(
  p_user_id uuid,
  p_since   timestamptz,
  p_until   timestamptz
) returns integer  -- count of rows recomputed
```

The function is idempotent on the primary keys. The
`POST /analytics/admin/recompute` route calls it. The function
exists in the schema; whether the route is wired is in §13.

## 12. HTTP API (Phase 4 additions)

All routes require authentication via the Phase 1 preHandler.
The routes **extend** the Phase 3 `/analytics/*` surface; they
do not replace it.

| Method | Path | Purpose | Class |
|---|---|---|---|
| GET | `/analytics/dimensions` | Unchanged contract, schemaVersion bumped to `2.0.0` (this is a **Class A** schema bump, matching Phase 3's append-only rule) | A |
| GET | `/analytics/dashboards/overview` | Extended with the 6 PRD §24 metrics (Class A), the 7/14/30 series (Class A), and the trend direction per dimension (Class C — D-3) | mixed |
| GET | `/analytics/dashboards/dimension/:key` | Returns the dimension's value, the daily series, the trend direction (D-3), the drill-down IDs (Class A — TRD §18:737-740), and the `explanation` field (Class C — see §15) | mixed |
| GET | `/analytics/dashboards/dimension/:key/explain` | Returns the `explanation` field only | C (depends on §15) |
| POST | `/analytics/admin/recompute` | Service-role only. Calls `recompute_analytics_rollup`. Returns the count. | A |

The `service-role-only` constraint on
`/analytics/admin/recompute` is enforced by the existing
`app.serviceRolePreHandler` from Phase 1.

## 13. Worker and event-bus integration

Phase 4 adds **one** new handler to the Phase 3 registry:
`project_analytics_rollup`. It subscribes to the same 14
event types the Phase 3 `project_progress_evidence` handler
subscribes to. The §13-locked Phase 3 tunables
(`MAX_ATTEMPTS=5`, `BACKOFF_MS=[0, 30s, 2m, 10m, 1h]`,
`LEASE_MS=60_000`, `POLL_INTERVAL_MS=5_000`,
`HANDLER_TIMEOUT_MS=30_000`) are unchanged (Class A — the
PHASE3_PLAN §13.1 decision is locked).

The handler is registered in `apps/api/src/events/event-bus.ts`
alongside the three Phase 3 handlers. The
`event-bus.test.ts` is extended to assert the new subscription
map; the §13 tunables assertion is unchanged.

Whether the `system.tick` handler also recomputes on the
5-minute cadence is a **Class C** decision (D-9). The
previous plan proposed it. The user must approve D-9
separately.

## 14. Tests

Per Engineering Support §42-47 the test taxonomy is locked.

### 14.1 Unit tests (Class A)

- `apps/api/src/analytics/__tests__/formulas.test.ts` — one
  test per PRD §24 metric, plus tests for the zero-denominator
  behavior. The 6 metric formulas are A; the
  zero-denominator return shape (`null`, not `NaN`/`Infinity`)
  is A (TRD §18: "Insight generation can apply thresholds and
  label limited evidence").
- `apps/api/src/analytics/__tests__/drill-down.test.ts` — the
  `drillDown` block's IDs are valid UUIDs from the correct
  source table. (TRD §18:737-740 is the source.)
- `apps/api/src/analytics/__tests__/composite.test.ts` — only
  written if Decision Point D-1.a or D-1.b is chosen. The
  uniform-mean reduction is testable as Class B.

### 14.2 Conditional unit tests (Class C, gated on D-2 / D-3 / D-8)

- `thresholds.test.ts` — only if D-2.a or D-2.c is chosen.
- `trend.test.ts` — only if D-3.a or D-3.c is chosen.
- `next-actions.test.ts` — only if D-8.a or D-8.c is chosen.

### 14.3 Repository / persistence tests (Class A)

- `apps/api/src/db/__tests__/analytics-rollup.test.ts` — upsert
  idempotency on the four-tuple primary key, daily-vs-weekly
  table isolation, foreign-key to `public.users`.

### 14.4 Service / API tests (Class A)

- `apps/api/src/routes/__tests__/analytics-routes.test.ts` —
  extends the Phase 3 test file. New tests cover:
  - `GET /analytics/dashboards/overview` returns all 6 metrics.
  - `GET /analytics/dashboards/dimension/:key` returns the
    daily series and the drill-down IDs.
  - `POST /analytics/admin/recompute` rejects with 401 for a
    non-service-role token and succeeds for the service-role
    token.
  - Cross-tenant test: a user A's request cannot read user
    B's drill-down IDs (Engineering Support §27).
- `apps/api/src/events/__tests__/project_analytics_rollup.test.ts`
  — covers the 14 subscribed event types, idempotency on the
  primary key, and the no-op behavior for unrecognized events.

### 14.5 LIVE_DB-gated (deferred) tests (Class A)

- The full `recompute_analytics_rollup` SQL function under
  concurrent calls (Postgres `SELECT ... FOR UPDATE SKIP
  LOCKED` semantics).
- The end-to-end `event_outbox → project_analytics_rollup →
  analytics_daily_rollup` chain against a real
  `progress_evidence` dataset.

### 14.6 Coverage targets (Class A)

Phase 4 follows the Phase 1/2/3 rule of "no fake metrics, no
synthetic data masquerading as a backend fact" (Engineering
Support §61). Every Class A formula path is covered.

## 15. Explainability (Class A for `drillDown`, Class C for `explanation` text)

The PRD §23 (lines 919-922) names the **drill-down** contract
(Class A):

> "Every important insight links to its supporting topic,
> errors, tests or attempts. A student can move from a
> weak-topic card to the exact mistakes behind it."

TRD §18 (lines 737-740) reinforces it (Class A):

> "Every insight response should include source entity IDs or
> query parameters sufficient for the UI to navigate to
> supporting records."

Phase 4 returns a `drillDown: { metricName: { numeratorIds,
denominatorIds } }` block on every read response, where the
IDs are valid UUIDs from the correct source table (test §14.1).

The **one-sentence `explanation` string** per dimension
(PRD §24:955-958: "Every generated insight should be
explainable in one sentence and drillable to source records")
is Class A in policy and **Class C in template** — the PRD
gives one example, not a catalog. The previous plan proposed
a template-driven approach. The user must approve the
templates (D-10).

**Decision Point D-10:** Pick exactly one of:

- **(D-10.a)** Ship template-driven `explanation` strings
  per dimension (the user reviews and approves each template
  string before Phase 4 ships).
- **(D-10.b)** Ship no `explanation` field in Phase 4. The
  UI is responsible for any human-readable string.

## 16. Verification gates

The Phase 4 plan is closed when **all** of the following pass.
The Class A gates are mandatory; the Class C gates are
gated on the corresponding Decision Point being approved.

1. **Typecheck** — `npm run typecheck` clean across
   `apps/api`, `apps/web`, `packages/shared`. (Class A)
2. **Unit + service + API tests** — all pass with the same
   `LIVE_DB=1` gating as Phase 3. (Class A)
3. **§13 backward-compat** — the locked Phase 3 tunables are
   unchanged. (Class A)
4. **Schema version** — `GET /analytics/dimensions` returns
   `schemaVersion: "2.0.0"` after Phase 4. (Class A)
5. **Six-metric contract** — `GET /analytics/dashboards/overview`
   returns a key for every PRD §24 metric, with the exact
   name. (Class A)
6. **Drill-down IDs are real UUIDs from the correct source
   table.** (Class A)
7. **Cross-tenant defense** — the cross-tenant test passes.
   (Class A)
8. **Idempotency** — a re-delivered envelope does not produce
   a second row in `analytics_daily_rollup`. (Class A)
9. **No Student Model inference** — no `student_model_*`
   table is created, no BKT/IRT calculation is performed, no
   `confidence` / `retention` / `decay` field is returned.
   (Class A — explicit per §2.2)
10. **No Phase 5/6/7/8 code in this branch.** (Class A)
11. **(D-2 conditional)** Sample-size thresholds are honored
    as specified by the user.
12. **(D-3 conditional)** Trend direction is either shipped
    per the user's rule or omitted.
13. **(D-1/D-4 conditional)** The composite is either shipped
    per the user's choice or omitted.
14. **(D-5..D-7 conditional)** Each C-class dimension is
    either shipped per the user's choice or returns `null`.
15. **(D-8 conditional)** The `nextAction` catalog is either
    shipped per the user's choice or returns a single
    fallback string.
16. **(D-9 conditional)** The `system.tick` recompute is
    either enabled or disabled per the user's choice.
17. **(D-10 conditional)** The `explanation` field is
    either shipped per the user's templates or omitted.

## 17. Definition of Done

Phase 4 is "done" when:

1. The Class A test files (§14.1, §14.3, §14.4) exist and
   pass.
2. `GET /analytics/dimensions` returns `schemaVersion:
   "2.0.0"`.
3. `GET /analytics/dashboards/overview` returns the 6 PRD
   §24 metrics (with the exact names) and the 7/14/30 series
   per dimension.
4. `GET /analytics/dashboards/dimension/:key` returns the
   per-dimension value, the daily series, the drill-down
   IDs, and the `evidenceThreshold` field (or its
   null-equivalent under D-2.b).
5. `POST /analytics/admin/recompute` is service-role only
   and returns the recomputed row count.
6. The `project_analytics_rollup` handler is in the
   event-bus registry and subscribes to the 14 event types
   plus `system.tick` (subject to D-9).
7. `recompute_analytics_rollup(p_user_id, p_since,
   p_until)` is a SQL function in the Phase 4 migration.
8. `PHASE4_REPORT.md` is written, reports the exact test
   counts, lists the LIVE_DB-gated tests that remain
   deferred, and lists every Decision Point the user
   approved (D-1..D-10).
9. **No Student Model inference, BKT/IRT, capture, AI,
   or web UI work is in this branch.** (Class A)

## 18. Dependencies

Phase 4 depends on:

- **Phase 1** — schema, migrations, RLS, the
  `record_progress_evidence` RPC, the `idempotency_keys`
  table, the `public.users` table.
- **Phase 2** — every domain service, the Fastify HTTP
  surface, the `app.authPreHandler`, the
  `app.serviceRolePreHandler`, the `event_outbox` write side
  via the producer emissions, the grading decisions.
- **Phase 3** — the event bus orchestrator, the
  `project_progress_evidence` handler, the
  `analytics-dimensions` / `analytics-freshness` /
  `analytics-dashboards` services, the three
  `/analytics/*` endpoints, the §13-locked tunables.

Phase 4 is blocked by:

- Any change to Phase 1's `progress_evidence` schema.
- Any change to Phase 2's `event_outbox` payload shape.
- Any change to Phase 3's `EventEnvelope<T>` or to a key in
  the `ProgressDimension` enum (the catalog is append-only;
  removing a key is a breaking change and is not allowed in
  Phase 4).

Phase 4 blocks:

- **Phase 5** (Student Model) — Phase 5 reads the
  `analytics_daily_rollup` table for its feature engineering
  and writes `student_model_snapshots` /
  `student_model_features`.
- **Phase 6** (Frontend Architecture & Data Integration) —
  the read endpoints are the contract for the dashboard
  route shells.
- **Phase 7** (UI/UX) — same contract, with the
  `explanation` and `nextAction` fields as the primary copy
  source.

## 19. Out of scope (explicit — Class A)

The following are **NOT** Phase 4 work. This list restates
§2.2 with the source-document anchors.

1. BKT / IRT / mastery curves — Phase 5 (Implementation Plan
   §Phase 5; PHASE3_PLAN §12).
2. `student_model_snapshots` / `student_model_features` —
   Phase 5.
3. **Student Model inference of any kind** — confidence,
   retention, decay, behavioral pattern modules (consistency /
   procrastination-recovery / error recurrence / review
   behavior / workload pressure / learning trajectory) —
   Phase 5. **Phase 4 does not implement any Student Model
   inference.** This statement is an explicit phase contract,
   not a rhetorical note.
4. The "Student Model" UI surface — Phase 7.
5. The capture system (camera, microphone, OCR) — Phase 6.
6. The assistant / AI integration — Phase 8.
7. Multi-user comparison / leaderboards / cohort analysis —
   not in any spec; explicitly out of scope.
8. Email / push notification of analytics — Phase 6/7.
9. New authentication providers, billing, exports.
10. Per-user forecast, projection, retention curves, decay
    functions — Phase 5/7.
11. Priority-ranking v1 in the planner — separate plan
    (PRD §4:183-187). Phase 4 exposes only the underlying
    per-error / per-review evidence counts.
12. The `ok()` helper "Reply was already sent" Fastify
    warning — Phase 2 cleanup item, documented in
    [PHASE3_REPORT.md](PHASE3_REPORT.md) §3.4.

## 20. What you should review

1. **`docs/PHASE4_PLAN.md`** (this file) — the binding contract.
2. **PRD §23, §24, §37** — the source of every Class A
   formula and the structural rules. Any change to the
   formulas must amend those sections first.
3. **§22** — the per-item A/B/C classification with the
   source-document line numbers.
4. **§21** — the list of Decision Points the user must
   approve.

## 21. Decision Points (D-1 .. D-10)

These are the explicit product policy decisions the previous
version of this plan treated as authoritative. The user must
approve each one before Phase 4 implementation begins. The
default if the user does not pick a branch is **"do not ship"**
— Phase 4 ships without that feature.

| ID | Subject | Branches | Default |
|---|---|---|---|
| D-1 | Composite shape | D-1.a (Phase 3 12-dim uniform), D-1.b (6-metric uniform), D-1.c (no composite) | do not ship |
| D-2 | Sample-size thresholds | D-2.a (`<5`/`5–19`/`≥20`), D-2.b (no numeric threshold), D-2.c (single binary) | do not ship |
| D-3 | Trend direction | D-3.a (rule + 0.05/3-day), D-3.b (series only, no direction), D-3.c (rule + user thresholds) | do not ship |
| D-4 | Composite weights | D-4.a (uniform), D-4.b (user-supplied), D-4.c (no composite) | do not ship |
| D-5 | C-class dimension rollups (one branch per dimension) | D-5.x (ship the rollup formula) / D-5.null (return null) | do not ship |
| D-6 | Raw-count rollups (`test_attempts`, `planner_*`, `backlog_recovered`, `practice_volume`) | same as D-5 | do not ship |
| D-7 | `consistency` definition | D-5.x (uniform formula) / D-5.null | do not ship |
| D-8 | `nextAction` catalog | D-8.a (9-entry), D-8.b (PRD example + fallback), D-8.c (user-supplied) | do not ship |
| D-9 | `system.tick` recompute on 5-min cadence | yes / no | do not ship |
| D-10 | `explanation` template strings | D-10.a (templates, user reviews), D-10.b (omit field) | do not ship |

## 22. Per-item A/B/C classification (audit table)

Every numeric value, threshold, weight, formula, catalog entry,
or rule in Phase 4 is in this table. The previous plan is
replaced; this table is the source of truth for §21.

### 22.1 Formulas (Class A unless noted)

| Item | Class | Source / derivation |
|---|---|---|
| Test completion rate = Submitted / Started | A | PRD §24:938, §37:1390 |
| Error capture rate = Eligible-incorrect-with-evidence / Eligible-incorrect | A | PRD §24:940, §37:1392 |
| Review completion = Completed / Due | A | PRD §24:942, §37:1394 |
| Correction rate = Qualifying-correct / Completed | A | PRD §24:944, §37:1396 |
| Reopen rate = Reopened / Resolved | A | PRD §24:946, §37:1398 |
| Time to correction = Resolved − Created (median per window) | A | PRD §24:948, §37:1400; median is the standard per-window aggregate (Class B derivation) |
| 4 windows (7d, 14d, 30d, custom) | A | PRD §23:924-927 |
| Default window = 30d | B | most permissive of the three named non-custom windows |
| All windows in UTC | B | Implementation Plan §Phase 4 line 192 ("Use UTC-safe date handling") |
| `submitted`/`started` predicate on `test_attempts` | B | Phase 1 schema enum |
| `is_eligible_for_error_capture` predicate | B | Phase 2 [PHASE2_GRADING_DECISIONS.md](PHASE2_GRADING_DECISIONS.md) |
| `due` predicate on `review_schedules` | B | Phase 2 `review.listSchedules` auto-transition |
| Qualifying-correct outcomes = `correct_uncertain` ∪ `correct_confident` | B | Phase 1 schema enum; PRD says "qualifying" but the qualifying set follows from the enum |
| Reopened / Resolved predicate on `error_entries` | B | Phase 1 schema enum |
| `accuracy = sum(attempt_acc × attempt_size) / sum(attempt_size)` | A | PRD §24 "weighted by attempt size" (per Phase 3 catalog descriptor) |
| Composite (any shape) | **C** | PRD §24 / Implementation Plan do not name weights — D-1, D-4 |
| Per-dimension rollup for `syllabus_coverage` | **C** | PRD §23:910 names "Coverage" in prose only — D-5 |
| Per-dimension rollup for `test_attempts` (raw count) | **C** | not in PRD §24 — D-6 |
| Per-dimension rollup for `planner_completion` | **C** | not in PRD §24 — D-6 |
| Per-dimension rollup for `planner_backlog` | **C** | not in PRD §24 — D-6 |
| Per-dimension rollup for `backlog_recovered` | **C** | not in PRD §24 — D-6 |
| Per-dimension rollup for `practice_volume` (sum of durations) | **C** | not in PRD §24 — D-6 |
| `consistency` = distinct ISO weekdays with ≥ 1 evidence row / 7 | **C** | Implementation Plan §Phase 4 line 182 names "consistency" without definition — D-7 |

### 22.2 Thresholds and numeric policies

| Item | Class | Source / decision |
|---|---|---|
| `< 5` / `5–19` / `≥ 20` ladder | **C** | D-2.a; not in any spec |
| Single binary threshold (e.g. `< 3`) | **C** | D-2.c; not in any spec |
| No numeric threshold (policy only) | **C** | D-2.b; matches strict reading of PRD §23 |
| `evidenceThreshold` response field | A | TRD §18:733-734 ("apply thresholds and label limited evidence") |
| `0.05` trend threshold | **C** | D-3.a; not in any spec |
| 3-distinct-days minimum for trend | **C** | D-3.a; not in any spec |
| Half-vs-half comparison method | **C** | D-3.a; not in any spec |
| Four-value trend enum | **C** | D-3.a; not in any spec |
| 6-dimension minimum for composite | **C** | D-1.a default in previous plan; not in any spec |
| No-activity → `value: null` (not `0`) | A | Implementation Plan §Phase 4 line 190 ("No activity → perfect performance" guardrail interpreted as "do not return 0"; the rule is Class A, the "→ null" return shape is the only way to honor it) |

### 22.3 Catalog entries and response fields

| Item | Class | Source / decision |
|---|---|---|
| `nextAction` field present on empty metrics | A | PRD §24:961-963 |
| Single `nextAction` example string "Take a test in this topic" | A | PRD §24:962 verbatim |
| 9-entry `nextAction` catalog | **C** | D-8.a; the catalog is invented |
| `drillDown` field with `numeratorIds` / `denominatorIds` | A | TRD §18:737-740 |
| `explanation` one-sentence field per dimension | A (policy) | PRD §24:955-958 |
| `explanation` template strings | **C** | D-10; the template is invented |
| `numerator` / `denominator` / `sampleSize` in every metric response | A | TRD §18:733-734 |
| No composite when Student Model table does not exist | A | Implementation Plan §Phase 5; `student_model_snapshots` is Phase 5 |

### 22.4 Schema-version and table shapes

| Item | Class | Source / derivation |
|---|---|---|
| `analytics_daily_rollup` PK = (user_id, dimension, rollup_date) | B | mirrors `progress_evidence` PK pattern |
| `analytics_weekly_rollup` PK = (user_id, dimension, rollup_week) | B | same |
| `recompute_analytics_rollup(p_user_id, p_since, p_until) returns integer` | A | Phase 3 plan §12 deferral |
| `evidence_threshold` column on `analytics_daily_rollup` | **C** | D-2.a / D-2.c only; D-2.b omits the column |
| `student_model_snapshots` not created in Phase 4 | A | Implementation Plan §Phase 5 |
| Schema version bump to `2.0.0` | A | Phase 3 source comment ("append-only; existing keys keep their meaning") |
| `event_outbox` columns unchanged | A | PHASE3_PLAN §13.1 |

### 22.5 Tunables, routing, and infrastructure

| Item | Class | Source / derivation |
|---|---|---|
| `MAX_ATTEMPTS=5` | A | PHASE3_PLAN §13.1 |
| `BACKOFF_MS=[0, 30s, 2m, 10m, 1h]` | A | PHASE3_PLAN §13.1 |
| `LEASE_MS=60_000` | A | PHASE3_PLAN §13.1 |
| `POLL_INTERVAL_MS=5_000` | A | PHASE3_PLAN §13.1 |
| `HANDLER_TIMEOUT_MS=30_000` | A | PHASE3_PLAN §13.1 |
| `system.tick` synthetic envelope | A | PHASE3_PLAN §13.1 |
| `system.tick` triggers 5-min recompute in Phase 4 | **C** | D-9; not in any spec |
| Service-role-only `/analytics/admin/recompute` | A | Phase 1 `app.serviceRolePreHandler` |
| Cross-tenant defense on every read | A | Engineering Support §27, TRD §7 |

### 22.6 Things this plan explicitly does not do

- No Student Model inference of any kind. The §2.2 / §19 / §22
  classification is **A** for this exclusion (Phase 5 owns it,
  per Implementation Plan §Phase 5 and PHASE3_PLAN §12). If a
  future revision of this plan claims Phase 4 does Student
  Model inference, that is a scope error and must be removed.

## 23. Final status

- **Plan revised and STOPPED at the planning boundary.** No
  Phase 4 code is in this branch.
- **The plan is conditional on the user approving §21
  Decision Points D-1..D-10.** The default for every C item
  is "do not ship" — Phase 4 ships without that feature
  until the user explicitly approves it.
- The Class A items (six PRD §24 metrics, the 4 windows, the
  drill-down response shape, the §13-locked Phase 3 tunables,
  the `recompute_analytics_rollup` SQL function, the
  no-Student-Model-inference contract) are unconditional and
  ship in Phase 4 as written.
- Phase 4 will not begin until the user approves this
  revised plan and every Decision Point in §21.
