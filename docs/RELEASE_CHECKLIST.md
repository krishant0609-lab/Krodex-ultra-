# KRODEX — Phase 16 Release Checklist (v1.0)

> **Status (2026-09-04):** UNSIGNED. Sign-off is the Phase 16 M10 verification
> doc's responsibility; this checklist is the **input** to the sign-off.
> **Verdict: PARTIAL** per `docs/PHASE16_PLAN.md` §4.3 sub-gate (b).
> The rollback path is documented and locally simulated; the deployed
> staging/production-equivalent environment is NOT provisioned at sign-off
> time, so the demonstration sub-gate (a) cannot be satisfied. The re-demonstration
> follow-up is item R9-9 below.

This checklist is the **PIP §16 verification gate** artifact: "release
checklist signed and rollback path demonstrated." It enumerates every
acceptance surface for the v1.0 release across the four required dimensions
(PRD scenarios, CI gates, rollback procedures, runbook categories) and the
artifacts that back each item. Each item is checked off at sign-off time with
a date and the signatory's initials.

---

## 0. Sign-off block

| Field | Value |
|---|---|
| Release tag | `v1.0` (planned; tag created at M10 + M11) |
| Sign-off date | _pending_ |
| Signatory | _pending_ |
| Verdict | **PARTIAL** (deferred deployed-environment rollback demonstration) |
| Frozen-boundary confirmation | see `docs/RELEASE_CONTRACTS_v1.0.md` |
| Verification doc | `docs/PHASE16_VERIFICATION.md` |

---

## 1. 22 PRD Appendix A scenarios (M7)

The 22-scenario E2E matrix is the minimum release checklist for the complete
product per `docs/PHASE16_PLAN.md` §4.1. Each scenario has a stable
identifier (`S-NN`) and a 1-to-1 mapping to a Playwright test in
`apps/web/tests/e2e/smoke/smoke.spec.ts`. The matrix is the **primary
deliverable**; the run-mode (local integrated stack vs deployed) is
documented per item.

| ID | Scenario | Source surface | Test path | Mode | Status |
|---|---|---|---|---|---|
| S-01 | User signs in | (auth)/login | smoke.spec.ts:97 | local stack (skip when not provisioned) | covered |
| S-02 | User lands on dashboard | (app)/dashboard | smoke.spec.ts:108 | local stack | covered |
| S-03 | User opens a subject syllabus | (app)/syllabus/[id] | smoke.spec.ts:112 | local stack | covered |
| S-04 | User opens a topic syllabus | (app)/syllabus/topic/[id] | smoke.spec.ts:116 | local stack | covered |
| S-05 | User opens a sub-topic syllabus | (app)/syllabus/sub-topic/ | smoke.spec.ts:120 | local stack | covered |
| S-06 | User starts a test attempt | (app)/tests/[id] | smoke.spec.ts:124 | local stack | covered |
| S-07 | User submits an attempt | (app)/attempts/[id] | smoke.spec.ts:128 | local stack | covered |
| S-08 | User logs an error to the error bank | (app)/errors | smoke.spec.ts:132 | local stack | covered |
| S-09 | User reopens a resolved error | (app)/errors/[id] | smoke.spec.ts:136 | local stack | covered |
| S-10 | User opens a review session | (app)/reviews/[id] | smoke.spec.ts:140 | local stack | covered |
| S-11 | User completes a review | (app)/reviews | smoke.spec.ts:144 | local stack | covered |
| S-12 | User views the planner | (app)/planner | smoke.spec.ts:148 | local stack | covered |
| S-13 | Planner auto-reschedules a missed task | (app)/planner | smoke.spec.ts:152 | local stack | covered |
| S-14 | User views the student model | (app)/student-model | smoke.spec.ts:156 | local stack | covered |
| S-15 | User views the progress dashboard | (app)/dashboard | smoke.spec.ts:160 | local stack | covered |
| S-16 | User opens AI assistant | (app)/assistant | smoke.spec.ts:164 | local stack | covered |
| S-17 | User accepts an AI proposal | (app)/assistant | smoke.spec.ts:168 | local stack | covered |
| S-18 | User views notifications | (app)/notifications | smoke.spec.ts:172 | local stack | covered |
| S-19 | User updates notification preferences | (app)/notifications/prefs | smoke.spec.ts:176 | local stack | covered |
| S-20 | User views insights | (app)/insights | smoke.spec.ts:180 | local stack | covered |
| S-21 | User updates settings | (app)/settings | smoke.spec.ts:184 | local stack | covered |
| S-22 | Cross-user ownership isolation rejects foreign id | (cross-cutting) | smoke.spec.ts:188 | local stack | covered |

### Sign-off: PRD scenarios

- [x] All 22 scenarios have a discoverable, named Playwright test.
- [x] The smoke run exits 0 on the local integrated stack (when provisioned).
- [x] The smoke run exits 0 in `SKIP_NO_LOCAL_STACK` mode (PARTIAL fallback).
- [x] The matrix is reproducible from `apps/web/tests/e2e/smoke/smoke.spec.ts` alone.

**Deployed-tier coverage:** pending. S-01 through S-22 must additionally be
re-run against a deployed staging environment once provisioned. See follow-up
R9-9.

---

## 2. 7 M1-in-scope CI stages (M1)

Per `docs/PHASE16_PLAN.md` §4.1, M1 is host-agnostic; the 7 stages are
wired in `.github/workflows/ci.yml` and are merge-blocking.

| Stage | Script | Blocking | Status |
|---|---|---|---|
| Lint | `npm run lint` (root) | yes | wired |
| Typecheck | `npm run typecheck` (root) | yes | wired |
| Unit tests | `npm run test --workspaces` (vitest) | yes | wired |
| Integration tests | `npm run test:integration` (per-workspace) | yes | wired |
| Build | `npm run build --workspaces` | yes | wired |
| Migration check | `bash scripts/migration-rehearsal.sh` (M3) | yes | wired |
| Fixture-based E2E | `npm run test:e2e:fixture` (M1 budget) | yes | wired |

### Out of M1 scope (deferred per §4.1)

The M7 real-stack smoke and the TRD §39 "deploy staging" stage are
**NOT** in M1. They are host-target concerns (§11 Q1) and are out of
Phase 16 mandatory scope.

### Sign-off: CI gates

- [x] The 7 stages run on every PR.
- [x] A failure in any stage blocks merge.
- [x] The migration check (M3) reuses `apps/api/src/db/__tests__/migrations.test.ts`
      as a sub-step.
- [x] The fixture-based E2E exercises the truthful stub (per Phase 0–13).

---

## 3. 5 rollback procedures (M5)

Per `docs/PHASE16_PLAN.md` §4.1, M5 is the rollback playbook. Each
procedure is documented in `docs/ROLLBACK.md` and is **demonstrated** at
sign-off per §4.3 sub-gate (a). Without a deployed environment, only
the local-simulation sub-gate (b) can be exercised; the PARTIAL verdict
applies and the re-demonstration follow-up is item R9-9 below.

| ID | Procedure | Doc | Demonstration | Status |
|---|---|---|---|---|
| R-1 | DB migration reversal | `docs/ROLLBACK.md` §R1 | local-simulation transcript in `docs/PHASE16_VERIFICATION.md` §3 | documented + simulated (PARTIAL) |
| R-2 | Env var revert | `docs/ROLLBACK.md` §R2 | local-simulation transcript | documented + simulated (PARTIAL) |
| R-3 | Dependency version revert | `docs/ROLLBACK.md` §R3 | local-simulation transcript | documented + simulated (PARTIAL) |
| R-4 | Build rollback to a prior image | `docs/ROLLBACK.md` §R4 | local-simulation transcript (recommended demo per plan §7.2) | documented + simulated (PARTIAL) |
| R-5 | Secret rotation | `docs/ROLLBACK.md` §R5 | local-simulation transcript | documented + simulated (PARTIAL) |

### Sign-off: rollback

- [x] All 5 procedures are documented in `docs/ROLLBACK.md` with owner + verification step.
- [x] At least one procedure (R-4 build rollback) is **demonstrated** locally
      with timestamps and `/health` bodies captured.
- [ ] At least one procedure is **demonstrated on the deployed staging
      environment once provisioned.** (DEFERRED — R9-9 follow-up.)

**Verdict rationale:** the Phase 16 plan §4.3 sub-gate (a) is the
governing posture; sub-gate (b) is a documented fallback that produces
a PARTIAL verdict. The re-demonstration follow-up is mandatory and
tracked as R9-9.

---

## 4. 8 runbook categories (M6)

Per `docs/PHASE16_PLAN.md` §4.1, M6 is the runbook. Each TRD §39 alert
category is documented in `docs/RUNBOOK.md` with alert definition,
recovery procedure, owner, and verification step.

| ID | Category | Doc | Status |
|---|---|---|---|
| RB-1 | Submission failure spike | `docs/RUNBOOK.md` §RB1 | documented |
| RB-2 | Evidence capture failure spike | `docs/RUNBOOK.md` §RB2 | documented |
| RB-3 | Dead-letter jobs | `docs/RUNBOOK.md` §RB3 | documented |
| RB-4 | Queue age breach | `docs/RUNBOOK.md` §RB4 | documented |
| RB-5 | Database saturation | `docs/RUNBOOK.md` §RB5 | documented |
| RB-6 | Authorization error anomaly | `docs/RUNBOOK.md` §RB6 | documented |
| RB-7 | AI provider failure rate | `docs/RUNBOOK.md` §RB7 | documented |
| RB-8 | Projection lag | `docs/RUNBOOK.md` §RB8 | documented |

### Sign-off: runbook

- [x] All 8 categories have alert definition, recovery procedure, owner, and verification step.
- [x] Each recovery procedure is testable without code change.

---

## 5. Frozen-boundary confirmation (M4 + cross-cutting AC)

Per `docs/PHASE16_PLAN.md` §4.2, Phase 16 is **additive-only**. The
frozen boundary is the Phase 0–15 contract set.

| Contract | Status | Source of truth |
|---|---|---|
| `assertOwned` count = 83 | unchanged | `docs/RELEASE_CONTRACTS_v1.0.md` §B |
| `EventType` union (34 members) | unchanged | `packages/shared/src/events/envelope.ts` |
| Notification dedup + per-kind preferences | unchanged | `apps/api/src/services/notification-preferences-service.ts` |
| RLS policies | unchanged | supabase/migrations/01..18 (frozen) |
| Service signatures | unchanged | grep over `apps/api/src/services/*.ts` |
| Route request/response shapes | unchanged (except M8 additive) | `apps/api/src/routes/*.ts` |
| New routes introduced | exactly 1: `GET /ops/event-failures` (M8) | `apps/api/src/routes/ops.ts` |
| Migrations introduced | exactly 0 (release contract = 18 frozen) | `supabase/migrations/` |
| Dependencies introduced | exactly 0 (M1 uses GitHub Actions YAML; M2/M3 use existing tools) | `package.json` (no new entries in root or workspaces for Phase 16 code) |
| Env vars introduced | 0 mandatory; 2 optional (`KRODEX_RELEASE_TAG`, `KRODEX_STAGING_BASE_URL`) | `docs/RELEASE_CONTRACTS_v1.0.md` §C |

### Sign-off: frozen boundary

- [x] `assertOwned` count remains 83 (no Phase 16 code adds or removes call sites).
- [x] `EventType` union is unmodified.
- [x] Notification dedup logic is unmodified.
- [x] RLS policies are unmodified.
- [x] Service signatures are unmodified.
- [x] Route shapes are unmodified (only the additive M8 route is new).
- [x] Zero new migrations on disk.
- [x] Zero new vendor dependencies.
- [x] Zero mandatory new env vars.

---

## 6. M8 ops route (additive)

The single new route in Phase 16 is `GET /ops/event-failures`. It is
service-role-only, read-only, and unreachable by Phase 0–15 clients.

| Item | Status |
|---|---|
| Route mounted | `apps/api/src/routes/ops.ts` |
| Service-role auth | required (`env.hasServiceRole`); non-service-role → 401/403 |
| Response envelope | matches krodex shape (typed) |
| Unit test | `apps/api/src/ops/__tests__/event-failures.test.ts` (M8 budget) |
| Integration test | `apps/api/src/ops/__tests__/ops-routes.test.ts` (M8 budget) |

### Sign-off: M8

- [x] Route is mounted and reachable.
- [x] Auth posture is verified by test.
- [x] Response shape is frozen.

---

## 7. Verification artifacts

| Artifact | Path | Purpose |
|---|---|---|
| Release contract freeze | `docs/RELEASE_CONTRACTS_v1.0.md` | M4 — frozen 18 migrations, EventType union, route list |
| Runbook | `docs/RUNBOOK.md` | M6 — 8 alert categories |
| Rollback playbook | `docs/ROLLBACK.md` | M5 — 5 high-risk procedures |
| Migration rehearsal | `scripts/migration-rehearsal.sh` | M3 — applies 18 migrations cleanly |
| Env-var audit | `scripts/audit-env.mjs` | M2 — exit 0 on complete `.env` |
| CI workflow | `.github/workflows/ci.yml` | M1 — 7 merge-blocking stages |
| Smoke config | `apps/web/playwright.smoke.config.ts` | M7 — local integrated stack |
| 22-scenario matrix | `apps/web/tests/e2e/smoke/smoke.spec.ts` | M7 — version-controlled mapping |
| Phase 16 verification | `docs/PHASE16_VERIFICATION.md` | M10 — what shipped, what passed, what was deferred |

---

## 8. Sign-off: this checklist

- [x] All sections above are filled in.
- [x] No item is silently dropped.
- [x] PARTIAL verdict is recorded (not PASS) per §4.3 sub-gate (b).
- [x] The re-demonstration follow-up is captured as R9-9.

---

## 9. Follow-up items (post-release)

| ID | Item | Trigger | Owner |
|---|---|---|---|
| R9-1 | Re-run M7 smoke against a deployed staging environment once provisioned | post-release | ops |
| R9-2 | Re-run M5 rollback demonstration (R-4 build rollback) on a deployed environment | post-release | ops |
| R9-3 | Update the M9 release checklist to PARTIAL → PASS once R9-2 is complete | post-release | tech lead |
| R9-4 | Re-execute `scripts/migration-rehearsal.sh` against the deployed DB pre-cutover | pre-cutover | on-call |
| R9-5 | Re-execute `scripts/audit-env.mjs` against the deployed env pre-cutover | pre-cutover | on-call |
| R9-6 | Confirm TRD §39 monitoring/alerting integration is wired to the runbook (RB-1..RB-8) | post-release | ops |
| R9-7 | Confirm the 8 runbook categories have a real alert source (currently documented procedures; alert integration is a host concern) | post-release | ops |
| R9-8 | Author the O7 host-target artifacts (Vercel + Render/Fly + Supabase Cloud) | separate authorization | tech lead |
| **R9-9** | **Re-demonstrate rollback on the deployed staging environment once provisioned** (MANDATORY per §4.3 sub-gate (b)) | post-release | ops + tech lead |

---

## 10. Verdict

**PARTIAL** per `docs/PHASE16_PLAN.md` §4.3 sub-gate (b).

- Frozen boundary confirmed (additive-only).
- All 22 PRD scenarios covered by named Playwright tests.
- All 7 M1 CI stages wired and merge-blocking.
- All 5 M5 rollback procedures documented; local simulation captured in
  `docs/PHASE16_VERIFICATION.md` §3.
- All 8 M6 runbook categories documented.
- The deployed-environment rollback demonstration is **deferred** and
  tracked as R9-9.
