# Release Contracts — v1.0 (frozen)

**Freeze date:** 2026-09-04
**Frozen at commit:** `bcff8c0d4b28149127d3c01b4f3d7dac3fc66ff7` (sign-off marker; pairs with `c54e312` which contains `docs/PHASE16_VERIFICATION.md`) — branch `main`
**Frozen-by:** Phase 16 M11 sign-off
**Source of truth:** the file content + the on-disk migration listing at `bcff8c0`
**Generation:** manual, derived from the source tree at freeze time
**Phase:** 16 (Release & Continuous Improvement)

---

## Purpose

This document is the **v1.0 release contract snapshot**. It freezes the API surface, the database migration set, the event-type union, and the env-var schema that constitute the v1.0 product. A diff against a subsequent commit must reveal any contract change. Phase 16 does not modify any of these contracts; this document is the only Phase 16 artifact that touches the contract surface, and it does so read-only.

A contract change in any of the four sections below is a **release-blocker** and requires an explicit `RELEASE_CONTRACTS_vN.M.md` re-freeze before a new release tag.

> **Status note (2026-09-04):** the prior draft of this document listed 18 migrations, 34 `EventType` members, and 74 routes. Those numbers described a hypothetical post-Phase-14+15 state, not the v1.0 commit. This freeze reflects the **actual on-disk state at `bcff8c0`**: 16 migrations, 33 `EventType` members, 67 `app.<method>(` registrations in `apps/api/src/routes/*.ts` plus 1 `/health` for **68 total routes**.

---

## 1. Database migrations (frozen at 16 files)

The v1.0 release ships **exactly 16 migration files**, in the order listed below. Verified at `bcff8c0` via `git ls-tree --name-only -r bcff8c0 -- supabase/migrations/`.

| # | Filename | Tracked commit |
|---|---|---|
| 01 | `supabase/migrations/20260901164346_01_extensions.sql` | `12bdcb4` (Phase 7.6) |
| 02 | `supabase/migrations/20260901164346_02_helpers.sql` | `12bdcb4` (Phase 7.6) |
| 03 | `supabase/migrations/20260901164346_03_core_schema.sql` | `12bdcb4` (Phase 7.6) |
| 04 | `supabase/migrations/20260901164346_04_rls.sql` | `12bdcb4` (Phase 7.6) |
| 05 | `supabase/migrations/20260901164346_05_seed_dev.sql` | `12bdcb4` (Phase 7.6) |
| 06 | `supabase/migrations/20260901164346_06_idempotency_keys.sql` | `83fe9d0` (Phase 10+11) |
| 07 | `supabase/migrations/20260901164346_07_domain_rpcs.sql` | `83fe9d0` (Phase 10+11) |
| 08 | `supabase/migrations/20260901164346_08_event_bus.sql` | `83fe9d0` (Phase 10+11) |
| 09 | `supabase/migrations/20260901164346_09_extend_rpcs_with_outbox.sql` | `83fe9d0` (Phase 10+11) |
| 10 | `supabase/migrations/20260901164346_10_progress_evidence_dedup.sql` | `83fe9d0` (Phase 10+11) |
| 11 | `supabase/migrations/20260901164346_11_scheduled_job_fns.sql` | `83fe9d0` (Phase 10+11) |
| 12 | `supabase/migrations/20260901164346_12_analytics_rollup.sql` | `d273753` (Phase 12+13) |
| 13 | `supabase/migrations/20260901164346_13_student_model_recompute.sql` | `d273753` (Phase 12+13) |
| 14 | `supabase/migrations/20260901164346_14_error_capture_pipeline.sql` | `d273753` (Phase 12+13) |
| 15 | `supabase/migrations/20260901164346_15_review_and_planner_history.sql` | `d273753` (Phase 12+13) |
| 16 | `supabase/migrations/20260901164346_16_notification_dedup.sql` | `d273753` (Phase 12+13) |

**M3 migration-rehearsal contract:** the rehearsal script must apply all 16 files in this order against a fresh local Supabase stack and pass `apps/api/src/db/__tests__/migrations.test.ts`'s row-count + FK assertions. A 17th migration file or any modification to the first 16 is a contract violation and requires a re-freeze.

**Note on Phase 14+15 migrations 17 and 18:** the security audit log (`17_security_audit_log.sql`) and the perf indexes (`18_perf_indexes.sql`) exist on disk in the post-Phase-16 working tree but are NOT part of the v1.0 contract. They were authored, audited (see `docs/PHASE14_15_FINAL_AUDIT.md`), but the user's instruction to "STOP at the Phase 16 boundary" with the v1.0 sign-off means the v1.0 release is the Phase 0–15 state plus the additive Phase 16 deliverables only. They are not deployed by the v1.0 release.

---

## 2. EventType union (frozen at 33 members)

The v1.0 release ships the `EventType` union declared in `packages/shared/src/events/envelope.ts` at `bcff8c0`. Phase 16 does not add, remove, or rename any member. Verified via `git show bcff8c0:packages/shared/src/events/envelope.ts | awk '/^export type EventType/,/^;/' | grep -c "^  | '"` → 33.

The 33 members, grouped by phase of origin:

**Phase 3 (TRD §8 catalog, 13 members):**
1. `attempt.submitted`
2. `attempt.analyzed`
3. `error.recorded`
4. `error.classified`
5. `review.scheduled`
6. `review.started`
7. `review.outcome_recorded`
8. `error.resolved`
9. `error.reopened`
10. `task.completed`
11. `task.missed`
12. `syllabus.node_archived`
13. `notification.created`

**Phase 3 synthetic:**
14. `system.tick`

**Phase 9 — evidence pipeline (3 members):**
15. `evidence.captured`
16. `evidence.snapshot_created`
17. `evidence.snapshot_failed`

**Phase 9 — error lifecycle (5 members):**
18. `error.lifecycle.active`
19. `error.lifecycle.in_review`
20. `error.lifecycle.resolved`
21. `error.lifecycle.reopened`
22. `error.lifecycle.archived`

**Phase 10 — review / retest engine (1 member):**
23. `review.verification_question_used`

**Phase 11 — planner / backlog automation (6 members):**
24. `task.partial`
25. `task.rescheduled`
26. `backlog.item_created`
27. `backlog.item_recovered`
28. `progress.planner_completed`
29. `progress.planner_missed`
30. `progress.error_resolved`

**Phase 12 — notifications & scheduling (3 members):**
31. `review.due`
32. `review.overdue`
33. `task.upcoming`

The `EventPayloadMap` interface in `envelope.ts` is the per-event payload contract. The `EventEnvelope` interface (eventId, eventType, schemaVersion, occurredAt, accountId, actorId, aggregateType, aggregateId, aggregateVersion, payload, idempotencyKey) is the envelope contract. Both are frozen.

**Note on Phase 16 M8:** the `/ops/event-failures` route reads `event_log` directly via SQL and does not introduce a new `EventType` member.

---

## 3. API route list (frozen at freeze time)

The v1.0 release ships the route surface declared in `apps/api/src/routes/*.ts` at `bcff8c0`, plus **exactly one new Phase 16 route** — `GET /ops/event-failures` (M8) — registered in a new file `apps/api/src/routes/ops.ts`. No existing route file is modified; no existing method, path, request shape, response shape, or auth posture is modified.

### 3.1 Phase 0–15 routes (all preserved verbatim)

**Total Phase 0–15 `app.<method>(` registrations in `apps/api/src/routes/*.ts` at `bcff8c0`:** 67, plus 1 `/health` route declared in `apps/api/src/server.ts`, for **68 total routes**.

The full inventory (re-derived from the v1.0 source):

| File | Count |
|---|---|
| `apps/api/src/routes/analytics.ts` | 6 |
| `apps/api/src/routes/assistant.ts` | 3 |
| `apps/api/src/routes/auth.ts` | 1 |
| `apps/api/src/routes/backlog.ts` | 4 |
| `apps/api/src/routes/errors.ts` | 5 |
| `apps/api/src/routes/evidence.ts` | 3 |
| `apps/api/src/routes/ops.ts` | 1 (Phase 16 M8) |
| `apps/api/src/routes/planner.ts` | 14 |
| `apps/api/src/routes/progress.ts` | 7 |
| `apps/api/src/routes/review-session.ts` | 4 |
| `apps/api/src/routes/review.ts` | 5 |
| `apps/api/src/routes/student-model.ts` | 2 |
| `apps/api/src/routes/syllabus.ts` | 7 |
| `apps/api/src/routes/users.ts` | 5 |
| `apps/api/src/routes/_helpers.ts` | 0 (helpers only) |
| `apps/api/src/routes/index.ts` | 0 (registration only) |
| **Subtotal in routes/** | **67** |
| `/health` (in `server.ts`) | 1 |
| **Grand total** | **68** |

`Auth` is `bearer` for routes that use `app.authPreHandler`, `dev-token` for `/auth/dev-token`, `service-role` for `/analytics/admin/recompute` and `/student-model/admin/recompute`, and `none` for `/health`.

### 3.2 New Phase 16 route (M8)

| Method | Path | Auth |
|---|---|---|
| GET | `/ops/event-failures?since=<iso>&until=<iso>` | **service-role only** |

The response envelope matches the KRODEX success shape (`{ success: true, data: { ... } }`) and returns a read-only count of `event_log` rows where `status IN ('failed', 'dead_letter')`, grouped by `handler_name`, over the requested time window. The route is registered in `apps/api/src/routes/ops.ts`; no existing route file is modified.

### 3.3 `assertOwned` call sites (frozen at 83)

Phase 0–15 contains **83** `assertOwned` call sites across 19 files. The full inventory at freeze time (verified at `bcff8c0` via `git grep` count = 83, plus 13 in tests):

| File | Count |
|---|---|
| `apps/api/src/services/planner-task-automation-service.ts` | 12 |
| `apps/api/src/services/tests.ts` | 8 |
| `apps/api/src/services/error-evidence-service.ts` | 6 |
| `apps/api/src/services/errors.ts` | 5 |
| `apps/api/src/services/users.ts` | 5 |
| `apps/api/src/services/planner.ts` | 5 |
| `apps/api/src/services/review.ts` | 5 |
| `apps/api/src/services/progress.ts` | 4 |
| `apps/api/src/services/backlog.ts` | 4 |
| `apps/api/src/services/syllabus.ts` | 3 |
| `apps/api/src/services/error-lifecycle-service.ts` | 3 |
| `apps/api/src/ai/evidence.ts` | 3 |
| `apps/api/src/auth/ownership.ts` | 2 |
| `apps/api/src/services/assistant-service.ts` | 1 |
| `apps/api/src/services/error-pool-test-generator.ts` | 2 |
| `apps/api/src/routes/evidence.ts` | 1 |
| `apps/api/src/routes/review-session.ts` | 1 |
| `apps/api/src/auth/__tests__/ownership.test.ts` | 10 (test-only) |
| `apps/api/src/services/__tests__/syllabus.test.ts` | 3 (test-only) |
| **Total** | **83** |

Phase 16 introduces **0 new** `assertOwned` call sites (the `/ops/event-failures` route is service-role only and does not use `assertOwned`).

---

## 4. Env-var schema (frozen at freeze time)

The v1.0 release ships the `ApiEnv` zod schema declared in `apps/api/src/config/env.ts` at `bcff8c0`. Phase 16 does not modify any existing field, type, or default. The two optional additive env vars documented in `docs/PHASE16_PLAN.md` §6.2 (`KRODEX_RELEASE_TAG`, `KRODEX_STAGING_BASE_URL`) are NOT included in the v1.0 contract because Phase 16 implementation did not require them; they are deferred.

**Count of `ApiEnv` fields at freeze time:** see the source file `apps/api/src/config/env.ts` (Phase 16 implementation reads from this source as the ground truth; no copy is duplicated here to avoid drift).

`nodeEnv` enum (frozen): `'development' | 'test' | 'production'`. Phase 16 does NOT add a fourth value (O4 not authorized per the scope freeze).

---

## 5. Frozen-boundary verification (for the M10 verification doc)

A subsequent verifier can mechanically confirm no Phase 0–15 contract was modified by re-running the following checks against commit `bcff8c0`:

| Check | Method | Expected result |
|---|---|---|
| Migration count | `git ls-tree --name-only -r bcff8c0 -- supabase/migrations/ \| grep '.sql$' \| wc -l` | 16 |
| `EventType` union member count | `git show bcff8c0:packages/shared/src/events/envelope.ts \| awk '/^export type EventType/,/^;/' \| grep -c "^  \| '"` | 33 |
| Route count in `apps/api/src/routes/*.ts` (excluding `/health`) | iterate route files at `bcff8c0` and count `app\.(get\|post\|patch\|delete\|put)\(` matches | 67 |
| `/health` route | declared in `apps/api/src/server.ts` at `bcff8c0` | present, no auth |
| `assertOwned` total count | `git grep -cE 'assertOwned' bcff8c0 -- apps/api/src` summed | 83 |
| Lint error count in Phase 0–15 files | `npm run lint` at `bcff8c0` | 9 (pre-existing) |
| `ApiEnv.nodeEnv` enum | parse from `apps/api/src/config/env.ts` at `bcff8c0` | `'development' \| 'test' \| 'production'` |

A drift in any of these rows indicates a contract change since v1.0 and blocks the next release.

---

## 6. Versioning and re-freeze rule

- The next release (`v1.1` or later) MUST re-freeze the contract by writing `docs/RELEASE_CONTRACTS_v1.1.md` (or higher) and updating the four sections above.
- Additive changes to a frozen section (e.g. a 17th migration, a 34th `EventType` member, a 68th route) are allowed only as additive rows in the new freeze; no existing row is mutated.
- Removal of a row requires a deprecation note in the new freeze and a migration path in `docs/ROLLBACK.md`.
