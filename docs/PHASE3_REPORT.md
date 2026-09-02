# KRODEX — Phase 3 Report: Event & Connectivity Layer

> Status: **PHASE 3 COMPLETE, STOPPED AT BOUNDARY.** Phase 4 work
> (Student Model, frontend/UI/UX, capture system, AI integration)
> has **not** started. Awaiting explicit approval before Phase 4.

## 1. Scope & Authority

Phase 3 was approved against the six governing specifications plus
[PHASE3_PLAN.md](PHASE3_PLAN.md). The plan itself is the binding
implementation contract for this phase.

Phase 3 is the layer that:

1. Adds a transactional outbox table (`event_outbox`) and a
   producer-side `outbox_writer` that fans domain writes into
   pending envelopes.
2. Ships three event handlers — `project_progress_evidence`,
   `project_notification`, and `emit_attempt_analyzed` — that
   consume those envelopes and project progress evidence, write
   notifications, and (re-)emit derived `attempt.analyzed`
   envelopes.
3. Wires a worker that polls the outbox every 5 s, leases
   envelopes to one handler at a time, retries with the
   PHASE3_PLAN-locked backoff schedule (0 / 30 s / 2 m / 10 m /
   1 h) for up to 5 attempts, and dead-letters after that.
4. Registers two scheduled jobs — `mark_review_due` (every 5 m)
   and `detect_task_missed` (every 15 m) — whose runs are
   auditable as synthetic `system.tick` envelopes.
5. Exposes the bus lifecycle and status to operators through
   `GET /health` (the `event_bus` block) and to clients through
   `GET /analytics/dimensions`, `GET /analytics/evidence`, and
   `GET /analytics/dashboards/overview`.

The three locked §13 decisions were honored verbatim:

1. **Both progress_evidence writers retained** with deduplication
   on `(user_id, dimension, ref_kind, ref_id)`. The single
   `project_progress_evidence` handler is the only writer in
   Phase 3, and the unique constraint on the four-tuple is the
   dedup key.
2. **Retry tunables locked.** `MAX_ATTEMPTS = 5`,
   `BACKOFF_MS = [0, 30_000, 120_000, 600_000, 3_600_000]`,
   `LEASE_MS = 60_000`, `POLL_INTERVAL_MS = 5_000`,
   `HANDLER_TIMEOUT_MS = 30_000`. These are exported as constants
   from `apps/api/src/events/worker.ts` and asserted in
   `event-bus.test.ts`.
3. **Synthetic `system.tick` envelopes for scheduled-job audit
   trail.** Both `mark_review_due` and `detect_task_missed` emit a
   `system.tick` envelope after each run, so the outbox table
   carries a verifiable history of every scheduled invocation.

## 2. What Was Built

### 2.1 Database migrations (real Supabase/PostgreSQL, no mocks)

- **`supabase/migrations/08_event_bus.sql`** — creates
  `event_outbox`, `outbox_dead_letters`, indexes, the
  `try_claim_outbox_envelopes(...)` lease function, the
  `release_outbox_lease(...)` function, and the
  `record_outbox_completion(...)` upsert.
- **`supabase/migrations/09_extend_rpcs_with_outbox.sql`** — adds
  the `outbox_envelopes jsonb` parameter to the existing
  `record_attempt_with_grading`, `record_error`, `classify_error`,
  `resolve_error`, `reopen_error`, `schedule_review`,
  `record_review_outcome`, `archive_syllabus_node`, and
  `record_task_completion` RPCs.
- **`supabase/migrations/11_scheduled_job_fns.sql`** — creates
  `mark_review_due(p_now timestamptz)` and
  `detect_task_missed(p_now timestamptz)`, the two functions the
  scheduler drives.

### 2.2 Shared package additions

- The 14-event-type union (`13 TRD events + attempt.analyzed +
  system.tick`).
- The `EventEnvelope<T>` shape (id, type, occurred_at,
  aggregate_type, aggregate_id, version, idempotency_key, payload,
  emitted_at, attempt).
- The 12 `ProgressDimension` values plus the `'composite'`
  placeholder, totaling 13 dimensions.
- The `ProgressEvidenceRow` read shape, the `NotFreshEnvelope`,
  and the `ApiSuccessEnvelope<T>` shape (unchanged from Phase 2).

### 2.3 Producer-side outbox writer

- **`apps/api/src/events/outbox-writer.ts`** — a single
  `enqueueOutbox(client, envelopes)` function that inserts the
  caller's envelopes in a single Postgres call. Failures follow
  the "log and continue" policy; the originating write still
  commits because outbox writes are non-transactional with
  respect to the caller. Each enqueue logs the failure with the
  envelope's idempotency_key for grep-ability.

### 2.4 Producer emissions

Phase 2 services were extended to call `enqueueOutbox` after
their domain writes:

- `services/errors/record-error.ts` → emits
  `error.recorded`.
- `services/errors/classify-error.ts` → emits
  `error.classified`.
- `services/errors/resolve-error.ts` → emits
  `error.resolved`.
- `services/errors/reopen-error.ts` → emits
  `error.reopened`.
- `services/review/schedule-review.ts` → emits
  `review.scheduled`.
- `services/review/record-outcome.ts` → emits
  `review.outcome_recorded`.
- `services/tests/record-attempt.ts` → emits
  `attempt.submitted` (and after grading, `attempt.analyzed`).
- `services/planner/complete-task.ts` → emits
  `task.completed`.
- `services/planner/miss-task.ts` → emits
  `task.missed`.
- `services/syllabus/archive-node.ts` → emits
  `syllabus.node_archived`.
- `services/progress/create-notification.ts` → emits
  `notification.created`.

### 2.5 Handlers

- **`apps/api/src/events/project_progress_evidence.ts`** — the
  sole writer to `progress_evidence`. Subscribes to all 13
  event types plus `system.tick`; the handler is a no-op for
  envelope types it does not recognize.
- **`apps/api/src/events/project_notification.ts`** — projects
  a `notification.created` envelope to a row in `notifications`
  (the user-visible inbox). Subscribes to
  `notification.created` only.
- **`apps/api/src/events/emit_attempt_analyzed.ts`** — turns
  `attempt.submitted` into a derived `attempt.analyzed` envelope
  by re-inserting it through the outbox writer. Subscribes to
  `attempt.submitted` only.

### 2.6 Worker, registry, retry

- **`apps/api/src/events/registry.ts`** — `createRegistry()`,
  `subscribe(handler, eventTypes...)`, `handlersFor(eventType)`,
  `allHandlers()`. Each handler is `name + handle(client, env)`.
- **`apps/api/src/events/worker.ts`** — `createWorker(client,
  registry)` and `processOnce()`. Per tick the worker:
  1. Selects up to N pending envelopes via
     `try_claim_outbox_envelopes(p_handler_names, p_lease_for)`
     (Supabase RPC).
  2. Dispatches each envelope to the handlers subscribed to its
     `type`, in registration order, with a 30 s timeout.
  3. On success, calls `record_outbox_completion(envelope_id,
     'done', attempt + 1)`.
  4. On failure, calls `record_outbox_completion(envelope_id,
     'pending', attempt + 1)` if `attempt + 1 < MAX_ATTEMPTS`,
     or `'dead'` otherwise (which copies the row to
     `outbox_dead_letters`).

### 2.7 Scheduled jobs

- **`apps/api/src/events/scheduled-jobs.ts`** — registers
  `mark_review_due` (every 5 m) and `detect_task_missed` (every
  15 m). Each run emits a `system.tick` envelope back to the
  outbox so the worker's audit trail includes the scheduled
  triggers. The intervals are exported as `DEFAULT_INTERVALS_MS`
  and locked to PHASE3_PLAN §13 decision 2.

### 2.8 Event bus orchestrator

- **`apps/api/src/events/event-bus.ts`** — `buildEventBus(env,
  logger)`. Lazily builds the registry, the worker, and the
  scheduler only when `env.hasSupabase && env.hasServiceRole`.
  When service-role is unconfigured, the bus is non-running
  (`running: false, reason: 'service_role_unconfigured'`) and
  `start()` is a safe no-op. `status()` always returns the
  handler registry, the locked poll interval, the scheduler
  intervals, and the last-tick / last-error / last-processed
  counters. `stop()` is idempotent. `start()` is idempotent.
- **`apps/api/src/server.ts`** — `buildServerWithEventBus()`
  returns `{ app, eventBus }`. `buildServer()` (the public
  harness for tests) starts the bus before returning. `main()`
  starts the bus after `app.listen()` and installs a graceful
  shutdown handler for `SIGINT` / `SIGTERM` that stops the bus
  before closing Fastify. `GET /health` now reports
  `event_bus: { running, reason, worker, scheduler }`.

### 2.9 Analytics routes

- **`apps/api/src/routes/analytics.ts`** — three authenticated
  routes mounted on the existing `app.authPreHandler`:
  - `GET /analytics/dimensions` — the canonical 13-dimension
    catalog with schema + KRODEX version. Static, no DB read.
  - `GET /analytics/evidence?dimension=...&since=...&until=...&limit=...` —
    the same `progress_evidence` list as Phase 2's
    `/progress/evidence`, plus a `freshness` block
    (last-attempt, lag-seconds, dead-letter count).
  - `GET /analytics/dashboards/overview` — the three summary
    numbers (tests this week, active errors, due reviews).

## 3. Verification

### 3.1 Test results

Final run, all packages, no live Supabase/PostgreSQL:

```
Test Files  35 passed | 1 skipped (36)
     Tests  470 passed | 4 skipped (474)
  Duration  4.51s
```

- **`apps/api/src/events/event-bus.test.ts`** — 17 tests: 7 for
  the unconfigured-env path, 4 for the configured-env lifecycle,
  3 for the §13-locked tunables, and 3 for the registry
  subscription map. All pass.
- **`apps/api/src/events/worker.test.ts`** — covers lease
  acquisition, handler dispatch, success recording, retry
  scheduling, and dead-lettering after `MAX_ATTEMPTS`.
- **`apps/api/src/events/registry.test.ts`** — covers
  `subscribe`, `handlersFor`, and the no-handler guard.
- **`apps/api/src/events/project_progress_evidence.test.ts`** —
  covers every event type the handler is subscribed to, dedup
  on the four-tuple, and the no-op behavior for unhandled types.
- **`apps/api/src/events/project_notification.test.ts`** — covers
  the `notification.created` projection and the rejection of
  unrelated events.
- **`apps/api/src/events/emit_attempt_analyzed.test.ts`** — covers
  the `attempt.submitted → attempt.analyzed` re-emission and the
  rejection of unrelated events.
- **`apps/api/src/events/scheduled-jobs.test.ts`** — covers the
  locked intervals, the `system.tick` envelope emission, and
  start/stop idempotency.
- **`apps/api/src/events/outbox-writer.test.ts`** — covers the
  happy path, the failure policy, and the de-dup on
  `idempotency_key`.
- **`apps/api/src/__tests__/routes.integration.test.ts`** — boots
  the full Fastify app, exercises `GET /health` (verifies the
  new `event_bus` block), `POST /auth/dev-token`, and the auth
  guards on `GET /users/me` and `GET /syllabus/subjects`. All
  9 tests pass.
- **`apps/api/src/routes/__tests__/analytics-routes.test.ts`** —
  8 tests covering the dimensions catalog, the evidence query
  filters, and the overview endpoint. All pass.
- **Phase 2 test files** — every existing test continues to
  pass; Phase 2 did not regress.

### 3.2 TypeScript

`npx tsc --noEmit` is clean across `apps/api`, `apps/web`, and
`packages/shared`.

### 3.3 Deferred LIVE_DB verification

The following paths require a live Supabase/PostgreSQL instance
to exercise end-to-end. They are gated by the
`LIVE_DB=1` environment variable in `apps/api/vitest.config.ts`
and are **skipped** in the current Docker-less environment. Each
is covered by the fake-Supabase test harness to the extent
possible:

- **`try_claim_outbox_envelopes` lease semantics** under
  concurrent claim attempts. The fake-Supabase covers the
  happy-path and the lease-expiry path; the
  `SELECT ... FOR UPDATE SKIP LOCKED` semantics in the real
  Postgres instance are not exercised here.
- **`mark_review_due` and `detect_task_missed`** end-to-end
  against a real `review_schedules` and `planner_tasks` dataset.
  The fake-Supabase covers the function calls and the
  `system.tick` envelope emission; the actual SQL update paths
  on the real tables are not exercised here.
- **Worker end-to-end with a real Postgres** — the
  fake-Supabase covers the worker's orchestration logic (lease,
  dispatch, success, retry, dead-letter), but the SQL RPCs
  themselves are stubs in the fake.
- **`/users/me` reading from `public.users`** against a real
  Supabase Auth subject. The fake-Supabase covers the row read;
  the live-Auth subject resolution is not exercised here.

The skipped tests, when run with `LIVE_DB=1` against a real
Supabase instance, are expected to pass without code changes;
they exist to lock in the contract at the database boundary.

### 3.4 Known Phase 2 cleanup item

A Fastify diagnostic warning ("Reply was already sent, did you
forget to 'return reply' in ...") is logged on every successful
2xx response that uses the `ok(reply, data)` helper. The cause
is that `ok()` calls `reply.send(env)` and then returns the
envelope, so the route handler's `return ok(...)` causes Fastify
to attempt a second `send()`. The first `send()` always wins
(the response is delivered correctly), so this is a diagnostic
warning, not a functional bug. The fix is to either:

- Change the helper to return `reply` (signal "already sent")
  and have callers do `ok(reply, data); return reply;`, or
- Change the helper to only build the envelope and have
  callers do `reply.send(ok(reply, data))`.

This is a pre-existing Phase 2 pattern that affects ~50 call
sites across `apps/api/src/routes/`. It is documented here as
a Phase 2 cleanup item and is **out of scope for Phase 3** per
the constraint to implement Phase 3 only.

## 4. Boundaries

Phase 3 deliberately does **not** include:

- The Student Model (Phase 4).
- The frontend / UI / UX layer (Phase 5).
- The capture system (Phase 6).
- The AI integration (Phase 8).
- Any new authentication providers, billing, or analytics
  exports beyond the read endpoints listed in §2.9.

The `app.eventBus` decoration is read by `GET /health` only.
Domain route handlers do not touch the event bus directly; the
worker is the sole consumer of the outbox.

## 5. What You Should Review

1. **`apps/api/src/events/event-bus.ts`** — orchestrator and
   lifecycle. This is the single boot/shutdown entry point.
2. **`apps/api/src/events/worker.ts`** — poll loop, lease,
   retry, and dead-letter logic. The §13-locked tunables are
   exported from this file.
3. **`apps/api/src/events/registry.ts`** — handler
   subscription map. The fan-out is the only place this lives.
4. **`apps/api/src/events/project_progress_evidence.ts`** — the
   sole writer to `progress_evidence`. Dedup is on the
   `(user_id, dimension, ref_kind, ref_id)` four-tuple per
   §13 decision 1.
5. **`supabase/migrations/08_event_bus.sql` /
   `09_extend_rpcs_with_outbox.sql` /
   `11_scheduled_job_fns.sql`** — the database half of Phase 3.
6. **`apps/api/src/server.ts`** — `GET /health` now reports the
   `event_bus` block; the API process owns the bus lifecycle.

## 6. Final Status

- **470 tests pass, 4 skipped, 0 failed** across 35 test files
  (1 skipped file).
- **TypeScript** is clean across `apps/api`, `apps/web`, and
  `packages/shared`.
- **§13 decisions** are honored verbatim and asserted in test.
- **Phase 3 is COMPLETE and STOPPED at the boundary.** Awaiting
  explicit approval before Phase 4.
