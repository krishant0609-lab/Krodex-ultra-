# KRODEX v1.0 — DEPLOYMENT VERIFICATION (v1.0-verified)

**Date:** 2026-09-05
**Branch:** `deployment/v1.0-production` (from `v1.0-verified` → `c746c18`)
**Protected tag:** `v1.0-verified` (preserved unchanged)
**Existing tag:** `v1.0` (preserved unchanged at `c54e312`)

---

## Status

# 🟥 BLOCKED

The KRODEX application is **ready to deploy** but the deployment target environment
**does not exist** in a deployable state. The protected `v1.0-verified` source is
clean, verified, and reproducible. The deployment cannot proceed because:

1. The Supabase project contains a **legacy schema** from a different product.
2. No Vercel project exists.
3. No Railway service exists.
4. No production credentials were provided in this session.

Per the master directive §1 rule 7 ("DO NOT create fake deployment success") and §21
("If migrations cannot safely be applied, STOP and report exactly what is missing"),
no part of the live stack was created. No env file was written, no migration was
applied, no service was pushed.

---

## Protection

| Item | Value |
|---|---|
| Protected tag | `v1.0-verified` (preserved) |
| Tag commit | `c746c18` |
| Existing tag | `v1.0` (preserved at `c54e312`) |
| Deployment branch | `deployment/v1.0-production` |
| Branch HEAD | `15eeda7` (this report's parent — working tree was clean) |
| Deployment commit | *(none — no deployment changes were made)* |
| `bcff8c0` history | preserved unchanged |
| Phase 0–16 contracts | not modified |

---

## Re-verification (Phase B)

| Check | Result |
|---|---|
| `apps/api` vitest | 1001 passed / 22 skipped / 0 failed (1 unhandled `process.exit(1)` from the integration test's negative-path branch — pre-existing, not a test failure) |
| `apps/web` vitest | 193 passed / 0 failed |
| Combined | **1194 passed / 22 skipped / 0 failed** (matches v1.0-verified baseline) |
| TypeScript (`@krodex/shared`) | clean |
| TypeScript (`@krodex/api`) | clean |
| TypeScript (`@krodex/web`) | clean |
| Production build (`next build`) | succeeded — 18 static + 9 dynamic routes compiled |
| Lint baseline | 9 errors / 48 warnings (pre-existing, untouched per master directive) |

The protected `v1.0-verified` state is reproducible. No re-verification defect was
discovered.

---

## Supabase (Phase D) — 🔴 INCOMPATIBLE

| Item | Actual | Required | Status |
|---|---|---|---|
| Project ID | `uuavcvqcgosehhjadfij` | (same) | ✅ reachable |
| Status | `ACTIVE_HEALTHY` | healthy | ✅ |
| Region | `ap-northeast-1` | any | ✅ |
| Postgres | 17.6.1.166 | any | ✅ |
| Schema | **legacy (19 tables from a different product design)** | KRODEX Phase 0–15 schema (35+ tables) | **❌ INCOMPATIBLE** |

**Tables the application actually queries (sample of 35+):**

`analytics_daily_rollup`, `audit_events`, `backlog_items`, `backlog_recoveries`,
`backlog_recovery_events`, `error_entries`, `error_evidence`, `error_lifecycle_events`,
`error_question_links`, `event_log`, `event_outbox`, `evidence_assets`,
`idempotency_keys`, `notification_deliveries`, `notifications`, `planner_task_events`,
`planner_tasks`, `planner_templates`, `progress_evidence`, `question_options`,
`questions`, `review_attempts`, `review_schedules`, `student_model_features`,
`student_model_snapshots`, `test_answers`, `test_attempts`, `test_definitions`,
`test_questions`, `verification_questions`, …

**Tables actually present in the remote project (19):**

`ai_conversations`, `ai_messages`, `ai_provider_connections`, `background_job_runs`,
`background_jobs`, `chapters`, `pending_actions`, `profiles`, `session_topics`,
`student_backlog_items`, `student_error_logs`, `student_history`,
`student_notification_preferences`, `student_notifications`, `student_profiles`,
`study_sessions`, `subject_progress`, `subjects`, `topics`

**Zero overlap** on the application's required tables. The remote is a **different
product's database**, not an empty or Phase-0-15-target project. The 18
`supabase/migrations/*.sql` files in this repository cannot be applied on top of
this schema without a destructive reset, which would destroy existing data.

The remote also has rows in `profiles` (1), `subjects` (3), `chapters` (4),
`topics` (18), `study_sessions` (11), `student_error_logs` (9),
`student_notifications` (4), `student_backlog_items` (14), `ai_conversations` (6),
`ai_messages` (12). It is a **used** database belonging to another product.

### The required 18 migrations, none applied

| # | Migration | Status |
|---|---|---|
| 01 | `20260901164346_01_extensions.sql` | not applied |
| 02 | `20260901164346_02_helpers.sql` | not applied |
| 03 | `20260901164346_03_core_schema.sql` | not applied |
| 04 | `20260901164346_04_rls.sql` | not applied |
| 05 | `20260901164346_05_seed_dev.sql` | not applied |
| 06 | `20260901164346_06_idempotency_keys.sql` | not applied |
| 07 | `20260901164346_07_domain_rpcs.sql` | not applied |
| 08 | `20260901164346_08_event_bus.sql` | not applied |
| 09 | `20260901164346_09_extend_rpcs_with_outbox.sql` | not applied |
| 10 | `20260901164346_10_progress_evidence_dedup.sql` | not applied |
| 11 | `20260901164346_11_scheduled_job_fns.sql` | not applied |
| 12 | `20260901164346_12_analytics_rollup.sql` | not applied |
| 13 | `20260901164346_13_student_model_recompute.sql` | not applied |
| 14 | `20260901164346_14_error_capture_pipeline.sql` | not applied |
| 15 | `20260901164346_15_review_and_planner_history.sql` | not applied |
| 16 | `20260901164346_16_notification_dedup.sql` | not applied |
| 17 | `20260901164346_17_security_audit_log.sql` | not applied |
| 18 | `20260901164346_18_perf_indexes.sql` | not applied |

No migration from the repository was applied to the production project.

### Why this is a blocker, not a fixable misconfiguration

The 18 KRODEX migrations use `CREATE TABLE` and `CREATE TYPE` statements that would
fail with `relation already exists` errors against the legacy schema (e.g. the
remote has its own `profiles`, `subjects`, `chapters`, `topics`,
`student_notifications`, `student_backlog_items`, etc. with conflicting column
names and enums). The migrations are also not idempotent — they are forward-only
DDL. Applying them requires a **fresh, empty** database.

---

## Vercel — ⚪ NOT PROVISIONED

| Item | Value |
|---|---|
| Vercel team | `krodex` (`team_xIoMYMcOyUwDXXc65rFmyvwi`) |
| Plan | hobby |
| Vercel projects in team | **0** |
| Frontend URL | (not deployed) |

No Vercel project was created in this session. The Vercel MCP was reachable but
project creation requires explicit operator authorization and a billing-tier
decision beyond the prompt's "deploy only" scope, so I did not create one.

---

## Railway — ⚪ NOT PROVISIONED

| Item | Value |
|---|---|
| Railway account | (not used in this session) |
| Railway MCP | not available in this session |
| Service | (not deployed) |
| API URL | (none) |

The master directive named Railway as the persistent host for the Fastify API +
worker + scheduler, but no Railway MCP was available. I did not invent or
synthesize a Railway account, nor did I push to any host pretending to be
Railway. Without an actual Railway service, the API + worker + scheduler cannot
be deployed.

---

## Production credentials — ⚪ NOT PROVIDED

The master directive §8 requires configuring environment variables including
Supabase URL, anon key, service-role key, web origin, etc. None of these were
provided in the session. The only known Supabase project URL is
`https://uuavcvqcgosehhjadfij.supabase.co`, but the anon and service-role keys
were not supplied and were not retrieved. **No `.env` file was created.** **No
secret value was logged.**

---

## Background jobs — ⚪ NOT VERIFIED

| Job | Cadence | Status |
|---|---|---|
| Outbox poll | 5s | not verified (no API process) |
| `mark_review_due` | 5 min | not verified |
| `detect_task_missed` | 15 min | not verified |
| `recompute_analytics_rollup` | 5 min | not verified |
| `recompute_student_model` | 5 min | not verified |

The job cadences are unchanged in source. Without a running Railway service, no
job execution can be observed.

---

## Notifications — ⚪ NOT VERIFIED

No notification path was exercised end-to-end. The `notifications` table does not
exist in the remote. No deduplication, projection, or delivery can occur.

---

## Security — ⚪ NOT VERIFIED

No production security boundary was exercised. The existing security middleware
(`@fastify/helmet`, `@fastify/rate-limit`, `@fastify/under-pressure`,
`audit-logger`) is present in the source and verified in unit tests, but a
running deployment would be required to confirm production behavior.

---

## Rollback (Phase 17) — ⚪ NOT DEMONSTRATED

The Phase 16 PARTIAL verdict was driven by the absence of a **deployed**
rollback demonstration. That absence is unchanged: there is no deployed
environment on which to demonstrate rollback.

---

## Required operator actions to unblock

To complete the deployment, the operator must:

1. **Provision a fresh Supabase project** (or wipe the existing
   `uuavcvqcgosehhjadfij` project after exporting any legacy data the operator
   wants to keep — but note that legacy data is from a different product and is
   not compatible with KRODEX).
2. **Provide the new project URL, anon key, and service-role key.**
3. **Create a Vercel project** for `apps/web` (or authorize me to do so).
4. **Provision a Railway service** (or authorize an alternative persistent host
   such as Render, Fly.io, or a VM) for `apps/api`, with the existing Fastify
   start command `node dist/server.js` and a Nixpacks or Dockerfile-based build.
5. **Confirm the production web origin URL** (e.g. `https://krodex.vercel.app`)
   so it can be set as `CORS_ALLOWED_ORIGINS` and `WEB_ORIGIN` on the API.

After these five items, the deployment can proceed in this order:
1. Apply the 18 migrations to the fresh Supabase database.
2. Configure Railway env from the operator-provided values.
3. Push the API to Railway.
4. Configure Vercel env (`NEXT_PUBLIC_API_BASE_URL` = Railway URL).
5. Push the web to Vercel.
6. Run the real-deployed smoke tests (Phase 11).
7. Verify background workers (Phase 12).
8. Demonstrate the rollback procedure (Phase 17) — this is the only remaining
   Phase 16 PARTIAL sub-gate (b).

---

## Known limitations

1. **No production deployment exists.** Every Phase 11+ check (real deployed
   flows, real notifications, real worker, real rollback demonstration) is
   `⚪ NOT VERIFIED` for the simple reason that nothing was deployed.
2. **Supabase target is occupied by a different product's schema.** A fresh
   database is required.
3. **No Railway MCP was available** in this session. The deployment plan names
   Railway, but the operator must provision the service themselves or authorize
   an alternative host.
4. **The `docs/perf-baseline.json` measurement reflects the local integrated
   stack**, not a deployed environment. It is not a production SLO.
5. **The existing v1.0 PARTIAL verdict** (Phase 16 §4.3 sub-gate b) is
   unchanged. The protection tag `v1.0-verified` documents the verified code
   state, not a verified production deployment.

---

## Final verdict

# 🟥 BLOCKED

The KRODEX v1.0-verified source is **production-ready** and reproducible. The
deployment target environment is **not present** in a deployable state. Five
operator actions are required (see above). No further action can be taken
without operator authorization and the missing environment.
