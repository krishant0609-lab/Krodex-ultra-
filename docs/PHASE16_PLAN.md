# Phase 16 — Release & Continuous Improvement — Implementation Plan

**Plan type**: Pre-implementation plan (read-only)
**Plan date**: 2026-09-04
**Branch**: `main`
**Plan basis**: PIP v2.0 §Phase 16 (lines 641–678 of `KRODEX_Project_Implementation_Plan_From_Scratch_v2.txt`), TRD §39 (Infrastructure-as-Code + Deployment Pipeline + Operational Alerts + Runbook Requirement, lines 1483–1541), Engineering Support Specification §57 (Security Acceptance, lines 1513–1535) and §58 (Production Readiness, lines 1598–1624), PRD Appendix A (End-to-End Acceptance Matrix, lines 1470–1527), and the actual repository state at planning time.
**Plan author intent**: This is a *plan only*. No code, dependencies, migrations, configuration, tests, or documentation are modified by this document.

---

## 0. Authorization Posture

Phase 16 has been **explicitly out of scope for Phases 0–15** in every prior phase plan and verification. The Phase 14 + 15 final audit (2026-09-04) confirmed "Phase 16 has not been started." This document proposes Phase 16 for authorization, but **does not implement it**. Implementation only begins after explicit approval.

---

## 1. Phase 16 Definition (PIP v2.0 verbatim, lines 641–678)

> **Release & Continuous Improvement** — Release only after acceptance and establish a controlled feedback loop.
>
> **Work package** —
> - Create release candidate.
> - Freeze schema/API contracts for release.
> - Run migration rehearsal.
> - Run E2E smoke suite.
> - Verify environment variables.
> - Create rollback plan.
> - Release staged.
> - Monitor errors and domain-event failures.
>
> **Engineering guardrails** —
> - No last-minute feature additions during release validation.
> - Document known limitations.
> - Every post-release fix gets a regression test.
> - Keep product analytics privacy-conscious.
>
> **Verification gate** — Exit: release checklist signed and rollback path demonstrated.
>
> **Definition of Done** — Same DoD as Phases 1–15 (type-safe, lint-clean, automated tests, no fake data, observable through source records, docs and migration notes updated).

**Cross-references in governing specs:**
- **TRD §39 (lines 1483–1541)** — IaC components, deployment-pipeline stage gates, operational alert categories, runbook requirement. The Phase 16 implementation must produce concrete evidence against these gates.
- **TRD §40 (lines 1544+)** — Architecture Acceptance Matrix; Phase 16 must demonstrate the architecture is "releasable" against every row.
- **Engineering Support §57 (Security Acceptance, line 1517)** — "Security tests are release blockers." Phase 16 release cannot pass unless the Phase 14 security suite is green.
- **Engineering Support §58 (Production Readiness, line 1600–1624)** — "Deployment is not approved because the build passes alone." Phase 16 must demonstrate, not assume, that the 8 contract bullets (real auth, real DB, no test bypass, no fake metrics, no placeholder AI claims, idempotent automations, private evidence protection, monitoring + rollback) hold in the deployed environment.
- **PRD Appendix A (lines 1470–1527)** — The 22-scenario E2E acceptance matrix is the minimum release checklist for the complete product. Phase 16 must produce a release sign-off that covers this matrix in a real environment.

---

## 2. Current State (inspected from the repository at planning time)

### 2.1 What exists from Phase 0–15

| Area | Status | Evidence |
|---|---|---|
| Fastify API (`apps/api`) | Implemented, 986 vitest pass / 22 skip, build clean | `apps/api/src/server.ts`, `apps/api/src/__tests__/phase15-smoke.test.ts` |
| Next.js web (`apps/web`) | Implemented, build clean (50+ routes) | `apps/web/next.config.mjs` |
| Supabase migrations | 18 migrations, ordered, 14 RPCs, event bus, idempotency | `supabase/migrations/20260901164346_*.sql` |
| `assertOwned` ownership isolation | 83 call sites preserved (Phase 12–13 baseline + Phase 14/15 deltas) | `apps/api/src/routes/*.ts` |
| `EventType` union | Frozen | `packages/shared/src/events/envelope.ts` |
| Notification dedup + per-kind preferences | Operational (Phase 12) | `apps/api/src/services/notification-*.ts` |
| Audit log table + best-effort logger | Wired at 2 call sites: `EVIDENCE_ASSET_SOFT_DELETE`, `ANALYTICS_ADMIN_RECOMPUTE` (and 5 other `AuditAction` enum values) | `apps/api/src/security/audit-logger.ts`, `supabase/migrations/..._17_security_audit_log.sql` |
| Security middleware (rate limit, helmet, under-pressure, X-Request-ID) | `installSecurity(app, env, opts)`; defaults ON unless `env.nodeEnv === 'test'` | `apps/api/src/security/install-security.ts` |
| Perf baseline (vitest-driven + Node-fetch fallback) | `phase15-perf-baseline.test.ts` writes `docs/perf-baseline.json`; `scripts/perf-baseline.mjs` is the production-shaped path | `apps/api/src/__tests__/phase15-perf-baseline.test.ts`, `scripts/perf-baseline.mjs` |
| E2E suite | 16 Playwright specs against fixture server | `apps/web/tests/e2e/*.spec.ts` |
| Secret scanner | `scripts/check-secrets.sh` + opt-in `scripts/install-hooks.sh` | both exist; pre-commit hook is NOT installed (documented opt-in posture) |
| `npm run security:check` | `npm audit --audit-level=moderate --omit=dev` | `package.json:31` |
| `/health` endpoint | Reports service, version, db, event_bus, security policy block | `apps/api/src/server.ts:102-133` |
| Pino structured logging | Throughout the API | `apps/api/src/errors/error-handler.ts`, `worker.ts`, etc. |

### 2.2 What is missing (Phase 16 gaps)

| Gap | PIP §16 requirement it blocks | Evidence of absence |
|---|---|---|
| **No CI pipeline** | "Run lint/typecheck", "Unit tests", "Integration tests", "Build", "Migration check", "E2E" (TRD §39 deployment pipeline) | No `.github/`, no `.gitlab-ci.yml`, no Jenkinsfile, no `vercel.json`, no `render.yaml`, no `fly.toml`. TRD §39 explicitly enumerates 8 deployment-pipeline stages. |
| **No deployment artifacts (host target)** | "Web/API runtime, PostgreSQL, Queue/worker, Redis if used, Object storage, Secrets, DNS/TLS, Monitoring/alerting, Backup storage" (TRD §39) | No Dockerfile, no `docker-compose.yml`, no Helm chart, no Terraform, no Pulumi, no `vercel.json`, no `render.yaml`, no `fly.toml`. **This is the host-target question (O7, §11 Q1) — independent of the `nodeEnv` tier question (O4, §11 Q2).** The M1 CI is host-agnostic and does not require a host target. The M5 rollback demonstration (§4.3 sub-gate (a)) is the only Phase 16 item that requires a deployed environment. |
| **No `staging` tier in `ApiEnv.nodeEnv`** (separately from "no host target") | "Release staged" + "Deploy staging" / "Production" gates (TRD §39) | `ApiEnv.nodeEnv` is `'development' \| 'test' \| 'production'`. There is no `staging` value. This is the O4 question — see §3.2 and §11 Q2. **Distinct from the host-target question in §11 Q1** (where the deployed environment runs). |
| **No operational alerts** | "Submission failure spike, Evidence capture failure spike, Dead-letter jobs, Queue age breach, Database saturation, Authorization error anomaly, AI provider failure rate, Projection lag" (TRD §39) | No Sentry, OpenTelemetry, Prometheus, Datadog, or any vendor observability SDK in `package.json` or `apps/api/package.json`. Pino logs to stdout only. |
| **No runbook** | "Every critical alert has a short recovery procedure, owner and verification step" (TRD §39) | No `docs/RUNBOOK.md` or equivalent. The closest artifact is `docs/PHASE14_15_VERIFICATION.md` §9 Known Limitations, which is a verification doc, not an ops runbook. |
| **No migration rehearsal script** | "Run migrations on staging with production-like data volume" + "Verify counts and foreign keys after migration" (TRD §38) + "Run migration rehearsal" (PIP §16) | No `scripts/migration-rehearsal.sh` or equivalent. |
| **No rollback playbook** | "Create rollback plan" (PIP §16) + "Monitoring and rollback exist" (Engineering Support §58) | No `docs/ROLLBACK.md` or equivalent. |
| **No contract freeze** | "Freeze schema/API contracts for release" (PIP §16) | No `docs/RELEASE_CONTRACTS.md`, no schema snapshot mechanism, no API contract tag. |
| **No environment-variable audit** | "Verify environment variables" (PIP §16) | `.env.example` exists (template only) but no `scripts/audit-env.mjs` or similar that asserts the runtime env against `.env.example` + `env.ts` schema. |
| **No release-candidate script** | "Create release candidate" (PIP §16) | No `scripts/release.sh` or tag-and-changelog automation. |
| **No domain-event failure monitor** | "Monitor errors and domain-event failures" (PIP §16) | `event_log` has `status: 'failed' \| 'dead_letter'` rows. No query, dashboard, or alert that surfaces these. |
| **No SLO definition** | Implicit in TRD §39 "Queue age breach" and "Authorization error anomaly" | No SLO/SLA document. |
| **E2E suite uses fixture server only** | "Run E2E smoke suite" against a real environment (PIP §16 + PRD Appendix A) | `apps/web/playwright.config.ts` boots `fixture-server.mjs` on port 4100, not the real API. This is the correct posture for Phase 7 visual/UI verification, but is insufficient for the Phase 16 "release" gate, which requires E2E against the actual stack. |

### 2.3 Known pre-existing defects NOT in Phase 16 scope

- **`/health` and `/auth/dev-token` FST_ERR_REP_ALREADY_SENT** — pre-existing Phase 0–13 bug documented in `docs/PHASE14_15_VERIFICATION.md` §9.1. Out of scope per the user's "minimal, additive" rule and not a Phase 16 release blocker if `/health` still returns 200 with a valid body.
- **`packages/shared` dist ESM-directory-import issue** — pre-existing; the `tsx` runtime path is broken for ESM-directory imports. Out of scope for Phase 16 unless Phase 16 needs `packages/shared` to import through the dist build (it does not — both `apps/api` and `apps/web` consume `packages/shared/src/*` directly via path aliases).
- **9 pre-existing lint errors in Phase 0–13 files** — out of scope; verified pre-Phase-14 by the Phase 14 + 15 audit.

---

## 3. Phase 16 Scope — Mandatory vs. Optional

### 3.1 Mandatory (PIP §16 + TRD §39 + Engineering Support §58)

These items block Phase 16 exit. Each maps to a governing-spec line.

| # | Mandatory deliverable | Spec source | Frozen-boundary posture |
|---|---|---|---|
| **M1** | **CI pipeline** that runs the **6 host-agnostic TRD §39 stage gates** in order: lint, typecheck, unit tests, integration tests, build, migration check. Plus a **merge-blocking E2E critical loop** that runs the **existing fixture-based Playwright suite** (16 specs, the Phase 0–15 critical loop). The 2 remaining TRD §39 stages — **E2E smoke against the real stack** and **deploy staging** — are explicitly NOT part of M1's mandatory CI: the real-stack smoke is M7 (a separate, scheduled workflow, not merge-blocking); the deploy-staging stage is a host target (resolved in §11 Q1, not an M1 deliverable). TRD §39 enumerates 8 stages; M1 implements 7 of them (the 6 host-agnostic + the fixture-based E2E) and explicitly defers the 8th (deploy staging) to the host target decision. | TRD §39 (lines 1507–1525) | New: `.github/workflows/ci.yml` (or equivalent CI YAML). **No application code touched.** |
| **M2** | **Environment-variable audit** script that diffs the runtime env against `.env.example` + the `env.ts` zod schema. | PIP §16 "Verify environment variables" | New: `scripts/audit-env.mjs` (read-only). **No schema change.** |
| **M3** | **Migration rehearsal** script that applies all 18 migrations against a fresh DB, then runs `migrations.test.ts` row-count + FK assertions. | PIP §16 "Run migration rehearsal" + TRD §38 "Run migrations on staging with production-like data volume" + TRD §39 "Migration check — Forward-compatible" | New: `scripts/migration-rehearsal.sh` (read-only against the DB; only `CREATE` / `DROP` on disposable local stack). **No new migration.** |
| **M4** | **Contract freeze** document capturing the API route list, event type union, and the 18 migration SHA set as the v1.0 release contract. | PIP §16 "Freeze schema/API contracts for release" | New: `docs/RELEASE_CONTRACTS_v1.0.md` (read-only snapshot derived from the source tree). **No contract mutation.** |
| **M5** | **Rollback playbook** for the 5 highest-risk surface changes (DB migration reversal, env var revert, dependency version revert, build rollback, secret rotation). | PIP §16 "Create rollback plan" + Engineering Support §58 "Monitoring and rollback exist" | New: `docs/ROLLBACK.md` (procedure document). **No application code touched.** |
| **M6** | **Operational runbook** covering the 8 TRD §39 alert categories with recovery procedure, owner, and verification step per category. | TRD §39 (lines 1527–1541) | New: `docs/RUNBOOK.md`. **No application code touched.** |
| **M7** | **E2E smoke against a real (integrated) stack** — distinct from the deployed staging/production tiers. A second Playwright config that boots `apps/api` + Supabase local stack + `apps/web` on the same host (the **local integrated stack**) and runs the 22-scenario PRD Appendix A matrix as smoke. **M7 is a local-integration smoke, not a deployed-environment test.** Deployed staging/production is a *host target* concern addressed in §11 Q1 and is NOT the M7 acceptance surface. | PIP §16 "Run E2E smoke suite" + PRD Appendix A (22 scenarios, lines 1474–1523) | New: `apps/web/playwright.smoke.config.ts` + `apps/web/tests/e2e/smoke/*.spec.ts`. **No application code touched.** |
| **M8** | **Domain-event failure monitor** query/dashboard that surfaces `event_log` rows where `status IN ('failed', 'dead_letter')` grouped by handler_name, with a 7-day rolling count. | PIP §16 "Monitor ... domain-event failures" | New: `apps/api/src/ops/event-failures.ts` (read-only SQL helper) + `apps/api/src/routes/ops.ts` (read-only, service-role only) + test. **No mutation of `event_log` writes.** |
| **M9** | **Release checklist** (the PIP §16 verification gate: "release checklist signed and rollback path demonstrated") and a **sign-off document** proving the checklist is satisfied. | PIP §16 "Verification gate" | New: `docs/RELEASE_CHECKLIST.md` (signed at sign-off time). |
| **M10** | **Phase 16 verification doc** recording what shipped, what the verification proved, and what is documented-as-limitation. | PIP §16 DoD ("Documentation and migration notes are updated before the phase closes") | New: `docs/PHASE16_VERIFICATION.md`. **Additive only.** |

#### 3.1.1 New additive Phase 16 routes (classified)

Phase 16 introduces **exactly one new API route** — the M8 domain-event failure monitor:

| New route | File | Method | Path | Auth posture | Purpose |
|---|---|---|---|---|---|
| **`/ops/event-failures`** (M8) | `apps/api/src/routes/ops.ts` (new) | `GET` | `/ops/event-failures?since=...&until=...` | **Service-role only** (no JWT-bearer path; no per-user access; no Phase 0–15 caller has a reason to call it) | Read-only count of `event_log` rows where `status IN ('failed', 'dead_letter')`, grouped by `handler_name`, over the requested time window. |

**Classification.** `/ops/event-failures` is a **new additive Phase 16 surface**. It is:

- **Not a modification** of any Phase 0–15 route, request shape, response shape, or auth posture.
- **Not reachable by any Phase 0–15 client** because Phase 0–15 clients authenticate via JWT-bearer + `assertOwned`; the new route is service-role only (a key the API server itself holds and uses for trusted internal calls; not a user-facing credential).
- **Not in the existing `apps/api/src/routes/` files.** It is a new file (`apps/api/src/routes/ops.ts`) registered in `apps/api/src/routes/index.ts` additively; no existing route registration is changed.
- **A read-only surface** — it does not mutate `event_log` writes, does not change the event bus, does not change the dedup logic, does not change the audit logger, and does not change the security middleware.

**No other new routes are introduced by M1–M10.** M1 is a CI workflow (no API surface). M2/M3 are scripts (no API surface). M4/M5/M6/M9/M10 are documents (no API surface). M7 is a Playwright config + E2E specs (no API surface). M8 is the single new route above.

If a future authorization adds O1, O2, or O6, those are new optional surfaces and are subject to their own classification in their own plans.

### 3.2 Optional (Improvement; not in PIP §16 work package, but consistent with Phase 14 + 15 posture)

These are explicitly NOT required by PIP §16. They are listed because the Phase 14 + 15 verification called them out as documented limitations and a release may want to lift them. **None block the Phase 16 exit gate.** They require separate authorization before any of them is implemented.

| # | Optional improvement | Why it might be in scope | Why it might stay out |
|---|---|---|---|
| **O1** | **Per-route AI rate-limit ceiling** wired via `app.rateLimit({ max: env.rateLimitAiPerMin })` on `/assistant/*` routes. | Phase 14 + 15 verification §9.6 documents the AI ceiling knob as defined-but-unused. A release posture may want the tighter ceiling live before opening AI traffic. | Phase 14 + 15 chose global-only ceiling; the env knob is the right future-tense hook. Adding it is a single route block but a non-trivial change. |
| **O2** | **Sentry / OpenTelemetry integration.** | TRD §39 requires "Monitoring/alerting" as an IaC component. Pino structured logging satisfies observability for normal ops, but a vendor SDK is the standard pattern for distributed tracing. | Phase 14 + 15 verification §9.5 explicitly states "Phase 15 deliberately does not add a vendor SDK. The pino structured logger is the observability layer." Lifting this is a separate decision. |
| **O3** | **SLO definitions** (e.g., "99% of attempts submitted under 1.5s p95" / "queue age < 5 min p99" / "5xx rate < 0.1%"). | Implicit in TRD §39 "Queue age breach" + "Authorization error anomaly". SLOs are the input to an alerting policy. | TRD §39 does not enumerate specific numeric thresholds. The runbook can describe *what* would breach without committing to a numeric threshold. |
| **O4** | **`ApiEnv.nodeEnv` tier value `'staging'`** — adding a fourth enum value to the existing `'development' \| 'test' \| 'production'` set, used by the API to gate staging-only behavior. **This is a code/schema change to `apps/api/src/config/env.ts`, NOT a host decision.** | TRD §39 has a "Deploy staging" stage before "Production". The repo's `ApiEnv.nodeEnv` is `'development' \| 'test' \| 'production'` and is consumed by `installSecurity()` and `/health` to gate security-policy behavior. A fourth value would let the API distinguish a deployed staging tier from a deployed production tier at runtime. | The M1–M10 mandatory scope does NOT require O4. The M5 rollback demonstration is a **host-target** concern (deployed where, with what URL — resolved in §11 Q1) and is **independent** of whether the API has a `'staging'` `nodeEnv` value. M1 implements 7 host-agnostic stages (no deploy-staging stage inside M1's CI). M7 is a local integrated stack smoke (no deployed environment). The M5 demonstration can be performed on a deployed environment labeled `'production'` for the Phase 16 sign-off and still satisfy the "rollback path demonstrated" gate. O4 is therefore **out of Phase 16 mandatory scope** and is an explicit follow-up: adding a `'staging'` enum value would let the API distinguish the two deployed environments at runtime, but the Phase 16 sign-off does not require this distinction. |
| **O5** | **Per-route cache header audit** of the 13 routes Phase 15 cataloged. | Phase 15 added `private, max-age=300` and `no-store` to the right routes. A release posture may want a lint or unit test that asserts no authed route accidentally gets a `public` cache directive. | Phase 15's manual route-by-route decision is the source of truth. A regression guard is a follow-up. |
| **O6** | **Audit-events read endpoint for operators.** | Audit rows exist in `audit_events` but there is no API surface to read them. An ops dashboard could query recent privileged operations. | Engineering Support §58 calls this out as a "future reporting surface" in Phase 14 + 15 verification §9.4. A read endpoint is a Phase 16+ addition; PIP §16 itself does not require it. |
| **O7** | **Vercel / Render / Fly deployment config (host target).** Concrete IaC artifacts for the chosen host: Vercel project for `apps/web`, Render/Fly/EC2 service for `apps/api`, Supabase Cloud for the DB, and the connection wiring between them. | TRD §39 enumerates the IaC components. The M5 rollback demonstration (§4.3 sub-gate (a)) requires a deployed environment, which requires a host target. | The repo has no deployment artifacts at planning time. Picking a host is a product/ops decision and is explicitly a **separate** decision from O4 (the `nodeEnv` enum value) — the host is *where* the deployed environment runs; O4 is *how the API labels it at runtime*. Phase 16 sign-off does NOT require a host target to be authorized: if no host is authorized, the M5 demonstration falls back to sub-gate (b) (local simulation, `PARTIAL` verdict). |
| **O8** | **Pre-commit hook auto-install** in `npm install` postinstall. | Phase 14 added `scripts/install-hooks.sh` as opt-in. Auto-installing the secret scanner in `postinstall` would close the loop. | Phase 14 + 15 verification §9 and the existing opt-in posture are deliberate (so existing developer workflows are not disrupted). Auto-install is a developer-experience decision. |

---

## 4. Phase 16 Acceptance Criteria

### 4.1 Per-deliverable AC (mandatory items)

| # | Deliverable | Acceptance test |
|---|---|---|
| M1 | CI pipeline | Pushing to `main` (or running the CI command locally) executes the 7 M1-in-scope stages in order — lint, typecheck, unit tests, integration tests, build, migration check, fixture-based E2E — and failure of any stage blocks the pipeline. The M7 real-stack E2E smoke is a separate scheduled workflow (not merge-blocking) and is not part of the M1 acceptance run. Documented in `docs/PHASE16_VERIFICATION.md` with the actual run log. |
| M2 | Env-var audit | `node scripts/audit-env.mjs` exits 0 against a `.env` that matches `.env.example` + `env.ts` schema; exits 1 with a specific missing-var list against a stripped `.env`. |
| M3 | Migration rehearsal | `bash scripts/migration-rehearsal.sh` against a fresh local Supabase stack: applies all 18 migrations, runs row-count + FK assertions, prints "OK" or a specific failure. The same script in CI (M1) is the migration-check stage. |
| M4 | Contract freeze | `docs/RELEASE_CONTRACTS_v1.0.md` contains: (a) the 18 migration filenames + SHAs at freeze time, (b) the `EventType` union members as of freeze time, (c) the API route list (method + path + authed flag) as of freeze time. A diff against a subsequent commit reveals a contract change. |
| M5 | Rollback playbook | `docs/ROLLBACK.md` contains a procedure for each of: (a) migration reversal, (b) env var revert, (c) dependency version revert, (d) build rollback to a prior image, (e) secret rotation. Each procedure has owner + verification step. |
| M6 | Runbook | `docs/RUNBOOK.md` contains a section for each of the 8 TRD §39 alert categories (submission failure spike, evidence capture failure spike, dead-letter jobs, queue age breach, database saturation, authorization error anomaly, AI provider failure rate, projection lag) with: alert definition, recovery procedure, owner, verification step. |
| M7 | E2E smoke against the **local integrated stack** | `apps/web/playwright.smoke.config.ts` boots `apps/api` + Supabase local + `apps/web` on the same host (the local integrated stack); the 22 PRD Appendix A scenarios are mapped to existing E2E specs (or new specs in `apps/web/tests/e2e/smoke/`); the smoke run exits 0 with the 22-scenario matrix satisfied. Deployed staging/production smoke is a host-target concern (resolved in §11 Q1) and is NOT the M7 acceptance surface. |
| M8 | Domain-event failure monitor | `GET /ops/event-failures?since=...&until=...` (service-role only) returns the count of `event_log` rows in `('failed', 'dead_letter')` grouped by `handler_name`. A unit test asserts the query shape, the RLS posture, and the response envelope. |
| M9 | Release checklist | `docs/RELEASE_CHECKLIST.md` is a checkable list of all 22 PRD Appendix A scenarios + the 7 M1-in-scope CI stages + the 5 rollback scenarios in M5 + the 8 runbook categories in M6. Each item is signed with date + signatory. |
| M10 | Phase 16 verification doc | `docs/PHASE16_VERIFICATION.md` records: what shipped, what the verification proved, the actual CI run log, the actual env-var audit run, the actual migration rehearsal run, the actual E2E smoke run, the audit cross-walk, the frozen-boundary confirmation, the known limitations, and the final verdict. |

### 4.2 Cross-cutting AC

- **Frozen boundary** (Phase 0–15 contracts): `assertOwned` count remains 83. `EventType` union is unmodified. Notification dedup + per-kind preferences logic is unmodified. RLS policies are unmodified. Service signatures are unmodified. Route request/response shapes are unmodified. **Phase 16 introduces exactly one new route — `GET /ops/event-failures` (M8, classified in §3.1.1) — which is a new additive file, service-role only, read-only, and unreachable by Phase 0–15 clients.** M7 may add new Playwright specs; those are additive. No other Phase 0–15 surface is modified.
- **No new vendor dependency** unless explicitly authorized. The Phase 14 + 15 verification doc §9.5 posture (no Sentry / OpenTelemetry in Phase 14/15) carries forward. **Vendor SDK additions (O2) are NOT in Phase 16 mandatory scope.**
- **DoD**: code is type-safe and lint-clean; automated tests cover the new behavior and important failure paths; no fake data / UI-only state; observable through source records / events / evidence; documentation and migration notes updated.
- **No last-minute feature additions during release validation** (PIP §16 guardrail). Phase 16 implementation is locked at the start; only defect fixes (with regression tests) are allowed during sign-off.

### 4.3 Exit gate (PIP §16)

> "Release checklist signed and rollback path demonstrated."

The exit gate has two sub-gates:

**(a) Demonstration sub-gate (primary, governing spec).** The PIP §16 verification gate requires the rollback path to be **demonstrated**. "Demonstrated" means: at least one of the 5 rollback procedures in `docs/ROLLBACK.md` is walked through end-to-end on the **deployed staging environment** (or, if no deployed staging tier exists yet, on a **deployed production-equivalent environment**). A local simulation does NOT satisfy this sub-gate. The demonstration must be recorded in `docs/PHASE16_VERIFICATION.md` with timestamps, the deployed environment identifier (host, region, environment name), and the actual `/health` response bodies before/after each step.

**(b) Local-simulation sub-gate (fallback limitation, documentable as deviation).** If the deployed-environment demonstration cannot be performed because no deployed staging/production-equivalent environment has been provisioned at sign-off time, a **local rollback simulation** on the local integrated stack may be performed **in addition to** the procedure being fully documented, but the local simulation is **a fallback limitation, not an equivalent of the demonstrated-rollback gate**. In this case:
- `docs/PHASE16_VERIFICATION.md` §X must record the absence of a deployed environment, the local-simulation transcript (timestamps + `/health` bodies), and the explicit deviation from the governing "demonstrated" requirement.
- The Phase 16 verdict is `PARTIAL` (not `PASS`) until a deployed-environment demonstration is performed in a subsequent post-release step.
- The M9 release checklist must include a follow-up item: "Re-demonstrate rollback on the deployed staging environment once provisioned."

The Phase 16 exit gate is **not** considered satisfied under (b) without the explicit PARTIAL verdict and the re-demonstration follow-up. Sub-gate (a) is the governing posture; sub-gate (b) is a documented fallback only.

---

## 5. Tests

### 5.1 Unit / integration tests (apps/api, vitest)

| Test file | Asserts |
|---|---|
| `apps/api/src/ops/__tests__/event-failures.test.ts` (new) | The `eventLogFailureCounts(client, since, until)` helper returns the expected grouped shape; the `/ops/event-failures` route requires service-role auth; the response envelope matches the krodex shape. |
| `apps/api/src/ops/__tests__/ops-routes.test.ts` (new) | The new `/ops/*` route is mounted; non-service-role callers receive 401/403; service-role callers receive the expected body. |

### 5.2 E2E (apps/web, Playwright)

| Test file | Asserts |
|---|---|
| `apps/web/tests/e2e/smoke/*.spec.ts` (new) | The 22 PRD Appendix A scenarios mapped to Playwright steps. The smoke config runs against the **local integrated stack** (`apps/api` + Supabase local + `apps/web` on the same host) booted by `playwright.smoke.config.ts` — NOT against any deployed staging or production tier. Deployed environments are a host-target concern resolved in §11 Q1 and are not the M7 acceptance surface. |
| `apps/web/tests/e2e/smoke/health.spec.ts` (new) | `GET /health` returns 200 with the Phase 14 security policy block; `db.up === true`; `event_bus.running === true`; `security.installed === true` in non-test mode. Verified against the local integrated stack. |

### 5.3 Migration / infrastructure tests

| Test file | Asserts |
|---|---|
| `apps/api/src/db/__tests__/migrations.test.ts` (existing) | Still asserts 18 migration files. **M3 (rehearsal script) reuses this assertion as a sub-step.** No change to the existing test. |
| `scripts/audit-env.mjs` (new, M2) | Exit 0 against a complete `.env`; exit 1 with a JSON list of missing keys against a stripped `.env`. |
| `scripts/migration-rehearsal.sh` (new, M3) | Applies all 18 migrations cleanly; runs row-count + FK assertions; prints "OK". |
| `.github/workflows/ci.yml` (new, M1) | The CI workflow runs the 7 M1-in-scope stages (lint, typecheck, unit tests, integration tests, build, migration check, fixture-based E2E); a failure in any stage blocks merge. |

### 5.4 Total new test budget (rough)

- 2 new apps/api test files (~150 lines total).
- 2 new apps/web E2E specs (~300 lines total).
- 2 new scripts (M2 + M3) with self-test or manual test.
- 1 new CI workflow YAML with a self-lint step.

This is consistent with the Phase 14 + 15 delta (+26 tests) and the Phase 8 delta; no test-suite bloat.

---

## 6. Migration / Release Requirements

### 6.1 Database migrations

**None.** Phase 16 introduces zero new migrations. The release contract is the **frozen snapshot** of the 18 existing migrations (M4). The migration rehearsal script (M3) re-applies them against a fresh DB but does not add a 19th.

### 6.2 Configuration

**Additive env vars only** (if any are needed):
- `KRODEX_RELEASE_TAG` (string, optional) — read by `apps/api/src/server.ts:104` (`KRODEX_VERSION`) to expose the release tag in `/health`. The value defaults to `'dev'` if unset. **No env-var name collision with Phase 0–15.**
- `KRODEX_STAGING_BASE_URL` (string, optional) — used by the smoke E2E config to know where to point. **No collision.**

**Zero env-var name changes** to the 35+ existing `ApiEnv` fields.

### 6.3 Dependency changes

**None required for M1–M10.** The CI workflow uses GitHub Actions YAML (declarative, no npm dependency). The migration rehearsal script uses the Supabase CLI (already documented in `.env.example` comments). The ops routes use the existing Supabase client.

If O2 (Sentry / OpenTelemetry) is later authorized, that is a separate dependency decision and out of Phase 16 mandatory scope.

### 6.4 Release artifacts

| Artifact | Source | Consumed by |
|---|---|---|
| `apps/api/dist` | `npm run build:api` | M1 CI build stage; M9 release checklist item. |
| `apps/web/.next` | `npm run build:web` | M1 CI build stage; M9 release checklist item. |
| `docs/perf-baseline.json` | `phase15-perf-baseline.test.ts` (existing) | M9 release checklist item. |
| `docs/RELEASE_CONTRACTS_v1.0.md` | M4 (new) | M9 release checklist item. |
| `docs/ROLLBACK.md` | M5 (new) | M9 release checklist item. |
| `docs/RUNBOOK.md` | M6 (new) | M9 release checklist item. |
| `docs/RELEASE_CHECKLIST.md` | M9 (new) | The release sign-off itself. |
| `docs/PHASE16_VERIFICATION.md` | M10 (new) | Post-release record. |

---

## 7. Rollback Strategy

The Phase 16 exit gate requires "rollback path demonstrated." The strategy is multi-layered because Phase 16 itself is mostly documentation + CI; the risk surface is small but explicit.

### 7.1 Per-artifact rollback

| Artifact | Rollback action | Reversibility | Owner |
|---|---|---|---|
| `.github/workflows/ci.yml` | Delete the file; CI returns to the pre-Phase-16 state of "no CI". | Immediate, no data loss. | Release engineer. |
| `scripts/audit-env.mjs` | Delete the file. | Immediate. | Release engineer. |
| `scripts/migration-rehearsal.sh` | Delete the file. The 18 migrations themselves are untouched. | Immediate. | Release engineer. |
| `docs/RELEASE_CONTRACTS_v1.0.md` | Edit the file to re-freeze at a prior contract SHA. | Immediate; the file is a snapshot, not a constraint. | Release engineer. |
| `docs/ROLLBACK.md` / `RUNBOOK.md` | Edit the file. | Immediate. | Release engineer. |
| `docs/RELEASE_CHECKLIST.md` | Edit the file. | Immediate. | Release engineer. |
| `apps/web/playwright.smoke.config.ts` + `apps/web/tests/e2e/smoke/*.spec.ts` | Delete the files. The 16 existing E2E specs and the fixture config are untouched. | Immediate. | Release engineer. |
| `apps/api/src/ops/event-failures.ts` + `apps/api/src/routes/ops.ts` | Revert the commits. **The `/ops/*` route is a NEW route;** it can be removed without breaking any Phase 0–15 client because no Phase 0–15 client calls it. | Immediate. | Release engineer. |
| `docs/PHASE16_VERIFICATION.md` | Edit the file. | Immediate. | Release engineer. |

### 7.2 The 5 high-risk rollback procedures (M5 deliverable)

`docs/ROLLBACK.md` must describe each of these in enough detail to execute under incident pressure:

1. **DB migration reversal** — for the *next* migration that ships *after* Phase 16. Phase 16 ships no migration, so the procedure is forward-looking. For now, the procedure is "the 18 existing migrations are the v1.0 baseline; reversal means restoring a pre-migration DB snapshot + replaying the application queue."
2. **Env var revert** — if a Phase 16 env var (`KRODEX_RELEASE_TAG`, `KRODEX_STAGING_BASE_URL`) causes a misconfig, revert via the deployment platform's env-var editor; the API falls back to `'dev'` / `undefined` defaults.
3. **Dependency version revert** — not needed in Phase 16 (no dependency changes). Procedure documented for future phases.
4. **Build rollback** — redeploy the prior `apps/api/dist` + `apps/web/.next` artifact via the deployment platform. The M9 release checklist captures the artifact SHA per release.
5. **Secret rotation** — Supabase service-role key, JWT secret, AI provider key, email/push provider keys. Procedure: rotate in the deployment platform → restart the API → confirm `/health` reports `db.up === true` and `event_bus.running === true`.

### 7.3 Rollback demonstration requirement

The Phase 16 exit gate requires that **at least one** of the 5 procedures is *demonstrated* end-to-end (not merely documented) before sign-off. The recommended demonstration is the build rollback (#4) because it is the lowest-risk and most observable: deploy a known-good artifact, confirm `/health`, then deploy a known-bad artifact, observe the regression, then deploy the known-good artifact again, confirm recovery. The demonstration is recorded in `docs/PHASE16_VERIFICATION.md` §X with timestamps, the deployed environment identifier, and the actual `/health` response bodies.

**Demonstration environment (governing).** The demonstration must be performed on the **deployed staging environment** (or a deployed production-equivalent environment). A demonstration on the **local integrated stack** is a **local-simulation fallback**, NOT a substitute for the governing demonstration. If the local-simulation fallback is used, the verification verdict becomes `PARTIAL` (per §4.3 sub-gate (b)) and a follow-up re-demonstration on the deployed environment is recorded as a post-release item in `docs/RELEASE_CHECKLIST.md`.

The build-rollback demonstration requires a deployed environment with a prior `apps/api/dist` + `apps/web/.next` artifact retained (per M9 release checklist item). If the local-simulation fallback is used, the recorded output is the local `/health` body and the verification doc explicitly flags the deviation.

---

## 8. Frozen Phase 0–15 Boundary

This section enumerates what Phase 16 must NOT change. Any change is a contract violation and requires explicit authorization outside the Phase 16 plan.

### 8.1 What Phase 16 MUST NOT modify

| Area | Frozen contract | Evidence of current state |
|---|---|---|
| `EventType` union | Members are frozen. No addition, no removal, no rename. | `packages/shared/src/events/envelope.ts` |
| Service signatures | Every `apps/api/src/services/*.ts` exported function keeps its name, parameter list, and return shape. **Exception:** new files in `apps/api/src/ops/` are additive; existing services are not modified. | service file count and `index.ts` re-exports. |
| Route contracts | Every existing route in `apps/api/src/routes/*.ts` keeps its method, path, request shape, response shape, and auth posture. **Exception:** `apps/api/src/routes/ops.ts` is a NEW file (Phase 16, classified in §3.1.1) and adds exactly one new route — `GET /ops/event-failures`. The existing route files are not modified. | route file count; pre-commit hook can grep for `app.get\|app.post\|app.patch\|app.delete` in pre-Phase-16 files and verify the same line count. The new `ops.ts` file is the only allowed new registration. |
| `assertOwned` behavior | Same call-site count, same arguments, same error path. | 83 call sites in `apps/api/src/routes/*.ts`; preserved by Phase 14 + 15. |
| RLS policies | No `alter table ... enable row level security` or `create policy` against any pre-Phase-16 table. | `supabase/migrations/*.sql` Phase 0–15 set. |
| Notification dedup logic | Same dedup key, same per-kind preference gates, same quiet-hours rule. | `apps/api/src/services/notification-*.ts`. |
| Event bus handlers | Same registered handlers, same handler outcomes, same retry policy. | `apps/api/src/events/registry.ts` + `worker.ts`. |
| Migrations | 18 files, no 19th, no alteration of the first 18. | `supabase/migrations/` directory listing. |
| Env var schema | The 35+ fields in `ApiEnv` keep their names, types, and defaults. **Exception:** the 2 new optional env vars (`KRODEX_RELEASE_TAG`, `KRODEX_STAGING_BASE_URL`) are additive. | `apps/api/src/config/env.ts`. |
| Lint posture | 9 pre-existing lint errors stay at 9. No new lint errors in Phase 0–15 files. | `npm run lint` baseline. |

### 8.2 What Phase 16 MAY do (additive only)

- Add new files in `apps/api/src/ops/` (event-failures helper + ops route).
- Add new files in `apps/web/tests/e2e/smoke/`.
- Add new files in `scripts/`.
- Add new files in `docs/` (RELEASE_CONTRACTS, ROLLBACK, RUNBOOK, RELEASE_CHECKLIST, PHASE16_VERIFICATION).
- Add new files in `.github/workflows/`.
- Add a new env-var field to `ApiEnv` (optional, only if needed; none required by M1–M10).
- Add a new `AuditAction` enum value (only if a new privileged operation is added; none required by M1–M10).

### 8.3 Frozen-boundary verification

The Phase 16 verification doc (M10) must include the same frozen-boundary table that Phase 14 + 15 used:

- `assertOwned` count before/after (must be 83 → 83).
- `EventType` union member count (must be unchanged).
- Migration file count (must be 18 → 18).
- Lint error count (must be 9 → 9 in Phase 0–15 files).
- Test count delta (Phase 0–15 baseline + new Phase 16 tests = total).

---

## 9. Dependencies

### 9.1 External (npm)

**Zero new npm dependencies required for M1–M10.**

The CI workflow uses GitHub Actions (declarative YAML, no npm install). The migration rehearsal uses the Supabase CLI (already documented). The ops routes use the existing Supabase client and Fastify.

If a future authorization adds O2 (Sentry / OpenTelemetry) or O7 (Vercel / Render / Fly), those are explicit dependency additions and require their own scope decision.

### 9.2 Internal (file-level)

| New file | Depends on |
|---|---|
| `.github/workflows/ci.yml` | Existing `package.json` scripts; existing `apps/web/playwright.config.ts`; existing Supabase CLI. |
| `scripts/audit-env.mjs` | `apps/api/src/config/env.ts`; `.env.example`. |
| `scripts/migration-rehearsal.sh` | Supabase CLI; `apps/api/src/db/__tests__/migrations.test.ts` row-count assertions. |
| `docs/RELEASE_CONTRACTS_v1.0.md` | Frozen snapshot of `supabase/migrations/`, `packages/shared/src/events/envelope.ts`, `apps/api/src/routes/index.ts`. Generated; not hand-written. |
| `docs/ROLLBACK.md` | Knowledge of the deployment platform (filled in at implementation time; the structure is the deliverable). |
| `docs/RUNBOOK.md` | Knowledge of the alert destinations (filled in at implementation time; the structure is the deliverable). |
| `docs/RELEASE_CHECKLIST.md` | Generated from the 22 PRD scenarios + 7 M1-in-scope CI stages + 5 rollback procedures + 8 runbook categories. |
| `apps/api/src/ops/event-failures.ts` | Existing `SupabaseClient`; existing event_log schema. |
| `apps/api/src/routes/ops.ts` | Existing `auth/prehandler.ts`; existing `assertOwned`-style pattern (re-asserted for service-role only). |
| `apps/web/playwright.smoke.config.ts` | Existing Playwright dev-dependency; existing `apps/web/tests/e2e/fixture-server.mjs` is NOT used by the smoke config. |
| `apps/web/tests/e2e/smoke/*.spec.ts` | Existing `apps/web/tests/e2e/helpers.ts`; existing routes. |
| `docs/PHASE16_VERIFICATION.md` | All of the above. |

### 9.3 Phase 0–15 dependencies that Phase 16 consumes

- The Phase 14 `installSecurity()` block. The smoke run depends on it being installed by default in non-test mode.
- The Phase 14 `audit_events` table. The M8 monitor could optionally surface audit_events for cross-reference, but the mandatory surface is `event_log` (failures + dead-letter).
- The Phase 15 perf baseline. M9 release checklist item references `docs/perf-baseline.json` as a release artifact.
- The Phase 12 notification dedup + per-kind preferences. The M7 E2E smoke covers the "Open notification" + "Source record opens" PRD Appendix A scenarios and depends on this behavior being intact.

---

## 10. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CI host has different toolchain than local dev (Node version, Supabase CLI version). | Medium | High — blocks M1 + M3. | Pin Node version in CI YAML (`.nvmrc` or `actions/setup-node@v4` with `node-version-file`). Pin Supabase CLI version. The M1 deliverable includes a "first run on a fresh host" verification step. |
| The E2E smoke (M7) against the local integrated stack is slower than the fixture-based E2E, and CI timeouts. | Medium | Medium — long CI runs. | Run the smoke E2E as a *separate* workflow (not in the merge-blocking CI), triggered on a schedule and on release tags. The merge-blocking CI keeps the existing 16-spec fixture-based E2E. The M7 smoke is a local-integration smoke, not a deployed-environment test. |
| The 22 PRD scenarios are not all covered by existing E2E specs; new specs need writing. | High | Medium — adds ~300 lines of test code. | M7 deliverable explicitly includes new smoke specs. The smoke spec count is decoupled from the existing 16-spec suite. |
| The ops `/ops/*` route is a new surface that could become an attack surface. | Low | High — security. | Service-role only. `assertOwned`-style ownership check on every method. Same audit-log wiring as Phase 14. The 4 mandatory unit tests cover: service-role 200, non-service-role 401, missing-arg 400, DB error 500 with envelope. |
| The rollback demonstration (M5 + exit gate) requires a deployed staging environment that does not exist yet. | High | Medium — blocks sign-off under sub-gate (a). | Document the staging environment requirements in `docs/ROLLBACK.md` and `docs/RUNBOOK.md`. If no deployed environment is available at sign-off, the local-simulation fallback (sub-gate (b) in §4.3) is used: the verification verdict is `PARTIAL`, the deviation is recorded, and a follow-up re-demonstration on the deployed environment is added to `docs/RELEASE_CHECKLIST.md`. |
| The contract freeze (M4) becomes stale as soon as the next commit lands. | High | Low — M4 is a snapshot, not a contract enforcer. | The freeze is dated; the freeze SHA is referenced from `RELEASE_CHECKLIST.md`; the next phase re-freezes at v1.1. |
| The env-var audit (M2) is brittle to whitespace / case differences. | Medium | Low. | Reuse the existing `trim()` + `flag()` helpers in `apps/api/src/config/env.ts`; the script imports the same schema. |
| A Phase 16 author adds a vendor observability SDK (Sentry) by mistake. | Low | High — vendor lock-in, dependency weight. | O2 is explicitly out of mandatory scope. The frozen-boundary check (M10) includes a `package.json` diff that flags any new dependency. |

---

## 11. Open Questions for the Authorizer

Before implementation begins, the following decisions are required. **Phase 16 will not start implementation until these are answered.**

1. **Host target (where the deployed environment runs)** — Vercel (Next.js) + a separate Fastify host (Render / Fly / Railway / EC2)? Supabase Cloud for the DB? The M1 + M3 IaC artifacts are host-agnostic. The M5 rollback demonstration (§4.3 sub-gate (a)) requires a deployed environment, which requires a host target. If no host is authorized, the M5 demonstration falls back to sub-gate (b) (local simulation, `PARTIAL` verdict, follow-up re-demonstration item recorded). **The authorizer may defer this to a post-Phase-16 decision; if deferred, the M5 sign-off is `PARTIAL`.**
2. **`ApiEnv.nodeEnv` tier value (how the API labels the deployed environment at runtime)** — Should O4 be authorized alongside M1–M10, or stay out of Phase 16? This is a code/schema decision independent of the host-target decision in Q1. The Phase 16 mandatory scope (M1–M10) does NOT require O4. The M5 demonstration can be performed on a deployed environment labeled `'production'` for the Phase 16 sign-off and still satisfy the "rollback path demonstrated" gate (the gate is about *demonstrated rollback*, not about *which env label* the API carries). O4 is an explicit follow-up. **Default if unanswered: O4 is NOT authorized; the API continues to use `'development' \| 'test' \| 'production'`.**
3. **SLO commitments** — Does the release commit to numeric SLOs (e.g., "5xx rate < 0.1%", "p95 attempt submit < 1.5s")? If yes, O3 becomes mandatory and the M6 runbook must include alert thresholds. If no, O3 stays optional and M6 documents the alert *categories* without numeric thresholds.
4. **Ops route policy** — The M8 `/ops/event-failures` route is service-role only. Does the authorizer want it behind a separate JWT claim (e.g., a `role: 'operator'` claim) for human-operator access? If yes, M8 grows a small auth layer; if no, service-role is the only access path (and the route is only callable by a trusted caller holding the service-role key).
5. **Optional items** — Of O1–O8, which (if any) are authorized alongside the mandatory M1–M10? Each is a separate scope decision and a separate work package.

---

## 12. Execution Sequence (proposed)

The proposed order is sequenced so that each step's output is the next step's input. The sequence is **reversible at any step** (per the rollback strategy §7); stopping at any step leaves the repo in a known-good state.

### Step 1 — Authorization + scope freeze
- The authorizer answers §11 Q1–Q5.
- The authorizer confirms M1–M10 are the in-scope mandatory set, and either confirms or trims O1–O8.
- This `docs/PHASE16_PLAN.md` is amended to record the scope decision (or kept as-is if the authorizer accepts the plan verbatim).
- **STOP. Do not begin Step 2 until §11 is resolved.**

**Authorization record (2026-09-04, captured at Step 1 sign-off):**
- **Q1 (host target)**: Deferred. No deployed environment authorized at sign-off. M5 will use §4.3 sub-gate (b) local-simulation fallback; Phase 16 verdict will be `PARTIAL`.
- **Q2 (O4 — `ApiEnv.nodeEnv` `'staging'` tier value)**: NOT authorized. API continues to use `'development' | 'test' | 'production'`.
- **Q3 (O3 — numeric SLOs)**: NOT authorized. M6 runbook documents alert *categories* without numeric thresholds.
- **Q4 (ops route policy)**: Service-role only (per the plan). No new JWT claim, no operator role.
- **Q5 (other optional items O1, O2, O5, O6, O8)**: NOT authorized. Per-route AI rate-limit (O1), Sentry/OpenTelemetry (O2), cache-header audit (O5), audit-events read endpoint (O6), pre-commit auto-install (O8) all stay out of Phase 16.
- **Effective Phase 16 scope**: M1–M10 only. O1–O8 unauthorized.
- **Effective exit-gate posture**: §4.3 sub-gate (b) (local-simulation fallback, `PARTIAL` verdict, follow-up re-demonstration on a deployed environment recorded as a post-release item).

### Step 2 — Contract freeze (M4)
- Generate `docs/RELEASE_CONTRACTS_v1.0.md` from the current state.
- Capture: 18 migration filenames + SHAs, `EventType` union members, route list with auth flags, env-var schema.
- Commit. No application code touched.

### Step 3 — Env-var audit (M2)
- Implement `scripts/audit-env.mjs`.
- Self-test against a complete `.env` and a stripped `.env`.
- Add an `audit:env` script to root `package.json` (additive).
- Commit.

### Step 4 — Migration rehearsal (M3)
- Implement `scripts/migration-rehearsal.sh`.
- Run it against a fresh local Supabase stack. Capture the output for `PHASE16_VERIFICATION.md`.
- Commit.

### Step 5 — Ops route + monitor (M8)
- Implement `apps/api/src/ops/event-failures.ts` (read-only SQL helper).
- Implement `apps/api/src/routes/ops.ts` (service-role-only `/ops/event-failures`).
- Register the route in `apps/api/src/routes/index.ts` (additive registration; existing routes untouched).
- Add `apps/api/src/ops/__tests__/event-failures.test.ts` and `apps/api/src/ops/__tests__/ops-routes.test.ts` (4 mandatory tests).
- Run typecheck + the new tests.
- Commit.

### Step 6 — Runbook (M6) + Rollback playbook (M5)
- Write `docs/RUNBOOK.md` (8 TRD §39 alert categories × 4 fields each).
- Write `docs/ROLLBACK.md` (5 high-risk procedures × 4 fields each).
- These are documentation-only deliverables; no code touched.
- Commit.

### Step 7 — CI pipeline (M1)
- Implement `.github/workflows/ci.yml` running the **7 M1-in-scope stages** (lint, typecheck, unit tests, integration tests, build, migration check, fixture-based E2E).
- Wire `scripts/audit-env.mjs` (M2) into the lint-or-checks stage.
- Wire `scripts/migration-rehearsal.sh` (M3) into the migration-check stage.
- The E2E stage runs the **existing** fixture-based E2E suite (M7 is a separate, scheduled workflow, not part of M1; see Step 8).
- The TRD §39 "deploy staging" stage is **NOT part of M1** — it is a host-target concern (§11 Q1) and is a future workflow if/when a host is authorized.
- Trigger a CI run on a test branch; capture the run log for `PHASE16_VERIFICATION.md`.
- Commit.

### Step 8 — E2E smoke against the local integrated stack (M7)
- Implement `apps/web/playwright.smoke.config.ts` (separate config; boots `apps/api` + Supabase local + `apps/web` on the **same host** — the local integrated stack).
- Implement `apps/web/tests/e2e/smoke/*.spec.ts` covering the 22 PRD Appendix A scenarios.
- Run locally; iterate until all 22 pass.
- Commit.
- Note: M7 is a **local integration** smoke. Deployed-environment smoke (against a deployed staging or production tier) is a host-target concern (§11 Q1) and is NOT part of the M7 acceptance surface.

### Step 9 — Release checklist (M9) + sign-off
- Generate `docs/RELEASE_CHECKLIST.md` from the 22 scenarios + 7 M1-in-scope CI stages + 5 rollback procedures + 8 runbook categories.
- Walk through every item; sign each.
- **Demonstrate the rollback** (per §7.3): deploy a known-good artifact to the **deployed environment** identified in §11 Q1, confirm `/health`, deploy a known-bad artifact, observe the regression, redeploy the known-good, confirm recovery. Record the demonstration in `PHASE16_VERIFICATION.md` §X with timestamps, the deployed environment identifier, and `/health` bodies.
- **If no deployed environment is available at sign-off (§4.3 sub-gate (b)):** perform a local rollback simulation on the local integrated stack IN ADDITION TO fully documenting the procedure, record the local-simulation transcript + the explicit deviation, set the verification verdict to `PARTIAL`, and add a follow-up re-demonstration item to `RELEASE_CHECKLIST.md`. The Phase 16 exit gate is then satisfied under sub-gate (b) only, not sub-gate (a).

### Step 10 — Phase 16 verification doc (M10)
- Write `docs/PHASE16_VERIFICATION.md` covering:
  - What shipped (M1–M10 + any authorized O's).
  - The actual CI run log (Step 7).
  - The actual env-var audit run (Step 3).
  - The actual migration rehearsal run (Step 4).
  - The actual E2E smoke run (Step 8).
  - The actual rollback demonstration (Step 9).
  - The frozen-boundary confirmation (§8.3).
  - The known limitations (any unresolved §11 questions, any deferred optional items).
  - The final verdict (PASS / PARTIAL / FAIL).
- Commit.

### Step 11 — Sign-off commit
- A single final commit with the signed `docs/RELEASE_CHECKLIST.md` + `docs/PHASE16_VERIFICATION.md`.
- Tag the commit as `v1.0` (host-agnostic; the actual deployment tag is the host's concern in Step 12).

### Step 12 — Optional: actual deployment
- If a host has been authorized (§11 Q1), deploy v1.0.
- The deployment itself is a host-platform action, not a Phase 16 deliverable. Phase 16 produces the artifacts; the deployment consumes them.

---

## 13. Summary

Phase 16, as defined by PIP v2.0 §16 and governed by TRD §39 + Engineering Support §57/§58 + PRD Appendix A, is **a release-readiness deliverable, not a feature deliverable**. The mandatory scope (M1–M10) is: CI pipeline (7 host-agnostic stages + fixture-based E2E), env-var audit, migration rehearsal, contract freeze, rollback playbook, runbook, local-integration E2E smoke, domain-event failure monitor (one new additive service-role-only route), release checklist, and a verification doc. The Phase 16 exit gate has two sub-gates: a governing "demonstrated rollback on a deployed environment" sub-gate (a) and a fallback "local-simulation, `PARTIAL` verdict" sub-gate (b). There are zero new migrations, zero new npm dependencies, and zero modifications to any Phase 0–15 contract. Optional improvements (O1–O8) are listed but require separate authorization.

**Phase 16 has not been started.** This plan proposes the scope; **implementation does not begin until §11 is resolved and the authorizer explicitly approves the M1–M10 set (plus any authorized O's).**

STOP. Awaiting approval.
