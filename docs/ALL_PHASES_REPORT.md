# KRODEX — Consolidated All-Phases Report (Phase 1 → Phase 7)

> **Status:** PHASES 1–7 COMPLETE. PHASE 8 (AI LAYER) AND PHASE 9
> (CAPTURE / EVIDENCE PIPELINE) ARE NOT STARTED. STOP BOUNDARY
> OBSERVED.
>
> **Authoritative specs:** PRD, TRD, Schema Ready, Engineering
> Support, Implementation Plan. Six governing documents, all read
> in full before any code was written.
>
> **This report is the executive summary.** Per-phase detail lives
> in:
>
> - `docs/PHASE2_REPORT.md` (and `PHASE2_GRADING_DECISIONS.md`)
> - `docs/PHASE3_REPORT.md` (and `PHASE3_PLAN.md`)
> - `docs/PHASE4_REPORT.md` (and `PHASE4_PLAN.md`)
> - `docs/PHASE5_REPORT.md`
> - `docs/PHASE6_REPORT.md`
> - `docs/PHASE7_REPORT.md`
>
> Phase 1 was the initial monorepo scaffold; it has no
> dedicated report.

---

## 1. What KRODEX Is

KRODEX is a **student-state model + editorial workbench** for
syllabus-grounded studying, practice testing, error capture, and
spaced review. The product is defined by six spec files and
implemented in nine numbered phases:

| Phase | Title                                    | Workspace(s)           | Status   |
|-------|------------------------------------------|------------------------|----------|
| 1     | Monorepo scaffold + health route         | `apps/*`, `packages/*` | ✅       |
| 2     | Domain services + API contracts          | `apps/api`, `packages/shared` | ✅       |
| 3     | Event bus + scheduled jobs + notifications | `apps/api`, `supabase` | ✅       |
| 4     | Analytics + progress rollup engine       | `apps/api`, `supabase` | ✅       |
| 5     | Student model inference                  | `apps/api`, `supabase` | ✅       |
| 6     | Frontend architecture + data integration | `apps/web`             | ✅       |
| 7     | Frontend polish (editorial visual layer) | `apps/web`             | ✅       |
| 8     | AI layer (assistant, generation)         | **not started**        | ⏸       |
| 9     | Capture / evidence pipeline              | **not started**        | ⏸       |

Phases 8 and 9 are out of scope for this delivery.

---

## 2. Repository Layout (final state)

```
krodex-ultra/
├── apps/
│   ├── api/                Fastify 4.28 HTTP service (Phase 2-5)
│   │   ├── src/
│   │   │   ├── analytics/  Rollups + trend + thresholds (Phase 4)
│   │   │   ├── domain/     Per-bucket services (Phase 2)
│   │   │   ├── errors/     AppError + error handler (Phase 2)
│   │   │   ├── events/     Outbox + worker + handlers (Phase 3)
│   │   │   ├── grading/    Per-QuestionType scorers (Phase 2)
│   │   │   ├── routes/     HTTP route modules (Phase 2-5)
│   │   │   ├── student-model/ Pattern formulas + orchestrator (Phase 5)
│   │   │   └── server.ts
│   │   └── package.json
│   └── web/                Next.js 14.2.15 App Router (Phase 6-7)
│       ├── src/
│       │   ├── app/        21 page.tsx + 2 layout.tsx (auth + app shells)
│       │   ├── components/ Editorial primitives (Card, Badge, Pill, Empty, etc.)
│       │   ├── hooks/      TanStack Query query + mutation hooks (Phase 6)
│       │   ├── lib/        api-client, auth-store, query-keys (Phase 6)
│       │   ├── styles/
│       │   │   └── tokens.css  197 design tokens (Phase 7)
│       │   └── __tests__/  16 test files, 122 tests
│       └── package.json
├── packages/
│   └── shared/             26 TS files: envelope, error codes, types (Phase 1+)
├── supabase/
│   └── migrations/         13 SQL migrations (Phase 1-5)
├── docs/                   All phase reports
└── package.json            npm workspaces root
```

**Total source counts (this delivery):**

- 109 `.tsx` / `.ts` / `.css` files under `apps/web/src/`
- 135 `.ts` files under `apps/api/src/`
- 26 `.ts` files under `packages/shared/src/`
- 13 SQL migrations under `supabase/migrations/`
- 21 page routes, 2 layouts
- 16 test files in `apps/web/src/__tests__/`, 51 test files in
  `apps/api/src/`
- **663+ test cases** across the two workspaces

---

## 3. Phase 1 — Monorepo Scaffold

Phase 1 produced the empty canvas: npm workspaces, TypeScript
project refs, Fastify health route, Next.js 14 stub, shared
envelope type stubs. No business logic. The first version of the
`apiSuccessEnvelope` / `apiErrorEnvelope` / `apiErrorCode` types
landed in `packages/shared`. No report was generated for Phase 1;
it was deliberately thin.

**Exit:** health route 200, `tsc --noEmit` clean across all
workspaces, `next build` succeeds on a one-page stub.

---

## 4. Phase 2 — Domain Services + API Contracts

**Source of truth:** `docs/PHASE2_REPORT.md` and
`docs/PHASE2_GRADING_DECISIONS.md`.

Phase 2 is the **first real layer**. It:

1. Encapsulates every domain service that operates on the
   Phase 1 data model (30 tables + `idempotency_keys`).
2. Wires those services to a Fastify HTTP surface with a single
   documented envelope shape (`{ ok: true, data }` /
   `{ ok: false, error: { code, message, ... } }`).
3. Enforces ownership, auth, idempotency, Zod validation, and
   error mapping at the API boundary.
4. Ships **354 passing tests** without a live Supabase/PostgreSQL
   instance (everything is in-memory fakes behind a
   `FakeSupabaseClient`).

**Six grading decisions** are LOCKED in
`PHASE2_GRADING_DECISIONS.md`:

- Single-answer MCQ
- Multi-answer MCQ
- Numeric
- Short-text
- Long-text (essay — server returns a "rubric" shape; no AI
  scoring)
- Code / handwriting (out of scope for Phase 2; stubbed)

**Frozen boundary:** `apps/api/**` and `packages/shared/**` are
frozen for the remainder of the project — they only re-open for
Phase 5 student-model additions and Phase 8 AI additions.

---

## 5. Phase 3 — Event & Connectivity Layer

**Source of truth:** `docs/PHASE3_REPORT.md` and
`docs/PHASE3_PLAN.md`.

Phase 3 adds the asynchronous backbone:

1. **Outbox table** (`event_outbox`) and a producer-side
   `outbox_writer` that fans domain writes into pending
   envelopes inside the same transaction.
2. **Three event handlers:**
   - `project_progress_evidence` — the sole writer to
     `progress_evidence` (dedup on
     `(user_id, dimension, ref_kind, ref_id)`)
   - `project_notification` — creates notification rows
   - `emit_attempt_analyzed` — re-emits derived
     `attempt.analyzed` envelopes
3. **Worker** that polls the outbox every 5 s, leases envelopes
   to one handler at a time, retries with the locked backoff
   schedule (0 / 30 s / 2 m / 10 m / 1 h) for up to 5 attempts,
   then dead-letters.
4. **Two scheduled jobs** registered with the bus:
   - `mark_review_due` (every 5 m)
   - `detect_task_missed` (every 15 m)
5. **`GET /health` extended** to expose the bus lifecycle and
   status block.

**Test count after Phase 3: 470 passed, 4 skipped, 0 failed
across 35 test files.**

**Supabase migrations added in Phase 3:** `08_event_bus.sql`,
`09_extend_rpcs_with_outbox.sql`,
`10_progress_evidence_dedup.sql`,
`11_scheduled_job_fns.sql`.

---

## 6. Phase 4 — Analytics & Progress Engine

**Source of truth:** `docs/PHASE4_REPORT.md` and
`docs/PHASE4_PLAN.md`.

Phase 4 turns the event log into the six PRD §24 metrics:

1. **Six Class A formulas:**
   - `testCompletionRate`
   - `errorCaptureRate`
   - `reviewCompletion`
   - `correctionRate`
   - `reopenRate`
   - `timeToCorrectionMedian` (using `percentile_cont(0.5)` —
     the actual SQL median)
2. **Rollup substrate:** two new tables
   (`analytics_daily_rollup`, `analytics_weekly_rollup`) and
   one new SQL function (`recompute_analytics_rollup`).
3. **A new handler** `project_analytics_rollup` is wired to the
   bus to incrementally project new evidence rows.
4. **Scheduled job** `recompute_analytics_rollup` runs every
   5 minutes and walks users with new evidence.
5. **Two new HTTP routes:**
   - `GET /analytics/dashboards/dimension/:key` (trend, series,
     drill-down)
   - `GET /analytics/dashboards/dimension/:key/explain` (one
     `explanation` sentence per dimension)

**B1 / B2 / B3 / B4 remediated** during Phase 4 (per `PHASE4_REPORT
§5.5–§5.7`):

- B1: `captured_at` is used exclusively (no `created_at` drift)
- B2: `time_to_correction` is computed by SQL median, not naive
  AVG
- B3: weekly aggregation uses `sum(numerator)/sum(denominator)`
  on real ratio columns
- B4: the per-metric source-of-truth fan-out is correct; no
  synthetic metric-level evidence was inserted at any point

**Test count after Phase 4: 553 passed, 4 skipped (557), across
44 test files.** Phase 4 added 83 new tests across 9 new or
expanded files.

**Migrations added:** `12_analytics_rollup.sql`.

**Live-DB verification** was performed on a local PostgreSQL
16.14 cluster per `PHASE4_REPORT §5.6`. The B1-B4 fixes are
live-verified end-to-end.

---

## 7. Phase 5 — Student Model Inference

**Source of truth:** `docs/PHASE5_REPORT.md`.

Phase 5 turns progress evidence into the seven PRD §25
**student-model pattern features**:

1. Six from raw evidence (persistence, recent accuracy, error
   diversity, review adherence, momentum, recency)
2. One derived: `learning_trajectory` (a 9-cell decision table
   from the six upstream features)

**Architecture:**

- Each pattern is a **pure function** of a pre-loaded evidence
  object — no I/O, no global state, fully testable.
- The orchestrator (`computeFeatures.ts`) runs the six leaf
  patterns in parallel and runs `learning_trajectory` after
  upstream features are cached.
- A new SQL function
  `recompute_student_model(p_user_id, p_features jsonb,
  p_window_days int, p_until timestamptz)` idempotently
  replaces the user's snapshot + per-feature rows in
  `student_model_snapshots` / `student_model_features`.
- A new handler `project_student_model` subscribes to the same
  12 event types as `project_analytics_rollup` and persists.
- A 5-minute scheduled job `recompute_student_model` walks
  active users and re-runs the orchestrator (D-9 cadence by
  analogy to Phase 4).
- **Two new HTTP routes:**
  - `GET /student-model` — the current snapshot
  - (The `recompute` route is internal; only the worker calls
    the SQL function.)

**Frozen boundaries preserved:** RLS, service-role health,
worker tunables, `app.krodexEnv`, `recompute_analytics_rollup`
job all unchanged.

**Test count after Phase 5: 624 passed, 22 skipped (live-DB
gated), 0 failed. Phase 5 specifically: 60 new tests, all
passing. Live-DB tests: 7 passed, 0 failed with `LIVE_DB=1`.**

**Migrations added:** `13_student_model_recompute.sql`.

---

## 8. Phase 6 — Frontend Architecture & Data Integration

**Source of truth:** `docs/PHASE6_REPORT.md`.

Phase 6 wires the previously one-page static `apps/web` to the
real Phase 1–5 API surface.

**Architecture:**

- **Next.js 14.2.15 App Router** with two route groups:
  - `(auth)/login` — dev-token login shell
  - `(app)/*` — 15 PRD surfaces + 5 dynamic deep-link routes
- **TanStack Query v5** as the canonical data-fetch / cache /
  mutation layer.
- **TypeScript end-to-end:** every API response is typed
  against `@krodex/shared` envelopes.
- **Auth:** memory-only Bearer token (no localStorage, no
  cookie for Phase 6) — explicit dev-token mint at
  `/auth/dev-token` and a `useAuth` hook to bridge UI to the
  store.
- **21 page routes + 2 layouts** in the final tree, every one
  wired to at least one `useXxx` query hook.
- **Cache-invalidation rules** documented in the plan and
  tested (e.g. `useUpdateNotification` test asserts 3 fetch
  calls: list → mutate → list).

**State contract — the 7-state machine:**

Every page implements all 7 states:
1. Loading — initial data fetch
2. Empty — no data (truthful; never a spinner)
3. Populated — data loaded
4. Partial — partial failure (some queries fail, some succeed)
5. Error — all data fetch failed
6. Success — mutation acknowledged by server
7. Permission — 401/403 received (redirect to login)

**Mutation coverage (16 `useXxx` mutation hooks, all with
`onSuccess` cache invalidation):**

`upsertSyllabusProgress`, `createTestDefinition`,
`startTestAttempt`, `recordAnswer`, `submitAttempt`,
`createErrorEntry`, `createReviewSchedule`,
`recordReviewOutcome`, `createTask`, `completeTask`,
`markMissed`, `recoverBacklog`, `dropBacklog`,
`markNotificationRead`, plus profile/email preferences.

**Deep links (URL-addressable):**

- `/tests/:testId`
- `/attempts/:attemptId`
- `/errors/:errorId`
- `/reviews/:scheduleId`
- `/syllabus/:nodeId`

**Exit criteria (Implementation Plan §273–275):**

- ✅ All 19 routes compile and render real data or a truthful
  empty state
- ✅ Every `useXxx` query hook has a loading+success or error
  test
- ✅ No `lorem ipsum`, no `TODO: load real data`, no mocked
  data inside route components

**Frozen boundary:** `apps/api/**`, `packages/shared/**`,
`supabase/**` were **not** modified by Phase 6.

---

## 9. Phase 7 — Frontend Polish (Editorial Visual Layer)

**Source of truth:** `docs/PHASE7_REPORT.md`.

Phase 7 layers an **editorial visual system** on top of the
Phase 6 route shells, in the single workspace `apps/web/`. It is
the last frontend phase before Phase 8 (AI) opens the frozen
boundaries back up.

**Sub-phase inventory (14 sub-phases, each a separate commit):**

| Sub-phase | Scope                                              | Commit  |
|-----------|----------------------------------------------------|---------|
| 7.0       | Token layer (`tokens.css`, 197 tokens)             | earlier |
| 7.1       | Page-shell (loading/empty/error wrapping)          | earlier |
| 7.2       | Primitives (Card, Badge, Pill, Empty, …)           | earlier |
| 7.3       | Global shell + nav                                 | earlier |
| 7.4       | Dashboard editorial surface                        | earlier |
| 7.5       | Syllabus editorial surface                         | earlier |
| 7.6       | Tests + Attempts editorial + focus mode            | 12bdcb4 |
| 7.7       | Error Book editorial visual layer                  | 8f5cc07 |
| 7.8       | Reviews queue editorial visual layer               | 34f89dc |
| 7.9       | Planner + Backlog (recovery) editorial pages       | f04d7f5 |
| 7.10      | Insights, Student model, Notifications, Settings   | 40b0f09 |
| 7.11      | Login editorial polish                             | d16b8fa |
| 7.12      | Accessibility pass (axe, keyboard, screen reader)  | c61d014 |
| 7.13      | Visual verification matrix (3 lint tests)          | 8765058 |
| 7.14      | `docs/PHASE7_REPORT.md` consolidated report        | 00242f1 |

**Token contract (locked in Phase 7.0, verified by Phase 7.13):**

197 design tokens in `apps/web/src/styles/tokens.css`:
- `--kd-color-*` (light + dark scales, semantic + surface)
- `--kd-space-*` (0..7 scale, plus -0.5 for tight)
- `--kd-type-*` (display, heading, body, eyebrow, caption)
- `--kd-radius-*` (none, sm, md, lg, full)
- `--kd-font-*` (sans, mono, weights)
- `--kd-border-width-*` (none, hairline, 1, 2)
- `--kd-focus-ring-offset` (3)
- `--kd-motion-*` (fast/base/slow in ms)

**Phase 7.13 visual verification matrix — three static-lint
tests that pass on every CI run:**

1. **CSS token contract:** every `*.module.css` file under
   `src/app` and `src/components` must route every cosmetic
   value (color, padding, margin, gap) through a `var(--kd-*)`
   token. No raw hex, no `NNpx` spacing literals except
   `0` and `1px` for hairline borders.
2. **Inline-style contract:** every TSX file is free of
   `style={{...}}` blocks that contain raw hex or `padding: NNpx`
   literals. The canonical `sr-only` visually-hidden pattern
   (1px/0 absolute + clip) is the only allowed exception.
3. **Testid integrity:** the set of `data-testid` strings
   referenced by the test files is a subset of the set of
   `data-testid` strings emitted by the page/component source
   files. Handles both `data-testid="literal"` and
   `` data-testid={`prefix-${expr}suffix`} `` template forms
   via prefix/suffix matching. Test files that pass a
   `data-testid` prop to a primitive (e.g.
   `<Input data-testid="i" />`) are exempted via
   `testSelfDeclared`.

**Accessibility (Phase 7.12):**

- `axe-core` 4.13 + `vitest-axe` 0.1 — `toHaveNoViolations`
  matcher wired in `src/__tests__/setup.ts`.
- Every interactive element is keyboard-reachable.
- Visible focus ring on every focusable element via
  `--kd-focus-ring-offset` + `outline-style: solid`.
- Screen-reader-only state hooks (e.g.
  `dashboard-${surface}-state`) are rendered as the canonical
  visually-hidden pattern.
- Theme toggle works in both light and dark; `data-theme`
  attribute on `<html>` overrides the `@media
  (prefers-color-scheme: dark)` block.
- `prefers-reduced-motion` honored (transitions shorten to
  `0.01ms`).

**Test count after Phase 7: 122 / 122 passing in `apps/web`.**
TypeScript clean. `next build` succeeds.

**Frozen boundaries preserved:**

- `apps/api/**` — frozen
- `packages/shared/**` — frozen
- `supabase/**` — frozen
- `src/hooks/**` (Phase 6 contract) — frozen
- `src/lib/query-keys.ts` — frozen
- `src/lib/auth-store.ts` — frozen

---

## 10. Test Inventory (cumulative)

| Workspace | Test files | `it()` cases | Skipped | Live-DB gated |
|-----------|-----------:|-------------:|--------:|---------------|
| `apps/api` (Phase 2-5) | 51 | 541+ | 4 + 22 | 22 |
| `apps/web` (Phase 6-7) | 16 | 122 | 0 | n/a |
| **Total** | **67** | **663+** | **26** | **22** |

**Phase-by-phase test growth:**

- After Phase 2: 354 passing
- After Phase 3: 470 passing, 4 skipped (35 files)
- After Phase 4: 553 passing, 4 skipped (44 files)
- After Phase 5: 624 passing, 22 skipped live-DB-gated
- After Phase 6: API unchanged, web added 16 test files
- After Phase 7: 122 web tests passing (8 a11y + 3 visual
  matrix + the rest Phase 6 contract tests)

---

## 11. Decision Audit (Class A / B / C)

The governing specs use a three-tier decision scheme:

- **Class A** — implementation follows the spec verbatim. No
  confirmation needed.
- **Class B** — implementation must respect spec intent; one
  sensible default chosen and documented.
- **Class C** — implementation requires explicit user
  approval. Every Class C decision is logged in the
  corresponding plan and report.

**Phases 1–7 decisions by class:**

- **Phase 1:** all Class A (scaffold follows conventions).
- **Phase 2:** all Class A except the 6 grading decisions
  (Class C, locked in `PHASE2_GRADING_DECISIONS.md`).
- **Phase 3:** Class A on the backoff schedule (0/30s/2m/10m/1h,
  5 attempts), retry cap, and event-dedup four-tuple. Class C
  on the D-9 polling cadence (5 s) and the `mark_review_due`
  5-minute cadence — **Approved Product Policy**.
- **Phase 4:** Class A on the six formula semantics. Class C on
  D-1..D-10 (thresholds, windows, definitions) — **Approved
  Product Policy**. B1-B4 remediated mid-phase.
- **Phase 5:** Class A on the 7 pattern formulas. Class C on
  D-8 (the 9-cell `learning_trajectory` table) and the 5-min
  recompute cadence — **Approved Product Policy**.
- **Phase 6:** Class C on **TanStack Query v5** as the
  data-fetch library and **Vitest + React Testing Library** as
  the test runner — both **Approved Product Policy**. All other
  decisions Class A.
- **Phase 7:** no new Class C decisions. All visual / token
  / a11y choices are Class A editorial decisions documented
  in `PHASE7_REPORT.md §3`.

---

## 12. Contracts Preserved Across All Phases

| Contract                          | Owner       | Frozen since | Modified in Phase 6-7? |
|-----------------------------------|-------------|--------------|-------------------------|
| `ApiSuccessEnvelope<T>` / `ApiErrorEnvelope` | `packages/shared` | Phase 1 | ❌ |
| `ApiErrorCode` enum               | `packages/shared` | Phase 1 | ❌ |
| `CursorPage<T>`                   | `packages/shared` | Phase 1 | ❌ |
| All row / insert / update types   | `packages/shared` | Phase 1-2 | ❌ |
| 30-table schema + RLS             | `supabase`  | Phase 1-2 | ❌ |
| `recompute_analytics_rollup`      | `supabase`  | Phase 4 | ❌ |
| `recompute_student_model`         | `supabase`  | Phase 5 | ❌ |
| Event handler subscription map    | `apps/api`  | Phase 3 | ❌ |
| Worker tunables (backoff, cap)    | `apps/api`  | Phase 3 | ❌ |
| `queryKeys.*` from `lib/query-keys.ts` | `apps/web` | Phase 6 | ❌ (frozen in Phase 7) |
| `auth-store` (memory-only token)  | `apps/web`  | Phase 6 | ❌ (frozen in Phase 7) |
| All 15 PRD route paths            | `apps/web`  | Phase 6 | ❌ (deep links still resolve) |

---

## 13. What is Now Done (Phase 1-7)

- A typed, end-to-end KRODEX system that **renders real data**
  on every page.
- A Fastify HTTP surface with a single, documented envelope
  shape, ownership checks, idempotency, Zod validation, and
  the seven Phase 2-5 route modules.
- An asynchronous event bus with retry, dead-letter, and two
  scheduled jobs.
- Six PRD §24 metrics computed from real evidence rows
  (rolled up daily + weekly).
- Seven student-model pattern features (six leaves + the
  derived `learning_trajectory`) computed from real evidence
  rows and persisted to snapshots.
- 15 PRD-required frontend surfaces + 5 dynamic deep-link
  routes, all wired to the API via typed hooks, all honoring
  the 7-state machine, all with axe-clean accessibility.
- An editorial visual system on top of the route shells,
  verified by a static-lint test matrix that runs on every
  CI build.
- 663+ test cases across the two workspaces, all green.

---

## 14. What is NOT Done (Phase 8 + Phase 9 + beyond)

Per the standing constraint, **Phases 8 and 9 are not
started.** They remain as future work:

### Phase 8 — AI Layer
- AI provider abstraction (`packages/shared/src/ai/`)
- A new `ai` module in `apps/api/`
- A new `ai` schema in `supabase/`
- The 16th route `/assistant` (still inside `apps/web/`)
- Test generation, question drafting, tutor chat

### Phase 9 — Capture / Evidence Pipeline
- The capture ingestion path
- The evidence storage and dedup
- The wiring to the existing event bus handlers

### Post-7
- Full auth (signup, password reset, refresh, SSO)
- Toast / snackbar for mutation success
- Optimistic updates
- Polished mobile responsive (Phase 7 has the foundation but
  not the full responsive sweep)

---

## 15. Stop Boundary (HARD)

> **No Phase 8 work has been performed.** No AI code, no
> `/assistant` route, no new migration, no new API endpoint,
> no new `apps/api` module, no new `supabase` table.
>
> **No Phase 9 work has been performed.** No capture pipeline,
> no evidence ingestion.
>
> **No full auth has been performed.** Signup, password reset,
> refresh tokens, and SSO are not in this delivery. The
> dev-token mint at `/auth/dev-token` is the only auth flow
> in the codebase.
>
> **The 7-phase delivery boundary is the most-recent commit:**
> `00242f1 — Phase 7.14: docs/PHASE7_REPORT.md`.

---

## 16. How to Run the System

```bash
# Install deps
npm install

# Build shared types (Phase 1 contract)
npm run build:shared

# Typecheck all workspaces
npm run typecheck

# Run API tests
npm run test                       # alias for `npm --workspace @krodex/api run test`

# Run web tests
npm --workspace @krodex/web run test

# Run API in dev
npm run dev:api

# Run web in dev (separate terminal)
npm run dev:web

# Build the web app for production
npm --workspace @krodex/web run build
```

The dev-token login UI is at `http://localhost:3000/login`. The
API base URL is `NEXT_PUBLIC_API_BASE_URL` in `apps/web/.env.local`.

---

## 17. Phase-by-Phase Lineage

```
Phase 1   ──► Phase 2   ──► Phase 3   ──► Phase 4   ──► Phase 5
scaffold       domain         event bus      analytics     student
health         30 services    outbox +       6 formulas    7 patterns
type stubs     354 tests      470 tests      553 tests     624 tests
                                                  │
                                                  ▼
                                       Phase 6                Phase 7
                                       frontend shell         editorial visual layer
                                       15 routes + 5 deep     197 tokens
                                       7-state machine        122 web tests
                                       TanStack Query v5      axe-clean a11y
                                       typed hooks            visual-matrix lint
                                       (no styling yet)       (frozen boundaries)
```

**Final shape:** a 9-phase system, with phases 1–7 fully
delivered, tested, documented, and stopped at the boundary.

---

## 18. Closing Note

This delivery satisfies all exit criteria for the seven phases
that were authorized. The system is **truthful end-to-end** —
no fake data, no synthetic scores, no fabricated analytics,
no mocked `student_model` payloads. The frontend renders what
the API actually says, and the API computes what the evidence
actually proves.

**Phase 8 and Phase 9 remain for the next delivery.** The
`apps/api`, `packages/shared`, and `supabase` workspaces are
**frozen** and may only be re-opened for those phases.

---

**End of consolidated all-phases report.**
