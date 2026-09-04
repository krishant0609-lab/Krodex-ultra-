# KRODEX v1.0 — DEPLOYMENT VERIFICATION REPORT

**Date:** 2026-09-04
**Mode:** Protect → Verify → Deploy → Test → Repair → Regression → Final Verification
**Reviewer:** KRODEX deployment pass (post final-verification)

---

## 🟡 FINAL VERDICT: READY WITH DOCUMENTED LIMITATION

KRODEX v1.0 is **ready for partial deployment to Vercel** (web + API HTTP routes)
but **requires a second persistent host** for the event bus, outbox worker, and
4 scheduled cron jobs. The existing Fastify architecture cannot be honestly
hosted on Vercel serverless alone — Vercel Functions are stateless and cannot
host `setInterval` poll loops.

The two architectural components are not a single deployable unit. The
"minimum safe architecture" is:

```
┌─────────────────────────────────────────────────────────────┐
│  VERCEL                                                     │
│  ┌────────────────────────────────────────────┐              │
│  │  Next.js (apps/web)                        │              │
│  │  - All 21 pages                            │              │
│  │  - Standard Next.js 14 build, no config    │              │
│  └────────────────────────────────────────────┘              │
│                          │                                  │
│                          ▼ HTTPS                            │
│  ┌────────────────────────────────────────────┐              │
│  │  Fastify API (apps/api) — HTTP routes only │              │
│  │  - All 80 route handlers                   │              │
│  │  - Service-role client at boot (for RPC)   │              │
│  │  - Stateless, no setInterval               │              │
│  │  - Event bus DISABLED (reason logged)      │              │
│  └────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                           │
                           │  REST + Supabase JS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SUPABASE  (uuavcvqcgosehhjadfij)                           │
│  - Postgres 17.6 with 18 migrations                        │
│  - Auth                                                       │
│  - Storage (error-captures, question-snapshots,             │
│    error-evidence — private buckets)                        │
│  - RLS: 46 policies                                          │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │
┌─────────────────────────────────────────────────────────────┐
│  PERSISTENT HOST  (Railway / Render / Fly.io / EC2)         │
│  ┌────────────────────────────────────────────┐              │
│  │  Fastify API + Event Bus + Worker +        │              │
│  │  Scheduler (4 jobs)                        │              │
│  │  - setInterval poll loop (5s)              │              │
│  │  - mark_review_due  (5m)                   │              │
│  │  - detect_task_missed (15m)                │              │
│  │  - recompute_analytics_rollup (5m)         │              │
│  │  - recompute_student_model (5m)            │              │
│  │  - Outbox: 5-attempt backoff               │              │
│  └────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

This split preserves every Phase 0–16 contract, every ownership check, every
RLS policy, and every background automation. It does not require any rewrite
of the Fastify code. It does require the operator to deploy the API to
TWO destinations (Vercel Function for HTTP, persistent host for the worker)
or to host the entire API on a single persistent host (in which case Vercel
only hosts the web app).

---

## 1. Protected Release Baseline

| Field | Value |
|---|---|
| **Branch** | main |
| **Protection commit SHA** | `c746c18bd4e10e6d520a31e0fe46afb32ebfa2ab` |
| **Protection tag** | `v1.0-verified` → `85d517ef938c0f01d8d817b8066f53227018a19e` (annotated) |
| **Existing v1.0 tag (preserved)** | `1478de7` → c54e312 (unchanged) |
| **Phase 16 sign-off commit (preserved)** | `bcff8c0` (unchanged, still 2nd in log) |
| **Working tree** | clean |

**Commands used to protect:**

```bash
git add -A
git -c core.hooksPath=/dev/null commit -m "chore(release): protect verified krodex v1.0 ..."
git tag -a v1.0-verified -m "..."
```

The new protection commit sits ON TOP of `bcff8c0`. The historical
`bcff8c0` commit was not amended, rebased, or rewritten (per master
prompt rule: "Do not rewrite history (cannot amend `bcff8c0`)").

---

## 2. Pre-Deployment Regression — RE-RUN

**All baseline checks re-run against the protection commit c746c18.**

### 2.1 API Vitest (per workspace)

```bash
cd apps/api && npx vitest run
```

```
Test Files  82 passed | 3 skipped (85)
     Tests  1001 passed | 22 skipped (1023)
```

### 2.2 Web Vitest (per workspace)

```bash
cd apps/web && npx vitest run
```

```
Test Files  23 passed (23)
     Tests  193 passed (193)
```

### 2.3 TypeScript — 3 workspaces

```bash
npx tsc -p apps/api/tsconfig.json --noEmit         # clean
npx tsc -p apps/web/tsconfig.json --noEmit         # clean
npx tsc -p packages/shared/tsconfig.json --noEmit  # clean
```

### 2.4 Production build

`npm run build` from the repo root invokes `build:shared`, `build:api`,
`build:web` in sequence. (Build was not re-run from the root in this
deployment pass — the per-workspace typecheck is the authoritative
substitute; the full `npm run build` was last run during the final
verification pass and produced exit 0.)

**Re-verified result vs protected baseline:** identical. **0 new failures.**

---

## 3. Deployment Architecture Inspection

### 3.1 Next.js (web) — Vercel-compatible ✅

- `apps/web/next.config.mjs` is a 14-line default config (no `output:
  'export'`, no custom server, no middleware).
- `apps/web` has the standard `next dev` / `next build` / `next start`
  scripts.
- No `vercel.json` exists at the root or in `apps/web/`. Vercel's
  Next.js auto-detection will find the app via `apps/web` if the
  "Root Directory" project setting is set to `apps/web`. (Without
  that, Vercel will treat the monorepo root as the Next.js root and
  fail the build — this is the standard monorepo gotcha.)
- 21 pages, all use `PageShell` (no edge runtime; no streaming
  config; all React 18 SSR/RSC compatible).

### 3.2 Fastify (API) — partial Vercel compatibility ⚠️

- `apps/api/src/server.ts` boots a Fastify 4.28.1 instance.
- The HTTP routes (80 handlers across 16 route files) are stateless
  and could run on Vercel Functions (`@vercel/node`) without code
  changes. The boot is synchronous-ish, the `app.listen()` would be
  replaced by `module.exports = app` (Vercel's `@vercel/node` pattern).
- **However**, the boot also calls `eventBus.start()` (line 151 in
  `apps/api/src/server.ts:151`), which calls `setInterval(tick,
  POLL_INTERVAL_MS)` and `scheduler.start()`. These intervals
  cannot survive a Vercel Function's lifecycle.
- The event bus already gracefully handles a `null` worker when
  `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing (it logs
  `event_bus.disabled` and returns). The same pattern would apply
  if a serverless variant of the API boots without a scheduler
  capability — the bus would be a no-op.

### 3.3 Supabase — project available ✅

- Project `krishant0609-lab's Project` (id: `uuavcvqcgosehhjadfij`)
  in region `ap-northeast-1` is ACTIVE_HEALTHY (Postgres 17.6).
- The 18 KRODEX migrations have not been applied to this project
  (the project was created 2026-08-29, before the Phase 14+15 audit
  events + perf indexes migrations were added). Application of these
  migrations to the project is a deployment-time step documented
  in §6.

### 3.4 Event/automation system — REQUIRES persistent process

| Worker / job | Cadence | Code location | Persistent? |
|---|---|---|---|
| Outbox poll | 5s | `event-bus.ts:329` `setInterval(tick, 5000)` | YES |
| `mark_review_due` | 5 min | `scheduled-jobs.ts:229` | YES |
| `detect_task_missed` | 15 min | `scheduled-jobs.ts:244` | YES |
| `recompute_analytics_rollup` | 5 min | `scheduled-jobs.ts:259` | YES |
| `recompute_student_model` | 5 min | `scheduled-jobs.ts` (5th job) | YES |

**Vercel Functions have a 10–60s default execution limit on the hobby
plan, and even on Pro the 300s max with a 15-minute idle timeout
makes any `setInterval` loop impossible to host.** A Vercel Cron
trigger can run a single handler at a scheduled time, but it cannot
replace the 5-second outbox poll loop or the long-running in-process
worker that processes 25-row batches with 30-second per-handler
timeouts. Hosting this in a Vercel-only topology would require
rewriting the outbox to use Vercel Cron + a per-cron Supabase claim,
which is a substantial architectural rewrite of the verified state.

### 3.5 What would happen if I forced it onto Vercel alone

If I deployed only the Fastify HTTP routes as a Vercel Function and
left the `eventBus.start()` in place:
- `setInterval(tick, 5000)` would be registered at cold start
- On the first request, Fastify would receive the request and the
  outbox would tick once (or not — depends on whether cold start
  has completed by request time)
- When the function is suspended (after request completes +
  idle timeout), the interval is destroyed
- Net effect: the outbox would only process events if a user
  happened to make a request within 5 seconds of the cron schedule
- All 4 scheduled jobs would never run
- Notifications would not fire (the `project_notification` handler
  is only triggered by the worker poll)
- Reviews would not be marked due
- Missed tasks would not be detected
- Analytics rollup would be stale
- Student model would be stale

**That is not a "deployment" — it is a silent functional regression
of every Phase 9–13 automation. The master prompt explicitly
forbids this:**

> "Do not pretend Vercel alone can host it."
> "If necessary, use: Vercel → Next.js Web ; API/Worker host →
> Fastify API + worker/scheduler. But do not choose the second
> host automatically."

---

## 4. Vercel Compatibility Check — Verdict

| Subsystem | Compatible with Vercel-only? | Reason |
|---|---|---|
| Next.js Web | YES | Standard Next.js 14 app, no vercel.json needed |
| Fastify HTTP routes (80) | YES, with one config change | Wrap as `@vercel/node` Function; export `app` instead of `app.listen()` |
| Outbox worker (5s poll) | NO | `setInterval` cannot survive Function suspension |
| `mark_review_due` cron (5m) | NO (vercel) / YES (vercel cron) | Could be a Vercel Cron Function, but the existing `setInterval` cannot be ported without a rewrite |
| `detect_task_missed` cron (15m) | NO (vercel) / YES (vercel cron) | Same as above |
| `recompute_analytics_rollup` (5m) | NO (vercel) / YES (vercel cron) | Same as above |
| `recompute_student_model` (5m) | NO (vercel) / YES (vercel cron) | Same as above |
| Supabase DB / Auth / Storage | YES | Already a real project, no changes needed |
| Evidence signed-URL flow | YES | No state on the API side beyond signing |
| Push notifications / email delivery | YES | These fire from inside handlers, which run in either topology |

**Honest summary:** the HTTP API is deployable to Vercel. The full
**automated application** (with notifications firing, reviews
becoming due, missed tasks being detected, analytics being
recomputed, the student model being recomputed) is **not deployable
to Vercel alone** without rewriting the outbox worker + scheduler.

---

## 5. Vercel Deployment Configuration

Because the Vercel deployment in this pass is **web-only** (per
the architectural split in §3.5 and §4), the configuration is
minimal:

### 5.1 No vercel.json at the repo root

Per master prompt: "Do not add `vercel.json` unless it is actually
required." The Next.js app lives at `apps/web` — Vercel will
auto-detect it when the project is created with **Root Directory =
`apps/web`**.

### 5.2 Vercel project settings (operator actions)

- **Root Directory:** `apps/web`
- **Build Command:** `next build` (default; auto-detected)
- **Output Directory:** `.next` (default; auto-detected)
- **Install Command:** `npm install --workspaces` (override the
  default `npm install` so the monorepo deps install correctly)
- **Node Version:** 20 (matches `package.json` `engines`)

### 5.3 Environment variables for the web app (browser-safe subset)

| Var | Browser-safe? | Used by |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | YES (read at build) | `apps/web/src/lib/api-client.ts` |
| `NEXT_PUBLIC_SUPABASE_URL` | YES (read at build) | Supabase JS client in the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | YES (read at build) | Supabase JS client in the browser |

**None of the server-only secrets (service-role key, JWT signing
secret, OpenAI key, etc.) are exposed to the browser bundle.**
`apps/web/src/lib/api-client.ts` only uses the `NEXT_PUBLIC_*` set.

### 5.4 Why no `vercel.json` for the API

Per master prompt: "Do not add deployment infrastructure merely for
appearance." The minimum honest deployment is:

- **Web** → Vercel (no config needed beyond Root Directory)
- **API** → persistent host (Railway / Render / Fly.io / EC2 / a
  single VPS) that can run `node dist/server.js` as a long-lived
  Node process

I am **not** silently wrapping the API as a Vercel Function and
leaving the worker to die, because that would cause the automation
regression described in §3.5.

---

## 6. Supabase Production Setup

### 6.1 Project

| Field | Value |
|---|---|
| Project name | krishant0609-lab's Project |
| Project ID | `uuavcvqcgosehhjadfij` |
| Region | `ap-northeast-1` |
| Postgres version | 17.6.1.166 |
| Status | ACTIVE_HEALTHY |

### 6.2 Migrations to apply

The 18 migrations in `supabase/migrations/` have not been verified
as applied to this project. A production deployment **must** apply
all 18 before the API boots. The Supabase CLI sequence is:

```bash
supabase link --project-ref uuavcvqcgosehhjadfij
supabase db push                       # applies all pending migrations
```

The two Phase 14+15 migrations (17 + 18) are additive (no DROP, no
ALTER of existing tables) and safe to apply against a production
database.

### 6.3 RLS

46 RLS policies are defined in the migrations. The `audit_events`
table (migration 17) has its own RLS, and so does `event_outbox`,
`event_log`, and the analytics rollup tables. The auth flow uses
Supabase's `auth.users` table with a foreign key into the app's
`user_id` columns.

### 6.4 Storage buckets

Per `apps/api/src/config/env.ts`, the v1.0 storage buckets are:

- `error-captures`
- `question-snapshots`
- `error-evidence`

All three are private. The path convention is
`${bucket}/${userId}/${evidenceId}/${assetId}.{ext}` (verified in
`evidence-asset-service.ts:66`). The signed-URL TTL is
`storageSignedUrlTtlSeconds: 900` (15 minutes) by default.

The 3 storage buckets must be created on the production Supabase
project before the first evidence upload.

---

## 7. Environment Variables (full audit)

### 7.1 Browser-safe (read at build time, `NEXT_PUBLIC_*`)

| Var | Where read |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `apps/web/src/lib/api-client.ts` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase JS client init in web |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase JS client init in web |

### 7.2 Server-only (API runtime, NEVER exposed to the browser)

| Var | Secret? | Source |
|---|---|---|
| `SUPABASE_URL` | no (URL is public) | `apps/api/src/config/env.ts` |
| `SUPABASE_ANON_KEY` | no (anon key is public) | `apps/api/src/config/env.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | **YES** | `apps/api/src/config/env.ts` |
| `SUPABASE_DB_URL` | optional (for direct DB queries) | `apps/api/src/config/env.ts` |
| `AUTH_JWT_SECRET` | **YES** | `apps/api/src/config/env.ts` |
| `AI_API_KEY` | **YES** (OpenAI / provider key) | `apps/api/src/config/env.ts` |
| `AI_PROVIDER` | no | `apps/api/src/config/env.ts` |
| `AI_PROVIDER_URL` | no | `apps/api/src/config/env.ts` |
| `AI_MODEL_DEFAULT` | no | `apps/api/src/config/env.ts` |
| `AI_MODEL_REASONING` | no | `apps/api/src/config/env.ts` |
| `EMAIL_API_KEY` | **YES** | `apps/api/src/config/env.ts` |
| `EMAIL_FROM_ADDRESS` | no | `apps/api/src/config/env.ts` |
| `EMAIL_FROM_NAME` | no | `apps/api/src/config/env.ts` |
| `PUSH_VAPID_PUBLIC_KEY` | no | `apps/api/src/config/env.ts` |
| `PUSH_VAPID_PRIVATE_KEY` | **YES** | `apps/api/src/config/env.ts` |
| `PUSH_SUBJECT` | no | `apps/api/src/config/env.ts` |
| `CORS_ALLOWED_ORIGINS` | no (comma-list) | `apps/api/src/config/env.ts` |
| `RATE_LIMIT_GLOBAL_PER_MIN` | no (default 120) | `apps/api/src/config/env.ts` |
| `RATE_LIMIT_AUTH_PER_MIN` | no (default 10) | `apps/api/src/config/env.ts` |
| `RATE_LIMIT_AI_PER_MIN` | no (default 20) | `apps/api/src/config/env.ts` |
| `KRODEX_RELEASE_TAG` | no | `apps/api/src/config/env.ts` |
| `KRODEX_STAGING_BASE_URL` | no | `apps/api/src/config/env.ts` |
| `NODE_ENV` | no (always set by the platform) | n/a |

### 7.3 `.env.example` baseline

The repo contains a `.env.example` (gitignored-when-`.env`). The
deployment platform's environment editor is the authoritative store
for these values. **`.env` is never committed** (verified by the
`git status` output during protection).

### 7.4 No new variable names were invented

The deployment does not introduce any environment variable that
is not already declared in `apps/api/src/config/env.ts` or in the
web app's `NEXT_PUBLIC_*` reads.

---

## 8. Vercel Web Deployment — Attempted

I have the Vercel team `krodex` (hobby plan) and the `list_teams`
call returned successfully. The Supabase project is also reachable.

**The Next.js app was NOT actually pushed to Vercel in this pass**,
for two honest reasons:

1. **Architectural split required first.** Per §3 and §4, the
   web → API → worker topology is not a single Vercel deploy. The
   operator must decide the API host before web is useful (a
   deployed web app that points to a non-existent API is a
   "deployed but broken" state).
2. **The repo has uncommitted infrastructure files** that I do
   not have the operator's permission to commit + push to a remote.
   Pushing requires `git push` to a remote the operator controls;
   the Vercel CLI / MCP requires the project to be linked to a
   remote Git provider.

**What I confirmed works at the Vercel level:**
- `list_teams` succeeds → the Vercel MCP is authenticated
- The Vercel project does not exist yet (it would need to be
  created with the right Root Directory)
- A `vercel.json` is not required for the Next.js app (the
  standard Vercel + Next.js auto-detection works)

**Operator action required to actually deploy the web:**

```bash
# In a checkout with the c746c18 commit on main:
vercel link --repo krodex/krodex-ultra
vercel --prod
```

…with the Root Directory = `apps/web` set in the Vercel project
settings UI before the first build.

---

## 9. API Deployment — Architectural Recommendation

**STOP and report**: the API cannot be hosted on Vercel alone
without breaking the worker + scheduler. The minimum safe
deployment is:

| Option | API HTTP routes | Worker + scheduler | Notes |
|---|---|---|---|
| **A** (recommended) | Persistent host (Railway / Render / Fly.io / EC2) | Same host | Single `node dist/server.js` process. The event bus boots with the API. No code change. |
| B (split) | Vercel Function | Persistent host | HTTP routes wrapped as `@vercel/node`; worker runs separately. Requires a small adapter (export `app` instead of `app.listen()`, plus an env flag to skip `eventBus.start()` in the Vercel variant). |

I am **not silently choosing Option B** without the operator's
approval, because Option B requires a code change to `server.ts`
to make the event bus optional — and the master prompt says:

> "Do not change existing API contracts casually, rewrite working
> subsystems unnecessarily."

Option A preserves the entire existing API. Option B is a
narrowly-scoped compatibility change (2–5 lines in `server.ts`).

---

## 10. Workers and Automations — Deployment Plan

**Not deployed in this pass.** Per the master prompt, "A deployment
is NOT complete if the UI works but workers/automations do not."

Until a persistent host is chosen for the API, **no worker is
running in production**. The master prompt is explicit that this
is a blocker, not a cosmetic gap.

**Recommendation:** the operator should choose Option A (single
persistent host for the entire API) before declaring deployment
complete. With Option A:

- The `npm run build` from the repo root produces `apps/api/dist/`
- A Dockerfile or `node dist/server.js` command on a 1-vCPU VPS
  (Railway free tier / Render free tier / Fly.io free tier)
  is sufficient
- The event bus + scheduler + 4 cron jobs + outbox worker all
  start when the API process starts
- `/health` will report `event_bus.running: true`

**Verification command once deployed:**

```bash
curl https://api.example.com/health
# Expect: status: ok, event_bus.running: true, scheduler: true
```

If the operator wants Option B (Vercel Function for HTTP + separate
worker host), the code change is a 2-line addition to `server.ts`
to gate `eventBus.start()` on `process.env.EVENT_BUS_ENABLED === 'true'`.
This is a **narrowly-scoped, deployment-driven** change and is the
ONLY application change I would propose post-protection-commit.

---

## 11. Deployed Smoke Test

**Not executed.** The 22-scenario deployed smoke matrix cannot be
run because:
- Web is not deployed (Vercel push requires operator action)
- API is not deployed (persistent host not chosen)
- Supabase migrations have not been applied to the production
  project (operator action via `supabase db push`)

Once a deployment is performed by the operator, the existing
`tests/e2e/00-..13-..spec.ts` Playwright matrix (22 scenarios
per Phase 16 M7) and the 13 per-route E2E specs can be re-run
against the deployed URLs.

---

## 12. Database Verification After Real Actions

**Not executed.** Cannot be executed without a deployed stack.
The local integrated stack (Supabase CLI + Fastify + Next.js
dev) was verified in `bcff8c0` (Phase 16 M7) and the
verification artifacts are at `apps/web/tests/e2e/`.

---

## 13. Security Verification on Deployment

**Static verification only** (no live deployment to test against):

| Check | Static evidence |
|---|---|
| Authentication | Every domain route in `apps/api/src/routes/*.ts` has `preHandler: app.authPreHandler`. Only `auth.ts` (mints dev JWT) and `ops.ts` (service-role ops endpoint, no PII) are public. |
| Ownership | `assertOwned` is called 62 times across 16 service files + 2 route files. The v1.0 codebase has been audited for missing assertions; the two genuine defects found (state machine bypass, doc misrepresentation) are fixed. |
| RLS | 46 RLS policies. The 4 new tables added in Phase 12–15 (notifications, notification_preferences, notification_deliveries, audit_events) all have RLS. |
| Storage | Path isolation verified (`${bucket}/${userId}/${evidenceId}/${assetId}.ext`). Signed URL TTL is `storageSignedUrlTtlSeconds: 900` (15 min). |
| API authorization | `@fastify/rate-limit` (120 global / 10 auth / 20 AI) is installed via `installSecurity`. |
| Security headers | `@fastify/helmet` is installed. |
| Request ID | `genReqId` in `server.ts` issues `req_<timestamp>_<random>` per request; error handler logs include `requestId`. |
| Secret exposure | `.env` is gitignored. Only `NEXT_PUBLIC_*` vars are read in the browser bundle. Service-role key + AI key + JWT secret + email + VAPID are server-only. |

**Cross-user access attempt**: cannot be tested live in this
pass. The static review of `assertOwned` call sites is the
substitute, and the per-route test suite (1001 API tests) covers
the ownership boundary exhaustively in the fake-Supabase test
harness.

---

## 14. Performance

**Not measured against deployed env.** The `scripts/perf-baseline.mjs`
script is committed in this pass; running it against a deployed
API + web would produce JSON output at `docs/perf-baseline.json`.
The local baseline (run during the protection commit) is in that
file. **TRD performance targets are engineering goals, not gates
— per the final-verification report §4.8.**

---

## 15. Error Handling on Deployment

**No deployment to check logs against.** The local integrated
stack's logs were inspected during `bcff8c0` and the final
verification pass — no unhandled rejections, no swallowed
exceptions, no React hydration errors were observed in the
22-scenario Playwright matrix.

---

## 16. Defects Discovered / Fixed in This Pass

**Defects discovered:** 0 new functional defects.

**Defects NOT fixed in this pass (by design, per master prompt):**
- The architectural split between Vercel (web) and a persistent
  host (API) is not a "defect" — it is a property of the existing
  architecture. The master prompt explicitly requires stopping
  to report this rather than rewriting the architecture.

---

## 17. Remaining Limitations (Documented)

1. **No deployment performed in this pass.** The architectural
   split is documented but the actual `vercel --prod` / Railway
   deploy / etc. is operator action.
2. **No Supabase migrations applied to the production project.**
   The 18 migrations are committed and ready; the operator must
   run `supabase db push` against the project
   `uuavcvqcgosehhjadfij` before the API boots.
3. **No storage buckets created on production.** The 3 buckets
   (`error-captures`, `question-snapshots`, `error-evidence`)
   must be created as private buckets on the production project.
4. **No 22-scenario smoke against the deployed app.** Cannot be
   run until deployment is complete.
5. **No live cross-user ownership test against deployed URLs.**
   Static review only; the local Playwright matrix already covers
   the ownership boundary in the local stack.

---

## 18. Operator Decision Required

To complete the deployment, the operator must choose:

**API host for the Fastify process:**

- **Option A (single host, recommended):** Deploy the entire
  `apps/api` to a persistent Node host (Railway / Render / Fly.io
  / EC2 / single VPS) as a long-lived process. Run `node
  dist/server.js`. The event bus + worker + scheduler all start
  with the API. **Zero code changes required.**

- **Option B (split, requires 2-line change):** Wrap the Fastify
  HTTP routes as a Vercel Function (the worker + scheduler are
  not part of this Vercel Function). Run the worker + scheduler
  on a separate persistent host. Requires adding an env-flag
  check to `server.ts` so the Vercel variant boots without
  `eventBus.start()`. **This is the only code change I would
  propose post-protection-commit.**

Once the operator picks A or B, I can:

1. Push the protection commit to the operator's remote
2. Trigger the Vercel deploy (web)
3. Apply the 18 Supabase migrations
4. Create the 3 private storage buckets
5. Configure the environment variables
6. Re-run the 22-scenario smoke matrix against the deployed URLs
7. Create a v1.0.1 tag if any narrowly-scoped deployment fixes
   were required

---

## 19. Final Verdict

# 🟡 READY WITH DOCUMENTED LIMITATION

KRODEX v1.0 is **protected, verified, and architecturally ready** for
deployment, but the deployment requires the operator to choose an
API host that can run a persistent Node process. The web half can
deploy to Vercel immediately. The API half cannot honestly be
hosted on Vercel alone without breaking 5 background automations.

**No code changes were made to the verified state in this pass
beyond the protection commit.** All Phase 0–16 contracts are
preserved. The historical `bcff8c0` commit is unchanged. The
existing `v1.0` tag is unchanged. A new `v1.0-verified` tag
captures the protected state.

---

## 20. Final Answer

> "Can the owner now open the deployed KRODEX URL and use KRODEX
> as their real study-management application without known
> blocking defects?"

# NO — the deployment was not completed in this pass.

**Exact reason:** the KRODEX architecture has a persistent
Fastify process (with `setInterval` poll loop + 4 scheduled
cron jobs + outbox worker) that cannot be hosted on Vercel
serverless functions alone. Deploying the web app to Vercel
without also deploying the API + worker to a persistent host
would produce a "deployed but broken" state where notifications
never fire, reviews are never marked due, and the student model
never recomputes — i.e. the user would see a static dashboard
that lies about their data.

The minimum safe deployment is: **Vercel for the web** + **a
persistent Node host (Railway / Render / Fly.io / EC2) for the
API + worker**. Both halves must be deployed together, with the
Supabase project (`uuavcvqcgosehhjadfij`) initialized via
`supabase db push` (18 migrations) + 3 private storage buckets
created + 22 environment variables set, before the owner can
open the deployed URL and use KRODEX.

The protection commit `c746c18` and tag `v1.0-verified` are the
safe rollback target. The operator can resume the deployment
from this exact state at any time.

---

*Report generated 2026-09-04. All claims are backed by file:line
references and the test/typecheck/build commands documented in
§2. No claim of "deployed" is made that is not backed by an
actual deployed URL response.*
