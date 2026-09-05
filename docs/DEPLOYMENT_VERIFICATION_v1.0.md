# KRODEX v1.0 — DEPLOYMENT VERIFICATION (v1.0-verified)

**Date:** 2026-09-05
**Branch:** `deployment/v1.0-production` (from `v1.0-verified` → `c746c18`)
**Protected tag:** `v1.0-verified` (preserved unchanged)
**Existing tag:** `v1.0` (preserved unchanged at `c54e312`)

---

## Status

# 🟡 PARTIAL

Database tier is **live** on a fresh Supabase project. Landing page is **live** on
Vercel (SSO protection disabled, publicly accessible). API + worker + scheduled
jobs remain **blocked** because no Railway host was available in this session.

| Tier | State | Evidence |
|---|---|---|
| Database | 🟢 LIVE | Fresh Supabase project `krodex-production` (`gikanzcuyblrffybcrsa`) in `ap-northeast-1`; 20 migrations applied; 45 tables (44 with RLS); 3 private storage buckets; all RPCs and background functions present. |
| Landing | 🟢 LIVE | Vercel project `krodex-landing` deployed with this status page; public URL `https://krodex-landing-n6dytircv-krodex.vercel.app`; SSO protection disabled via `/v9/projects` PATCH (`"ssoProtection": null`). |
| API + worker | 🟥 BLOCKED | No Railway MCP, no Railway CLI auth (no `RAILWAY_TOKEN`, no `railway login` available in this session), no browser-based Railway access. |
| Real-deployed flows | 🟥 NOT VERIFIED | Depends on API + worker. |

Per the master directive §1 rules ("DO NOT fabricate credentials", "DO NOT
fabricate URLs", "DO NOT fabricate deployment success"), no Railway account was
invented, no `RAILWAY_TOKEN` was assumed, and no API URL was guessed. The web
tier (`apps/web`) is bundled at `deploy/web-app/` but **not deployed** because
it requires a real `NEXT_PUBLIC_API_BASE_URL`, which only exists after the API
is hosted.

---

## Protection

| Item | Value |
|---|---|
| Protected tag | `v1.0-verified` (preserved at `c746c18`) |
| Existing tag | `v1.0` (preserved at `c54e312`) |
| Deployment branch | `deployment/v1.0-production` |
| Branch HEAD before this session | `78ffd18` |
| Phase 0–16 contracts | not modified |
| Source of truth | `v1.0-verified` tag (untouched) |

---

## Re-verification (Phase B)

| Check | Result |
|---|---|
| `apps/api` vitest | 1001 passed / 22 skipped / 0 failed |
| `apps/web` vitest | 193 passed / 0 failed |
| Combined | **1194 passed / 22 skipped / 0 failed** (matches v1.0-verified baseline) |
| TypeScript (`@krodex/shared`) | clean |
| TypeScript (`@krodex/api`) | clean |
| TypeScript (`@krodex/web`) | clean |
| Production build (`next build`) | succeeded |
| Lint baseline | 9 errors / 48 warnings (pre-existing, untouched per master directive) |

The protected `v1.0-verified` state is reproducible. No re-verification defect
was discovered.

---

## Supabase — 🟢 LIVE

A **fresh** Supabase project `krodex-production` (`gikanzcuyblrffybcrsa`,
`ap-northeast-1`) was created (replacing the previous legacy project
`uuavcvqcgosehhjadfij` that contained a different product's schema). All 20
migrations applied.

| # | Migration | Status |
|---|---|---|
| 01 | `01_extensions` | ✅ applied |
| 02 | `02_helpers` | ✅ applied |
| 03 | `03_core_schema` | ✅ applied |
| 04a | `04a_rls_phase1` | ✅ applied |
| 05 | `05_seed_dev` | ✅ applied |
| 06 | `06_idempotency_keys` | ✅ applied |
| 07 | `07_domain_rpcs` | ✅ applied |
| 08 | `08_event_bus` | ✅ applied |
| 09 | `09_extend_rpcs_with_outbox` | ✅ applied |
| 10 | `10_progress_evidence_dedup` | ✅ applied |
| 11 | `11_scheduled_job_fns` | ✅ applied |
| 12 | `12_analytics_rollup` | ✅ applied |
| 13 | `13_student_model_recompute` | ✅ applied |
| 14 | `14_error_capture_pipeline` | ✅ applied |
| 15 | `15_review_and_planner_history` | ✅ applied |
| 04b | `04b_rls_phase10_11` | ✅ applied |
| 16 | `16_notification_dedup` | ✅ applied |
| 17 | `17_security_audit_log` | ✅ applied |
| 18 | `18_perf_indexes` | ✅ applied |
| 19 | `19_deploy_attempts_reviews_stub` | ✅ applied (deployment-only stub) |

### Live verification (post-deploy SQL)

```sql
-- Tables
SELECT count(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE';
-- → 45

-- RLS-enabled tables
SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
  WHERE t.schemaname='public' AND c.relrowsecurity=true;
-- → 44
-- (1 remaining table is the `attempts` / `reviews` stub for FK resolution,
--  created in migration 19 to satisfy pre-existing FK references in
--  error_evidence.attempt_id and error_lifecycle_events.review_id.)

-- Storage buckets
SELECT id, name, public FROM storage.buckets ORDER BY name;
-- error-captures  (private)
-- error-evidence   (private)
-- question-snapshots (private)
```

### Key functions present (from `pg_proc`)

- `submit_test_attempt(p_user_id uuid, p_test_id uuid, p_answers jsonb, ...)` — domain RPC
- `schedule_review_for_error(p_user_id uuid, p_error_entry_id uuid, ...)` — domain RPC
- `record_progress_evidence(p_user_id uuid, ...)` — domain RPC
- `mark_due_reviews()` — scheduled job (5 min)
- `detect_missed_tasks()` — scheduled job (15 min)
- `recompute_analytics_rollup(p_user_id uuid, p_since timestamptz, p_until timestamptz)` — D-9 Class C, scheduled 5 min
- `recompute_student_model(p_user_id uuid)` — scheduled 5 min

---

## Vercel — 🟢 LIVE (landing only)

| Item | Value |
|---|---|
| Vercel team | `krodex` (`team_xIoMYMcOyUwDXXc65rFmyvwi`) |
| Project | `krodex-landing` (`prj_iucAdPbiJFSFYLAcK4YAJOQqi2Sa`) |
| Production URL | `https://krodex-landing-n6dytircv-krodex.vercel.app` |
| Aliases | `krodex-landing.vercel.app`, `krodex-landing-krodex.vercel.app` |
| Status | `● Ready` |
| Framework | `nextjs` |
| Node version | `24.x` |
| Build command | `next build` (auto-detected) |
| SSO protection | **disabled** (`"ssoProtection": null`, set via `/v9/projects` PATCH) |
| Public access | **yes** — `WebFetch` returns the page body, not a redirect to `vercel.com/sso-api` |
| Source | `deploy/landing/` (committed in this session as a self-contained Next.js 14 App Router project) |

The `apps/web` real application is bundled at `deploy/web-app/` (200+ files,
self-contained with the shared workspace inlined at `_shared/`) but **not
deployed** because it requires `NEXT_PUBLIC_API_BASE_URL` pointing to a real
API host, which only exists after the API tier is provisioned.

### SSO disable evidence

The MCP `update_project_deployment_protection` returned 404; the public
endpoint `https://krodex-landing-n6dytircv-krodex.vercel.app` returned a
redirect to `vercel.com/sso-api`. The Vercel CLI is authenticated as
`krishant159-5209`; via the CLI, the same PATCH succeeded:

```
node -e "const { execSync } = require('child_process');
  const out = execSync('vercel api /v9/projects/krodex-landing --method PATCH -H content-type:application/json --input - 2>&1', {encoding:'utf-8', input: JSON.stringify({ssoProtection: null})});
  console.log(out.match(/ssoProtection[^}]*}/)[0])"
→ "ssoProtection": null,
```

A subsequent `WebFetch` of the public URL returned the page body, not the SSO
redirect.

---

## Railway — 🟥 BLOCKED (no host available)

| Item | Value |
|---|---|
| Railway account | (none provisioned in this session) |
| Railway MCP | **not available** in this session |
| `RAILWAY_TOKEN` env var | not set |
| `RAILWAY_API_TOKEN` env var | not set |
| `~/.railway` config | does not exist |
| Railway CLI | `npm i -g @railway/cli` succeeded (5.49.2), but `railway whoami` returns "Unauthorized. Please login with `railway login`" |
| Browser-based access | not available in this session |

### Why this is a blocker

The master directive names Railway as the persistent host for `apps/api` (Fastify
HTTP server) + the event-bus worker + the five scheduled jobs. Per master
directive rules:

- **"DO NOT fabricate credentials"** — no `RAILWAY_TOKEN` was invented
- **"DO NOT fabricate URLs"** — no `https://api.krodex.up.railway.app`-style
  URL was synthesized
- **"DO NOT fabricate deployment success"** — no Railway service was claimed
  to be running

The only available path would be `railway login` (interactive) or a
`RAILWAY_TOKEN` environment variable, neither of which is available in this
session.

### Required operator action to unblock

Provide a `RAILWAY_TOKEN` (or run `railway login` in a terminal with browser
access). Once authenticated, the following will execute:

1. `railway init` → create `krodex-production` project
2. `railway add` → create service from `apps/api` (root `package.json` builds
   `build:shared` then `build:api`; start command `node dist/server.js`)
3. `railway variables set` →
   - `NODE_ENV=production`
   - `PORT=8080`
   - `SUPABASE_URL=https://gikanzcuyblrffybcrsa.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=<operator-provided>`
   - `SUPABASE_ANON_KEY=<operator-provided>`
   - `CORS_ALLOWED_ORIGINS=https://krodex-landing-n6dytircv-krodex.vercel.app`
   - `WEB_ORIGIN=https://krodex-landing-n6dytircv-krodex.vercel.app`
   - `LOG_LEVEL=info`
4. `railway up` → push and deploy
5. Capture the assigned URL (e.g. `https://krodex-api-production.up.railway.app`)
6. `vercel env add NEXT_PUBLIC_API_BASE_URL <railway-url> --project krodex-landing`
7. `vercel deploy deploy/web-app/ --prod` (or link to a new `krodex-web` project)
8. Verify: `curl https://<railway-url>/health` returns `{ "phase": "ok" }`

---

## apps/web — 🟥 NOT DEPLOYED (waiting on API URL)

| Item | Value |
|---|---|
| Bundle location | `deploy/web-app/` (committed) |
| File count | 200+ |
| `NEXT_PUBLIC_API_BASE_URL` | not set (cannot be set without a real API URL) |
| Build | succeeds locally (`next build` produces 18 static + 9 dynamic routes) |

Per master directive ("DO NOT fabricate URLs"), the real `apps/web` was not
deployed because doing so would require either (a) an unset env var that throws
at runtime, or (b) a guessed API URL that does not exist.

The status page on the Vercel landing URL is the only `apps/web`-derived
artifact live in production. The actual `apps/web` is built into the repo and
ready to deploy as soon as the API URL is known.

---

## Background jobs — 🟥 NOT VERIFIED

| Job | Cadence | Status |
|---|---|---|
| Outbox poll | 5s | not verified (no API process) |
| `mark_due_reviews` | 5 min | not verified |
| `detect_task_missed` | 15 min | not verified |
| `recompute_analytics_rollup` | 5 min | not verified |
| `recompute_student_model` | 5 min | not verified |

The job cadences are unchanged in source. The five functions are present in
`pg_proc` in the live Supabase project and can be invoked manually via the
`pg_cron`-like infrastructure, but no API process is running to drive the
5-second outbox poll, so end-to-end job execution cannot be observed.

---

## Notifications — 🟥 NOT VERIFIED

The `notifications` and `notification_deliveries` tables exist with RLS in the
live Supabase project (migration 16 applied), but no notification path was
exercised end-to-end. No deduplication, projection, or delivery can occur
without the API tier.

---

## Security — ⚪ NOT VERIFIED (no live API)

The existing security middleware (`@fastify/helmet`, `@fastify/rate-limit`,
`@fastify/under-pressure`, `audit-logger`) is present in the source and
verified in unit tests. The `audit_events` table exists in the live Supabase
project. A running API deployment would be required to confirm production
behavior.

---

## Rollback (Phase 17) — ⚪ NOT DEMONSTRATED

The Phase 16 PARTIAL verdict (sub-gate b) was driven by the absence of a
**deployed** rollback demonstration. That absence is unchanged: there is no
deployed API + worker on which to demonstrate rollback. The ROLLBACK.md
procedure itself is unchanged in the repository.

---

## Known limitations

1. **No API deployment exists.** The Railway tier is blocked; the web tier
   cannot be deployed with a real `NEXT_PUBLIC_API_BASE_URL`. Every flow that
   requires the API is `🟥 NOT VERIFIED`.
2. **No background-worker execution observed.** Without an API process the
   outbox + scheduled jobs cannot fire.
3. **`docs/perf-baseline.json`** reflects the local integrated stack, not a
   deployed environment. It is not a production SLO.
4. **The existing v1.0 PARTIAL verdict** (Phase 16 §4.3 sub-gate b) is
   unchanged by this deployment pass. The protection tag `v1.0-verified`
   documents the verified code state, not a verified production deployment.

---

## Required operator actions to complete deployment

In order, the operator must:

1. **Provision Railway**: `railway login` in a terminal (or set
   `RAILWAY_TOKEN`); run the 8-step sequence in the Railway section above.
2. **Provide Supabase service-role and anon keys** (currently not retrievable
   from this session without exposing secrets). Set them on the Railway
   service.
3. **Confirm** the Vercel landing URL (`https://krodex-landing-n6dytircv-krodex.vercel.app`)
   is acceptable as `WEB_ORIGIN` / `CORS_ALLOWED_ORIGINS` for the API; or
   provide an alternate web origin.
4. **Verify** the live chain: `curl https://<railway-url>/health` →
   `{ "phase": "ok", "db": "ok", "bus": "ok" }`; then a real login, a real
   test attempt, and a real error capture.
5. **Demonstrate rollback** per `docs/ROLLBACK.md` to close the remaining
   Phase 16 PARTIAL sub-gate (b).

---

## Final verdict

# 🟡 PARTIAL

| Tier | Result |
|---|---|
| Source (`v1.0-verified`) | 🟢 production-ready and reproducible (1194 tests passing) |
| Database | 🟢 live on `gikanzcuyblrffybcrsa.supabase.co` |
| Landing | 🟢 live at `https://krodex-landing-n6dytircv-krodex.vercel.app` (public, SSO off) |
| Real `apps/web` | 🟥 blocked on API URL |
| API + worker | 🟥 blocked on Railway host |
| Background jobs | 🟥 not verified (no API) |
| Rollback | ⚪ not demonstrated (no API) |

The next session (or a human operator with a `RAILWAY_TOKEN`) can complete the
deployment by following the 8-step sequence in the Railway section.
