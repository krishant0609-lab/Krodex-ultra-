# KRODEX — Rollback Playbook

**Status:** Phase 16 M5 deliverable (frozen at v1.0)
**Source of truth:** PIP §16 "Create rollback plan" + Engineering Support §58 "Monitoring and rollback exist"
**Audience:** on-call engineer, release engineer, ops lead
**Last reviewed:** 2026-09-04

This playbook is the v1.0 baseline of the 5 highest-risk surface changes
that an operator might need to revert under incident pressure. Every
procedure has four fields:

- **When to use** — the symptom + the trigger that says "rollback, not fix-forward".
- **Procedure** — the steps to take, in order.
- **Owner** — the role that owns the rollback decision and execution.
- **Verification step** — what to check before declaring the rollback complete.
- **Expected downtime** — best-case / worst-case bounds on the user-facing impact.

The 5 procedures are the PIP §16 list, in PIP §16 order. There are no
other rollback surfaces at v1.0.

**Demonstration requirement.** Per `docs/PHASE16_PLAN.md` §7.3, at least
one of the 5 procedures must be *demonstrated* end-to-end before Phase 16
sign-off. The recommended demonstration is the build rollback (R4) because
it is the lowest-risk and most observable. The demonstration is recorded
in `docs/PHASE16_VERIFICATION.md` §X.

---

## R1. DB migration reversal

| Field | Value |
|---|---|
| **When to use** | A migration applied in *any* phase *after* Phase 16 introduces a schema change that breaks a hot path (e.g. a `NOT NULL` constraint that the application does not yet set, a dropped column that an old API artifact still references, a partial index that the planner mis-uses). Symptom: `event_log.status='failed'` count spikes for the handler that touches the changed table, OR a 5xx storm with `error.code='DEPENDENCY_UNAVAILABLE'` originating in Postgres. |
| **Procedure** | 1. **Stop the bleed.** Pause the outbox worker (set `OUTBOX_WORKER_ENABLED=false` via the env-var revert procedure R2) so no new events are projected onto the new schema while the rollback is in flight. 2. **Identify the bad migration** by checking the `supabase_migrations.schema_migrations` table for the most recent version that has no corresponding `down` in the migration file (Phase 16 ships no down migrations; every prior phase is additive-only by contract, so a forward-only `down` is not authored). 3. **Restore the pre-migration DB snapshot** from the Supabase project's point-in-time recovery (PITR) or the nightly logical backup — pick the snapshot taken immediately before the migration was applied. 4. **Replay the outbox** once the API is back on the old schema: restart the API; the worker's `claim_pending_events` will reprocess every event that was `pending` at the time of the pause (events that were already `succeeded` are skipped by the `(event_id, handler_name)` unique key per migration 08, so replay is safe). 5. **Record the deviation** in `docs/PHASE16_VERIFICATION.md` §X. |
| **Owner** | Backend on-call + release engineer (for the snapshot-restore decision) |
| **Verification step** | The `event_log` failure count for the affected handler returns to 0 within 10 minutes of replay. The `error_entries`, `attempts`, and `notifications` row counts match the pre-migration snapshot. A smoke run of the 22 PRD scenarios (per `apps/web/tests/e2e/smoke/`) returns the same pass set as before the migration. |
| **Expected downtime** | Best case: 2 minutes (worker pause + snapshot restore + API restart). Worst case: 30 minutes (full logical backup restore on a multi-GB project). User-facing read traffic is impacted for the full window; write traffic is queued by the outbox and applied on recovery. |

## R2. Env var revert

| Field | Value |
|---|---|
| **When to use** | A new or changed environment variable causes a misconfiguration that is observable from `/health` or a 4xx/5xx storm. The Phase 16 env-var set is small and audited (`scripts/audit-env.mjs`): `KRODEX_RELEASE_TAG` (default `'dev'`), `KRODEX_STAGING_BASE_URL` (optional), plus the existing 39 keys from Phase 0–15. Symptom: `app.release_tag` in `/health` does not match the expected value, OR a route that worked before now returns 503 with `error.code='DEPENDENCY_UNAVAILABLE'` because an env var is missing. |
| **Procedure** | 1. **Confirm the env var is the cause** by running `npm run audit:env` (M2) against the live env; the script exits 1 and prints the offending key. 2. **Revert the env var** in the deployment platform's environment editor: either set the value to the prior value (if the value itself is wrong) or unset it (to fall back to the default in `apps/api/src/config/env.ts`). The defaults are: `KRODEX_RELEASE_TAG='dev'`, `KRODEX_STAGING_BASE_URL=undefined`. 3. **Restart the API** so `loadEnv()` re-reads the env. The restart is required because env vars are read once at process start. 4. **Re-run the env audit** to confirm the offending key is now `OK`. 5. **Record the deviation** in `docs/PHASE16_VERIFICATION.md` §X. |
| **Owner** | Backend on-call |
| **Verification step** | `GET /health` returns `db.up === true` and `app.release_tag` matches the expected value. `npm run audit:env` exits 0. A smoke run of the 22 PRD scenarios returns the same pass set as before the env-var change. |
| **Expected downtime** | Best case: 30 seconds (env editor + API restart). Worst case: 2 minutes (rolling restart with health-check grace). No DB state is touched. |

## R3. Dependency version revert

| Field | Value |
|---|---|
| **When to use** | A dependency version bump (Node package, transitive dep) introduces a runtime regression that is observable in production but not in CI. The 17 git-tracked migrations from Phase 0–15 plus Phase 16 ship no new dependencies (`docs/PHASE16_PLAN.md` §1 hard constraint), so this procedure is forward-looking. Symptom: a Node `MODULE_NOT_FOUND`, a `SyntaxError` at boot, or a library-internal error that is not present in the last-known-good artifact. |
| **Procedure** | 1. **Identify the bad version** by diffing the current `package.json` + `package-lock.json` against the SHA captured in `docs/RELEASE_CONTRACTS_v1.0.md` (or, for post-Phase 16, the equivalent freeze doc for the active release). 2. **Pin the old version** by editing `package.json` + regenerating the lockfile: `npm install <pkg>@<old-version> --save-exact` per workspace. 3. **Reinstall** in CI (`npm ci`) and confirm the lockfile is reproducible. 4. **Redeploy** using the build-rollback procedure (R4) — the version revert is a new artifact. 5. **Record the deviation** in `docs/PHASE16_VERIFICATION.md` §X. |
| **Owner** | Release engineer |
| **Verification step** | The new artifact boots without `MODULE_NOT_FOUND` or library-internal errors. `npm ls <pkg>` shows the pinned old version. A smoke run of the 22 PRD scenarios returns the same pass set as before the version bump. |
| **Expected downtime** | Best case: 5 minutes (CI rebuild + redeploy). Worst case: 20 minutes (full CI matrix + multi-region rollout). No DB state is touched. |

## R4. Build rollback

| Field | Value |
|---|---|
| **When to use** | A new release artifact (the `apps/api/dist` + `apps/web/.next` produced by the M9 release pipeline) is deployed and immediately causes a regression that is observable in production but not in the smoke run (e.g. a config-time issue masked in the smoke env, a race condition that only fires under real load, a feature flag the smoke env did not exercise). Symptom: `/health` returns `app.release_tag` matching the new tag, but error rates climb. The M9 release checklist captures the artifact SHA per release. |
| **Procedure** | 1. **Confirm the regression is in the new artifact** by sampling 10 5xx responses from the API logs and confirming they reference the new `app.release_tag`. 2. **Redeploy the prior artifact** via the deployment platform: pick the previous release from the deployment history, redeploy its `apps/api/dist` + `apps/web/.next` bundle, and pin the rollout to the same env vars as the current release (the env is the same; only the artifact changes). 3. **Restart the API + web** so the old artifact is loaded. 4. **Confirm recovery** via the verification step below. 5. **Record the deviation** in `docs/PHASE16_VERIFICATION.md` §X with the deployed environment identifier, the old artifact SHA, the new artifact SHA, and the actual `/health` response bodies. |
| **Owner** | Release engineer (for the redeploy decision) + backend on-call (for the recovery confirmation) |
| **Verification step** | `GET /health` returns `app.release_tag` matching the **prior** tag (not the bad one). Error rates return to baseline within 5 minutes. A smoke run of the 22 PRD scenarios returns the same pass set as before the bad release. The rollback is *demonstrated* end-to-end per `docs/PHASE16_PLAN.md` §7.3, with the demonstration record captured in `docs/PHASE16_VERIFICATION.md` §X. |
| **Expected downtime** | Best case: 1 minute (artifact swap + restart). Worst case: 5 minutes (multi-region rollout with health-check grace). No DB state is touched. |

## R5. Secret rotation

| Field | Value |
|---|---|
| **When to use** | A secret in the deployment platform's secret manager is suspected of compromise (visible in CI logs, accidentally committed, exfiltrated by a third-party incident, or due for a scheduled rotation per the platform's key-age policy). The secrets in scope at v1.0 are: Supabase service-role key, Supabase anon key, JWT signing secret (`AUTH_JWT_SECRET`), AI provider key (`AI_API_KEY`), email provider key, push provider VAPID keys. Symptom: an unauthorized party authenticates against the API, OR the secret is visible in a public log line, OR the platform's key-rotation watchdog fires. |
| **Procedure** | 1. **Identify the secret** in scope and confirm the compromise (skip if the trigger is a scheduled rotation, not an incident). 2. **Rotate the secret** in the *upstream* provider first (Supabase / OpenAI / Resend / web-push VAPID generator), then propagate the new value to the deployment platform's secret manager. 3. **Restart the API** so `loadEnv()` re-reads the new secret. The restart is required because secrets are read once at process start. 4. **Revoke the old secret** at the upstream provider so the old value can no longer authenticate. 5. **Record the rotation** in `docs/PHASE16_VERIFICATION.md` §X with the secret name, the old value's last-4, the new value's last-4, the rotation timestamp, and the operator's name. |
| **Owner** | Backend on-call + security lead (for the rotation decision) |
| **Verification step** | `GET /health` returns `db.up === true` (confirms the Supabase service-role key is valid) and `event_bus.running === true` (confirms the outbox worker booted). A test call to the AI route (e.g. `POST /assistant/chat` with a minimal prompt) returns 200 (confirms `AI_API_KEY` is valid). A test login (e.g. `POST /auth/login` with a fixture user) returns 200 (confirms `AUTH_JWT_SECRET` is valid). The old secret is rejected by the upstream provider. |
| **Expected downtime** | Best case: 30 seconds (secret manager update + API restart). Worst case: 2 minutes (rolling restart with health-check grace). No DB state is touched. Brief 401s may be served during the restart window if a user's request lands on an old-vs-new worker — these are client-side recoverable (the client refreshes the session). |

---

## Cross-references

- **R1** references the **18-file migration set** in `docs/RELEASE_CONTRACTS_v1.0.md` §1, the **outbox replay** in migration 08 (idempotency on `(event_id, handler_name)`), and the **migration-rehearsal script** (M3) as the rehearsal tool.
- **R2** references the **env-var audit script** (M2: `scripts/audit-env.mjs`) and the **env schema** (`apps/api/src/config/env.ts`).
- **R3** references the **contract freeze** (M4: `docs/RELEASE_CONTRACTS_v1.0.md`) for the version baseline.
- **R4** is the **demonstrated** procedure per `docs/PHASE16_PLAN.md` §7.3. The demonstration record lives in `docs/PHASE16_VERIFICATION.md` §X.
- **R5** references the **/health** route (Phase 0 baseline) as the post-rotation smoke. The 4 mandatory health fields are: `app.release_tag`, `db.up`, `event_bus.running`, `queue_age_seconds`.
- All 5 procedures converge on **`docs/PHASE16_VERIFICATION.md` §X** for the deviation log. Per `docs/PHASE16_PLAN.md` §4.3 sub-gate (b), if any rollback is invoked and the local-simulation fallback is used in lieu of a deployed environment, the Phase 16 verdict is `PARTIAL` and a follow-up re-execution is recorded in `docs/RELEASE_CHECKLIST.md` as a post-release item.
