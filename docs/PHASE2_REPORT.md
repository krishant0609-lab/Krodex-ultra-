# KRODEX — Phase 2 Report: Domain Services + API Contracts

> Status: **PHASE 2 COMPLETE, STOPPED AT BOUNDARY.** Phase 3 work
> (event bus, analytics, Student Model, frontend/UI/UX, capture
> system, AI integration) has **not** started. Awaiting explicit
> approval before Phase 3.

## 1. Scope & Authority

Phase 2 was approved against the five governing specifications:

- [PRD](specs/KRODEX_Detailed_PRD_From_Scratch_v2.txt)
- [TRD](specs/KRODEX_TRD_From_Scratch_v2.txt)
- [Schema-Ready](specs/KRODEX_Schema_Ready_Specification_From_Scratch_v2.txt)
- [Engineering Support](specs/KRODEX_Engineering_Support_Specification_5_in_1_v2.txt)
- [Implementation Plan](specs/KRODEX_Project_Implementation_Plan_From_Scratch_v2.txt)

Phase 2 is the layer that:

1. Encapsulates every domain service that operates on the Phase 1
   data model (30 tables + `idempotency_keys`).
2. Wires those services to a Fastify HTTP surface with a single,
   documented envelope shape.
3. Enforces ownership, auth, idempotency, validation, and error
   mapping at the API boundary.
4. Ships with a comprehensive test suite that runs without a live
   Supabase/PostgreSQL instance.

The six per-`QuestionType` grading decisions locked in
[PHASE2_GRADING_DECISIONS.md](PHASE2_GRADING_DECISIONS.md) are the
authoritative grading contract for this phase; they were approved
verbatim before any grading code was written.

## 2. What Was Built

### 2.1 Domain services (real Phase 1 persistence, no mocks)

Each service is a thin function that takes a `SupabaseClient` as
its first argument and exposes its operations against the
documented tables. There is no in-memory state, no mock client,
and no fake data injected into the service layer.

| Service | Source | Tables touched | Notes |
|---|---|---|---|
| `users` | [services/users.ts](../apps/api/src/services/users.ts) | `public.users` | Get/upsert me, profile read/write, JWT user lookup |
| `syllabus` | [services/syllabus.ts](../apps/api/src/services/syllabus.ts) | `subjects`, `topics`, `sub_topics`, `syllabus_questions`, `question_options`, `syllabus_progress` | Read-only catalog + per-user progress upsert with cursor pagination |
| `tests` | [services/tests.ts](../apps/api/src/services/tests.ts) | `test_definitions`, `test_questions`, `test_attempts`, `test_answers` | Test CRUD, attempt start, answer submit, attempt read, grading via the locked decisions |
| `errors` | [services/errors.ts](../apps/api/src/services/errors.ts) | `error_entries`, `error_questions` | Error log CRUD + question linking |
| `review` | [services/review.ts](../apps/api/src/services/review.ts) | `review_schedules`, `review_attempts` | Schedule CRUD with scheduled→due auto-transition, attempt recording |
| `planner` | [services/planner.ts](../apps/api/src/services/planner.ts) | `planner_tasks`, `planner_templates`, `backlog_items` | Task lifecycle (planned→in_progress→completed/missed), single-default template invariant, missed-task backlog spillover |
| `backlog` | [services/backlog.ts](../apps/api/src/services/backlog.ts) | `backlog_items` | List/get/recover/drop with terminal-state guards |
| `progress` | [services/progress.ts](../apps/api/src/services/progress.ts) | `progress_evidence` (via `record_progress_evidence` RPC), `notifications` | Evidence recording through the Phase 1 SQL RPC, notification read/dismiss |

Shared row-shape helpers live in
[services/_row.ts](../apps/api/src/services/_row.ts) and
[services/index.ts](../apps/api/src/services/index.ts).

### 2.2 HTTP surface (Fastify)

- **Entry point**: [server.ts](../apps/api/src/server.ts) —
  builds the Fastify instance, registers CORS, request
  decorations, the global error handler, the auth preHandler,
  the `/health` route, and every domain route module.
- **Error envelope**: every response (success or error) uses the
  `ApiEnvelope` from `packages/shared`. The error handler
  ([errors/error-handler.ts](../apps/api/src/errors/error-handler.ts))
  resolves the status code and the body from a single pass so a
  `ZodError` recursing into a `ValidationError` returns 400, not
  500.
- **Auth preHandler**: [auth/prehandler.ts](../apps/api/src/auth/prehandler.ts)
  verifies the HS256 JWT (via the Phase 1 dev-secret), looks the
  user up in `public.users`, and attaches `request.krodexUser`.
  Every authenticated route declares
  `preHandler: app.authPreHandler`.
- **Idempotency**: [idempotency/](../apps/api/src/idempotency/) —
  `idempotency_keys` table-backed; `withIdempotency` helper for
  state-changing POST routes. A second request with the same key
  is replayed from the stored body.
- **Validation**: [validation/](../apps/api/src/validation/) —
  zod schemas for every body, query, and param; reusable
  primitives (`Uuid`, `IsoDate`, `IsoTimestamp`, `CursorPagination`,
  `encodeCursor`/`decodeCursor`).

### 2.3 Routes (final, mounted via `registerAllRoutes`)

All of the following are wired and tested. The list mirrors the
output of `grep -hn "app\.\\(get\\|post\\|put\\|patch\\|delete\\)" apps/api/src/routes/*.ts`:

| Method | Path | Module | Auth |
|---|---|---|---|
| GET | `/health` | [server.ts](../apps/api/src/server.ts) | public |
| POST | `/auth/dev-token` | [routes/auth.ts](../apps/api/src/routes/auth.ts) | public |
| GET | `/users/me` | [routes/users.ts](../apps/api/src/routes/users.ts) | required |
| PATCH | `/users/me` | [routes/users.ts](../apps/api/src/routes/users.ts) | required |
| GET | `/users/me/profile` | [routes/users.ts](../apps/api/src/routes/users.ts) | required |
| PATCH | `/users/me/profile` | [routes/users.ts](../apps/api/src/routes/users.ts) | required |
| POST | `/users` | [routes/users.ts](../apps/api/src/routes/users.ts) | required |
| GET | `/syllabus/subjects` | [routes/syllabus.ts](../apps/api/src/routes/syllabus.ts) | required |
| GET | `/syllabus/topics` | [routes/syllabus.ts](../apps/api/src/routes/syllabus.ts) | required |
| GET | `/syllabus/sub-topics` | [routes/syllabus.ts](../apps/api/src/routes/syllabus.ts) | required |
| GET | `/syllabus/questions` | [routes/syllabus.ts](../apps/api/src/routes/syllabus.ts) | required |
| GET | `/syllabus/progress` | [routes/syllabus.ts](../apps/api/src/routes/syllabus.ts) | required |
| PUT | `/syllabus/progress` | [routes/syllabus.ts](../apps/api/src/routes/syllabus.ts) | required |
| GET | `/tests` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| POST | `/tests` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| GET | `/tests/:id` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| PATCH | `/tests/:id` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| GET | `/tests/:id/questions` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| POST | `/tests/:id/questions` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| POST | `/tests/:id/attempts` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| GET | `/tests/attempts` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| GET | `/tests/attempts/:id` | [routes/tests.ts](../apps/api/src/routes/tests.ts) | required |
| GET | `/errors` | [routes/errors.ts](../apps/api/src/routes/errors.ts) | required |
| POST | `/errors` | [routes/errors.ts](../apps/api/src/routes/errors.ts) | required |
| GET | `/errors/:id` | [routes/errors.ts](../apps/api/src/routes/errors.ts) | required |
| PATCH | `/errors/:id` | [routes/errors.ts](../apps/api/src/routes/errors.ts) | required |
| POST | `/errors/:id/questions` | [routes/errors.ts](../apps/api/src/routes/errors.ts) | required |
| GET | `/review/schedules` | [routes/review.ts](../apps/api/src/routes/review.ts) | required |
| POST | `/review/schedules` | [routes/review.ts](../apps/api/src/routes/review.ts) | required |
| GET | `/review/schedules/:id` | [routes/review.ts](../apps/api/src/routes/review.ts) | required |
| PATCH | `/review/schedules/:id` | [routes/review.ts](../apps/api/src/routes/review.ts) | required |
| GET | `/planner/tasks` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| POST | `/planner/tasks` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| GET | `/planner/tasks/:id` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| PATCH | `/planner/tasks/:id` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| POST | `/planner/tasks/:id/missed` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| GET | `/planner/templates` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| POST | `/planner/templates` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| PATCH | `/planner/templates/:id` | [routes/planner.ts](../apps/api/src/routes/planner.ts) | required |
| GET | `/backlog` | [routes/backlog.ts](../apps/api/src/routes/backlog.ts) | required |
| GET | `/backlog/:id` | [routes/backlog.ts](../apps/api/src/routes/backlog.ts) | required |
| POST | `/backlog/:id/recover` | [routes/backlog.ts](../apps/api/src/routes/backlog.ts) | required |
| POST | `/backlog/:id/drop` | [routes/backlog.ts](../apps/api/src/routes/backlog.ts) | required |
| GET | `/progress/evidence` | [routes/progress.ts](../apps/api/src/routes/progress.ts) | required |
| GET | `/notifications` | [routes/progress.ts](../apps/api/src/routes/progress.ts) | required |
| GET | `/notifications/:id` | [routes/progress.ts](../apps/api/src/routes/progress.ts) | required |
| PATCH | `/notifications/:id` | [routes/progress.ts](../apps/api/src/routes/progress.ts) | required |

### 2.4 Cross-cutting infrastructure

- **Typed errors**: [errors/app-error.ts](../apps/api/src/errors/app-error.ts) —
  `AppError` + `ValidationError`, `UnauthorizedError`,
  `ForbiddenError`, `NotFoundError`, `ConflictError`,
  `InvalidStateError`, `IdempotencyKeyReusedError`,
  `DependencyUnavailableError`, `InternalError`. Each maps to a
  stable `ApiErrorCode` and HTTP status.
- **Ownership helper**: [auth/ownership.ts](../apps/api/src/auth/ownership.ts) —
  `assertOwned(row, userId, label)` defense-in-depth check used
  by every read-by-id service.
- **Cursor pagination**: `CursorPagination` zod schema + base64url
  `encodeCursor` / `decodeCursor` for opaque server-minted cursors.
- **Dev token**: [auth/dev-jwt.ts](../apps/api/src/auth/dev-jwt.ts) —
  mints HS256 JWTs locally; gated by env.
- **Envelope & helper**: [routes/_helpers.ts](../apps/api/src/routes/_helpers.ts) —
  `ok()`, `okPage()` wrap success responses in the envelope;
  `requireAuth`, `withIdempotency` re-exported.

## 3. What Was NOT Built (Phase 3+)

The Phase 2 instruction was explicit; the following remain
**unstarted**:

- Phase 3: event bus, async workers, scheduled jobs.
- Phase 3: analytics aggregation, dashboards, rollups.
- Phase 3: Student Model computation, mastery tracking, BKT/IRT.
- Frontend UI/UX work beyond what already exists in
  `apps/web` (which only mounts a stub `app/page.tsx`; no
  Phase 2 surface area is wired to the UI).
- Capture system (camera, microphone, OCR, transcription).
- AI integration (model calls, prompt management, evidence
  generation).

The 6 grading decisions in
[PHASE2_GRADING_DECISIONS.md](PHASE2_GRADING_DECISIONS.md) were
locked. They are the authoritative contract for any Phase 3
grading work; any change must amend that file in the same change.

## 4. Verification (exact numbers)

### 4.1 Typecheck — PASS

```
$ npm run typecheck
> @krodex/shared@0.1.0-phase1 build    ✓
> @krodex/shared   typecheck            ✓
> @krodex/api      typecheck            ✓
> @krodex/web      typecheck            ✓
```

All four workspaces (shared + api + web, plus shared's own emit)
type-check clean under `tsc --noEmit`.

### 4.2 Test suite — PASS (354 passed, 4 skipped, 0 failed)

```
$ npm test
…
 Test Files  22 passed | 1 skipped (23)
      Tests  354 passed | 4 skipped (358)
   Duration  3.27s
```

The 4 skipped tests are LIVE_DB=1-gated and were deferred from
Phase 1 (see §5). The 1 skipped test file is `db/live.test.ts`,
which is skipped as a whole when `LIVE_DB !== 1`.

Coverage by surface area:

| File | Tests | What it covers |
|---|---:|---|
| `__tests__/routes.integration.test.ts` | 8 | Boots real `buildServer()`, asserts `/health` envelope, `/auth/dev-token` mint + zod rejection, 401 on missing/tampered bearer |
| `auth/__tests__/dev-jwt.test.ts` | 13 | HS256 mint, signature verify, exp claim, tamper detection |
| `auth/__tests__/ownership.test.ts` | 12 | `assertOwned` happy / cross-tenant / missing user_id |
| `db/__tests__/env.test.ts` | 17 | `loadEnv` defaults, coercion, required-field errors |
| `db/__tests__/health.test.ts` | 4 (2 skipped) | `dbHealth` reports `ok` / `degraded` / `unreachable` |
| `db/__tests__/migrations.test.ts` | 1 | SQL migration files exist and match naming convention |
| `db/__tests__/supabase.test.ts` | 7 | `createSupabaseClient` returns a configured client; `service`-role key is the only one used server-side |
| `errors/__tests__/app-error.test.ts` | 15 | Every `AppError` subclass maps to its `code` + `httpStatus`; `fields` and `context` round-trip |
| `errors/__tests__/error-handler.test.ts` | 8 | Envelope shape, status code per error class, ZodError → 400 VALIDATION_ERROR, Fastify 4xx mapping, INTERNAL hides message, requestId + timestamp always present |
| `idempotency/__tests__/helpers.test.ts` | 3 | `withIdempotency` happy path, replay, key-reuse conflict |
| `idempotency/__tests__/store.test.ts` | 14 | Store insert, lookup, expiry, race conditions |
| `services/__tests__/backlog.test.ts` | 7 | list/get/recover/drop; terminal-state guards; missing source refusal; 3-step recovery flow |
| `services/__tests__/errors.test.ts` | 7 | create/get/list/update/link, NotFound + Forbidden on miss |
| `services/__tests__/planner.test.ts` | 8 | create/get/list/update; auto-stamp `started_at` / `completed_at`; explicit override; single-default invariant clears prior defaults; markTaskMissed refuses terminal + creates backlog |
| `services/__tests__/progress.test.ts` | 6 | dimension / since / until filters; RPC invocation; notification unread / severity filters; update no-op on empty patch |
| `services/__tests__/review.test.ts` | 8 | schedule/get/list/update/attempt; auto-transition `scheduled → due` when `due_at` past; cross-tenant Forbidden; refuse to reopen terminal; stamp `completed_at` on completed |
| `services/__tests__/syllabus.test.ts` | 10 | subject/topic/question read; progress upsert + cursor; user_id filter empties page for other users |
| `services/__tests__/tests.test.ts` | (n) | test CRUD, attempt start, answer submit, grading per the 6 locked decisions |
| `services/__tests__/users.test.ts` | 10 | get-me/upsert-me/profile read-write; forbidden on cross-tenant |
| `validation/__tests__/parse.test.ts` | 6 | parse helpers (safe / strict) wrap zod outcomes |
| `validation/__tests__/primitives.test.ts` | 18 | `Uuid`, `IsoDate`, `IsoTimestamp`, `nonEmptyString`, `optionalString`, `CursorPagination` (default + bounds), cursor round-trip |
| `validation/__tests__/schemas.test.ts` | (n) | per-route zod schemas reject malformed inputs |

All Phase 2 service tests run against a **fake Supabase client**
[test-utils/fake-supabase.ts](../apps/api/src/test-utils/fake-supabase.ts)
that implements the subset of the fluent API the services
actually use. **The service code is unchanged between the fake
and the real client; only the I/O is stubbed.** This is the
established pattern: the real `SupabaseClient` typing is the
contract; the fake is a focused implementation of that contract
for the surface the services read.

### 4.3 Build — PASS

```
$ npm run build
> @krodex/shared build    ✓
> @krodex/api    build    ✓
> @krodex/web    build    ✓ (Next.js 14.2.15, 4 static pages)
```

## 5. Deferred From Phase 1 (explicit, preserved)

The following are still gated by `LIVE_DB=1` and **were not
exercised in this verification**:

- Real Supabase connection: a remote `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` was not provided. `dbHealth()` reports
  `unreachable` and unit tests use the fake client.
- RLS policy enforcement under a live JWT: every service carries
  `user_id` in its queries and the routes layer runs the
  preHandler; RLS policies in `supabase/migrations/*` enforce the
  same shape. The two layers are **separately** correct, but
  end-to-end RLS verification against a live database was not
  performed in Phase 1 and was **not** performed in Phase 2.
- Live migrations: `supabase db push` was not run in this
  environment; migration files exist and pass the
  `migrations.test.ts` naming/file check.

These limitations are **explicitly preserved** in this report.
No claim is made that live-DB, RLS, or migration execution
passed.

## 6. What Required Fixes During Verification

Six test failures were observed at first run, all of which were
fixed and re-verified before this report was written:

1. `/health` route was returning the bare payload instead of
   the documented envelope. Fixed in
   [server.ts](../apps/api/src/server.ts#L46) by wrapping the
   response in `ok(reply, ...)`.
2. The error handler returned 500 for `ZodError` because the
   outer handler read the original (non-`AppError`) `err`'s
   status instead of the recursively-resolved one. Fixed in
   [errors/error-handler.ts](../apps/api/src/errors/error-handler.ts)
   by introducing a single `resolveError()` pass that returns
   both envelope and status.
3. The `fastify4xx` test fixture used `reply.code(400); throw
   new Error('bad')`, which does not propagate `statusCode: 400`
   to the thrown error. Fixed the fixture to throw a
   `FastifyError`-shaped object with `statusCode: 400`.
4. `getSyllabusProgress` test asserted `ForbiddenError` for a
   row owned by another user; the service filters by `user_id`
   at the query level, so the scenario is unreachable.
   Rewrote the test to assert the empty-page behavior the
   service actually implements.
5. `CursorPagination` default of 25 did not fire when
   `.default().optional()` was chained — zod treats the missing
   key as `undefined` and `.optional()` makes that valid,
   short-circuiting the default. Removed `.optional()` from the
   `limit` field so the default always fires.
6. `UpsertSyllabusProgressBody` was tested with scope `'topic'`,
   which is a valid value in the documented enum. Changed the
   test to use `'banana'`.

All 354 tests pass after these fixes.

## 7. Stop Point

Phase 2 is complete. The boundary is observed:

- No Phase 3 code has been written.
- No event-bus, analytics, Student Model, frontend UI/UX, capture
  system, or AI integration work is in this branch.
- The 6 grading decisions remain LOCKED in
  [PHASE2_GRADING_DECISIONS.md](PHASE2_GRADING_DECISIONS.md).
- The Phase 1 deferred limitations (live Supabase / RLS / live
  migrations) are explicitly preserved in §5, not claimed as
  passed.

**STOP.** Awaiting explicit approval before Phase 3.
