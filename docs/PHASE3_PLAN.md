# KRODEX — Phase 3 Implementation Plan
## Event & Connectivity Layer

**Status:** Planning only — NOT YET APPROVED. Do not start implementation.
**Authority:** `docs/specs/KRODEX_Project_Implementation_Plan_From_Scratch_v2.txt` (PIP), §"Phase 3 — Event & Connectivity Layer"; `KRODEX_TRD_From_Scratch_v2.txt` §8 (Domain Event Architecture) and §7 (Outbox); `KRODEX_Detailed_PRD_From_Scratch_v2.txt` §25 (Notifications — Event Inbox) and §"Primary event matrix".
**Phase boundary:** G3 in the gate plan. Phase 4 (Analytics) and Phase 5 (Student Model) are explicitly out of scope and follow this phase.

---

## 1. Scope of Phase 3

Per the PIP §Phase 3 the deliverables are:

1. **Event catalog** — a stable set of semantic event types (the TRD's 13 core events plus any auxiliary types Phase 3 needs) and a typed envelope shape.
2. **Transactional outbox** — domain mutations and their events are committed in the same transaction. A worker processes the outbox after commit.
3. **Idempotent consumers** — every handler is keyed by an idempotency key; duplicate delivery is a no-op.
4. **Reconstructable projections** — `progress_evidence` and `notifications` are rebuilt from event history plus source tables. They are never the only source of truth.
5. **Retry / dead-letter visibility** — failed handlers retry with exponential backoff; after N attempts the event is moved to a dead-letter view, never silently dropped.
6. **Hand-off contracts for Phase 4/5** — the schema and the read models emitted by Phase 3 are the inputs that Phase 4 (analytics rollups) and Phase 5 (Student Model) consume.

### In scope
- New `event_outbox` table written from inside the existing `submit_test_attempt`, `schedule_review_for_error`, and `record_progress_evidence` RPCs, plus from selected service-layer mutations that today bypass RPCs (error bank status transitions, planner task lifecycle, backlog recovery).
- New `event_log` table that records consumer outcomes (idempotency, attempts, last error, dead-letter state).
- A single in-process worker (one Node entrypoint under `apps/api`) that polls `event_outbox`, dispatches to registered handlers, writes `event_log` rows, and runs exponential backoff. **No distributed queue.** This keeps the dependency surface small; the schema is queue-agnostic so Phase 16 can swap in pg-boss / SQS / Cloud Tasks without changing producers.
- A scheduled job runner (cron-style, also in-process) that triggers time-based projections: "review state due" promotions, "planner task → missed" detection, "notification freshness".
- New analytics-projection endpoints and service modules that **read** `progress_evidence` and `notifications` to expose the 8 dimensions the PIP §Phase 4 references (the dimension definitions live in Phase 4, but the projection read model and the 8-dim list surface here so Phase 4 can build on stable contracts).
- New `notifications` projections driven by domain events with deterministic dedup keys (per TRD §20.1: `account + event type + source aggregate + semantic occurrence ID`).
- RLS policies for `event_outbox` and `event_log` (service-role only — the user never reads them; that is the platform's plumbing).
- Migration `08_event_bus.sql`.
- Phase 2 idempotency-key reuse: outbox events carry an `idempotency_key` so retries from the HTTP layer and from the worker don't double-emit.

### Out of scope (explicit)
- **Phase 4 (Analytics / Progress Engine).** No metric formulas are computed in Phase 3. We only expose the `progress_evidence` read model and the 8-dim enum. Rollups, percentile series, denormalized aggregates — Phase 4.
- **Phase 5 (Student Model).** No BKT/IRT calculations, no feature extraction, no confidence scoring in Phase 3. `student_model_snapshots` and `student_model_features` tables are **not** written by Phase 3.
- **Phase 7 (UI).** No React components. The web app's notification inbox UI is built in Phase 6/7.
- **Phase 8 (AI Layer).** No provider abstraction, no classification suggestions. AI is upstream of Phase 3's classification events but never downstream.
- **Phase 9 (Capture / Evidence Pipeline).** No image snapshot generation, no private-asset uploads. Error events flow without attachments.
- **External queue / pub-sub systems.** No Redis Streams, no SQS, no Kafka. The outbox + worker pattern is the only delivery mechanism.
- **Cross-instance worker leader election.** Phase 3 runs one worker process per API instance. Multi-instance leader election is Phase 15 (Performance) territory.
- **Notification delivery channels (email, push).** Only `in_app` channel is implemented; `notification_deliveries` for `email`/`push` stay at the row level with `state='cancelled'` until Phase 12 builds the channels.
- **A full outbox-replay CLI.** A dry-run admin endpoint IS provided (for tests and for Phase 16 rollback) but it is not a polished tool.
- **Reading the governing spec files in a way that invents rules.** Where the spec is silent (e.g. exact retry schedule, exact number of dedup windows), this plan picks a defensible default and explicitly marks it **§[DEFAULT]** so the user can lock or change it before approval.

---

## 2. Upstream Contract (what Phase 2 hands Phase 3)

Phase 2 already has:

- `users`, `subjects`, `topics`, `sub_topics`, `questions`, `question_options`, `test_definitions`, `test_attempts`, `test_answers`, `test_questions`, `syllabus_progress`, `error_entries`, `error_question_links`, `review_schedules`, `review_attempts`, `planner_tasks`, `planner_templates`, `backlog_items`, `backlog_recoveries`, `progress_evidence`, `notifications`, `notification_deliveries`, `idempotency_keys`, `captured_questions`, `ai_conversations`, `ai_messages`.
- Postgres RPCs: `submit_test_attempt`, `schedule_review_for_error`, `record_progress_evidence`.
- RLS policies on all user-facing tables.
- `auth_uid()` helper, `set_updated_at` and `prevent_user_id_mutation` triggers, `gen_random_uuid` default.
- A consistent Fastify envelope (`{success, data|error, requestId, timestamp}`), 12-error-code taxonomy, cursor pagination, and the zod validation layer.

Phase 2 writes `progress_evidence` and `notifications` only as a side effect of the three RPCs plus the `progress.recordProgressEvidence` service call. Today there is **no event log** and no worker; mutations and analytics re-computation are coupled. Phase 3 decouples them via the outbox.

---

## 3. Migrations (one file, applied atomically with the rest of the schema)

### 3.1 New file: `supabase/migrations/20260901164346_08_event_bus.sql`

The whole event bus fits in one migration because it is one logical concern: a table (outbox), a table (log), an index pair, a security definer function for the worker's atomic claim, and a view for the dead-letter queue. Splitting into multiple files would force ordering that does not exist here.

```sql
-- 08_event_bus.sql  (Phase 3 — Event & Connectivity Layer)
-- Append-only outbox + consumer log + dead-letter view + worker claim function.
-- All three live behind service_role RLS — the user never reads them.

set search_path = public, extensions;

-- 3.1.1  Outbox. Source-of-truth for "this domain mutation emitted
-- these events". One row per (transaction, event). Multiple events
-- per source mutation => multiple rows. aggregate_version carries
-- optimistic-concurrency for the consumer.
create table if not exists public.event_outbox (
  id                uuid primary key default extensions.gen_random_uuid(),
  occurred_at       timestamptz not null default now(),
  event_id          text not null unique,             -- stable hash: hash(event_type, aggregate_type, aggregate_id, version, idempotency_key)
  event_type        text not null,                    -- e.g. 'attempt.submitted'
  schema_version    int  not null default 1,
  user_id           uuid not null references public.users(id) on delete cascade,
  actor_id          uuid references public.users(id),
  aggregate_type    text not null,                    -- e.g. 'test_attempt'
  aggregate_id      text not null,                    -- uuid as text (for non-attempt aggregates that aren't uuids in future)
  aggregate_version int  not null default 1,
  payload           jsonb not null,
  idempotency_key   text not null,                    -- typically the request's Idempotency-Key, or hash of (event_type, source, ref_id)
  created_at        timestamptz not null default now()
);
create index if not exists idx_event_outbox_user_occurred
  on public.event_outbox(user_id, occurred_at desc);
create index if not exists idx_event_outbox_aggregate
  on public.event_outbox(aggregate_type, aggregate_id);
create unique index if not exists uq_event_outbox_idem
  on public.event_outbox(user_id, event_type, idempotency_key);

-- 3.1.2  Log. One row per (event, handler) attempt. Authoritative
-- record of "this handler has processed this event with this outcome".
-- Idempotency: (event_id, handler_name) is unique => the second insert
-- hits a constraint violation, the worker treats it as a successful
-- skip and moves on.
create table if not exists public.event_log (
  id              uuid primary key default extensions.gen_random_uuid(),
  event_id        text not null references public.event_outbox(event_id) on delete cascade,
  handler_name    text not null,                -- e.g. 'project_progress_evidence', 'project_notification'
  status          text not null check (status in ('succeeded','failed','dead_letter')),
  attempt_count   int  not null default 1,
  last_error      text,
  first_attempted_at timestamptz not null default now(),
  last_attempted_at  timestamptz not null default now(),
  completed_at    timestamptz,
  unique (event_id, handler_name)
);
create index if not exists idx_event_log_handler_status
  on public.event_log(handler_name, status, last_attempted_at);
create index if not exists idx_event_log_event
  on public.event_log(event_id);

-- 3.1.3  Dead-letter view. A failed handler with attempt_count >=
-- MAX_ATTEMPTS moves to dead_letter. The view joins outbox so
-- operators see full context.
create or replace view public.event_dead_letter as
  select
    el.event_id,
    el.handler_name,
    el.attempt_count,
    el.last_error,
    el.last_attempted_at,
    eo.event_type,
    eo.user_id,
    eo.aggregate_type,
    eo.aggregate_id,
    eo.payload
  from public.event_log el
  join public.event_outbox eo on eo.event_id = el.event_id
 where el.status = 'dead_letter';

-- 3.1.4  Worker claim function. SECURITY DEFINER + service_role
-- gating. Atomically picks up to N events that have no
-- (succeeded) log row yet for the given handler. This is the
-- single concurrency primitive the worker needs. Without it two
-- workers could grab the same event.
create or replace function public.claim_pending_events(
  p_handler   text,
  p_batch     int  default 25,
  p_lease_for interval default interval '60 seconds'
) returns setof public.event_outbox
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  with claimed as (
    select eo.event_id
      from public.event_outbox eo
     where not exists (
             select 1 from public.event_log el
              where el.event_id = eo.event_id
                and el.handler_name = p_handler
                and el.status = 'succeeded'
           )
       and not exists (
             select 1 from public.event_log el
              where el.event_id = eo.event_id
                and el.handler_name = p_handler
                and el.status = 'dead_letter'
           )
     order by eo.occurred_at asc
     limit p_batch
     for update skip locked
  )
  select eo.* from public.event_outbox eo join claimed using (event_id);
end;
$$;

comment on function public.claim_pending_events(text, int, interval) is
  'Service-role claim of up to p_batch events with no succeeded log row for the handler. Uses FOR UPDATE SKIP LOCKED so concurrent workers do not double-deliver. Dead-lettered events are skipped. Caller MUST write an event_log row (succeeded or failed) within p_lease_for; otherwise the next poll re-claims them.';

-- 3.1.5  RLS. Both tables are service_role only. Users have
-- exactly zero read/write access — the API exposes only the
-- derived projections (notifications, progress evidence) which
-- the worker writes.
alter table public.event_outbox enable row level security;
alter table public.event_log   enable row level security;
-- (no policies added => default deny for the authenticated role)

-- 3.1.6  Extend the in-RPC outbox writer. The existing RPCs
-- (submit_test_attempt, schedule_review_for_error, record_progress_evidence)
-- gain an "outbox emit" step at the end of their transaction.
-- We do NOT replace those RPCs — we extend them. The grading
-- logic and evidence math are unchanged; the only addition is
-- one or more INSERTs into event_outbox inside the same tx.
-- See §4 for the event emission matrix.

-- 3.1.7  Idempotency-key table extension. We add the
-- Phase 2 idempotency_keys table a phase column for traceability
-- (event_outbox uses the same hash so retries that hit a 409
-- from the HTTP layer can replay without re-emitting).
alter table public.idempotency_keys
  add column if not exists event_emitted boolean not null default false;
```

This is the entire DDL. Tables, indexes, view, claim function, RLS, one column add. The migration is idempotent (`if not exists` on every DDL statement) and re-runnable.

### 3.2 What we do NOT migrate
- No new enums on the SQL side. Event type is `text` with a TS-side union (mirrors Phase 2's pattern with `error_entries.mistake_type`).
- No new RLS policies on existing tables. `notifications` and `progress_evidence` RLS stays exactly as it is; the worker writes as `service_role` (matching how `submit_test_attempt` already runs `security invoker` against the user's session — but Phase 3's worker is a separate process and uses a service-role client; see §6.2).
- No removal of the `submit_test_attempt` / `schedule_review_for_error` / `record_progress_evidence` RPCs. They become richer (outbox-emitting) but the function signatures and return shapes are unchanged.

---

## 4. Event Catalog and Envelope

### 4.1 Envelope (TRD §8 fields, named to match)
```ts
// packages/shared/src/events/envelope.ts
export type EventType =
  | 'attempt.submitted'           // emitted by submit_test_attempt RPC
  | 'attempt.analyzed'            // emitted by the post-grading analysis handler (Phase 3 thin pass)
  | 'error.recorded'              // emit on insert into error_entries (new error)
  | 'error.classified'            // emit when mistake_type goes from null → value
  | 'review.scheduled'            // emit by schedule_review_for_error RPC
  | 'review.started'              // emit when review_schedules.state → in_progress
  | 'review.outcome_recorded'     // emit when review_attempts row lands
  | 'error.resolved'              // emit when error_entries.status → resolved
  | 'error.reopened'              // emit when error_entries.status → reopened (incl. submit_test_attempt recurring)
  | 'task.completed'              // emit when planner_tasks.state → completed
  | 'task.missed'                 // emit when planner_tasks.state → missed (markTaskMissed)
  | 'syllabus.node_archived'      // emit when subject/topic/sub_topic archived
  | 'notification.created';       // emit by notification projector (meta-event)

export interface EventEnvelope<T extends EventType> {
  eventId: string;                // sha256(event_type|aggregate_type|aggregate_id|version|idempotency_key), hex
  eventType: T;
  schemaVersion: 1;
  occurredAt: string;             // ISO 8601
  accountId: string;              // user_id (Phase 3 aliases TRD's accountId → user_id; spec uses both names)
  actorId: string | null;         // the user who caused the event (null = system / worker)
  aggregateType: string;          // 'test_attempt' | 'error_entry' | 'review_schedule' | ...
  aggregateId: string;            // uuid of the source row
  aggregateVersion: number;       // 1 unless the same aggregate emits a second event later
  payload: EventPayloadByType[T];
  idempotencyKey: string;         // request's Idempotency-Key OR hash(event_type, aggregate_id, version)
}
```

The `EventPayloadByType` map gives each event a stable payload shape. Examples (full list in `packages/shared/src/events/payloads.ts`):

| event | payload keys |
|-------|--------------|
| `attempt.submitted` | `test_id`, `attempt_id`, `correct_count`, `incorrect_count`, `partial_count`, `skipped_count`, `accuracy`, `duration_ms`, `incorrect_question_ids: string[]` |
| `error.recorded` | `error_id`, `question_id`, `source_attempt_id`, `recurrence_count` |
| `error.classified` | `error_id`, `mistake_type`, `previous_mistake_type: string \| null` |
| `review.scheduled` | `schedule_id`, `error_id`, `strategy`, `due_at` |
| `review.outcome_recorded` | `schedule_id`, `error_id`, `question_id`, `outcome` |
| `error.resolved` | `error_id`, `trigger: 'review' \| 'manual'`, `review_schedule_id: string \| null` |
| `error.reopened` | `error_id`, `source_attempt_id: string \| null` |
| `task.completed` | `task_id`, `plan_date`, `subject_id: string \| null` |
| `task.missed` | `task_id`, `plan_date`, `subject_id: string \| null` |
| `syllabus.node_archived` | `node_type: 'subject' \| 'topic' \| 'sub_topic'`, `node_id` |
| `notification.created` | `notification_id`, `kind`, `severity`, `source_event_id` |

`attempt.analyzed` is a Phase 3 thin pass: the worker re-reads the just-submitted attempt and emits a per-question list (the test answer outcomes) to drive downstream consumers that need per-question detail. It is the same envelope, with payload `{attempt_id, answers: [{question_id, outcome}]}`. This is a deliberate split — `attempt.submitted` is the "thing happened" event; `attempt.analyzed` is the "richer shape" event downstream handlers consume.

### 4.2 Emission matrix (every place an event is written, and from where)

| Source mutation | Where it lives today | Event(s) emitted | Inside same tx? |
|-----------------|----------------------|------------------|-----------------|
| Submit test attempt | `submit_test_attempt` RPC | `attempt.submitted` (1), `error.recorded` (N — one per incorrect question; pre-existing + reopened errors get `error.reopened` instead) | yes |
| Schedule a review | `schedule_review_for_error` RPC | `review.scheduled` | yes |
| Record progress evidence | `record_progress_evidence` RPC | (none — only used by `recordProgressEvidence` service; only emits if a hand-rolled non-RPC call eventually needs to) | — |
| Classify an error (mistake_type set) | `errors.updateErrorEntry` service | `error.classified` if `mistake_type` was null → value | yes (extend the existing update statement) |
| Mark a review in_progress | `review.updateReviewSchedule` when state=in_progress | `review.started` | yes |
| Record a review attempt (outcome) | `review.recordReviewAttempt` service | `review.outcome_recorded` | yes |
| Resolve an error (qualifying correct review) | new `errors.resolveError` service | `error.resolved` | yes |
| Complete a planner task | `planner.updatePlannerTask` when state→completed | `task.completed` | yes |
| Mark a planner task missed | `planner.markTaskMissed` | `task.missed` | yes |
| Archive a syllabus node | new `syllabus.archiveNode` service | `syllabus.node_archived` | yes |
| Notification projector creates a row | worker (post-commit) | `notification.created` (meta-event for downstream consumers like email digests) | yes (inside the worker's projector tx) |

Every emission is inside the same Postgres transaction as the source mutation, per TRD §7. The worker only sees events that have already committed. This is the atomicity contract.

For events emitted from RPCs, the emission is a literal `INSERT INTO public.event_outbox (...)` appended to the existing function bodies — no separate client-side orchestration, no risk of a "wrote the row but forgot to emit" gap.

For events emitted from service-layer mutations (the ones without a wrapping RPC), we extend the service's existing update/insert to include the outbox insert. The service transaction becomes a Postgres function or a service-role client with an explicit `BEGIN`/`COMMIT`. **§[DEFAULT]** Pick: service uses a `SupabaseClient` with a service-role key wrapped in a tiny `withTx` helper that runs the writes sequentially with no RLS (matching the existing pattern in `submit_test_attempt`). If the writes must cross more than two tables we promote the service to a Postgres function in a follow-up migration — **not in Phase 3**.

### 4.3 Idempotency key for every emission

The TRD doesn't pin the exact key construction; we lock the formula in Phase 3 so the spec stays the single source of truth.

- For events emitted from inside an HTTP-mutating route: the route's `Idempotency-Key` header (already captured by `withIdempotency` in Phase 2) is the event's `idempotencyKey`. A retry that lands on the cached response therefore emits zero additional events.
- For events emitted from inside an RPC (no HTTP request): the key is `sha256(event_type || aggregate_type || aggregate_id || aggregate_version)`. Repeating the same call with the same `aggregate_version` is a duplicate that hits `uq_event_outbox_idem` and is dropped.
- For events emitted by the worker itself (notification.created): the key is `sha256(source_event_id || handler_name)`. The handler is named in the key so different handlers can both process the same upstream event without colliding.

`eventId` is computed the same way the key is, but it lives in the `event_outbox.event_id` column (a denormalized `text` for indexability). Both are 64-char hex.

---

## 5. Idempotency, Retry, and Dead-Letter Semantics

### 5.1 Handler contract (the rule every consumer must obey)

1. A handler MUST be a pure function `(envelope) => Promise<void>`. It reads/writes only the projections (notifications, progress_evidence), and only as `service_role`. It must not call other handlers (no fan-out; another worker tick handles the cascading event).
2. A handler MUST be idempotent at the projection level. Concretely, every projection write uses a deterministic `idempotency_key` (the dedup key the TRD §20.1 requires) so a replay finds the same row.
3. A handler MUST NOT throw for "expected" failures (duplicate, missing row, version conflict). It writes `event_log.status = 'succeeded'` and returns. **§[DEFAULT]** Missing projection rows: log as succeeded with `attempt_count=1, last_error=null`. (Reason: an event without a target row is still "successfully processed".)
4. A handler MUST throw for "unexpected" failures (DB constraint violation, JSON parse error, etc.). The worker catches the error and increments `attempt_count` on the matching `event_log` row.

### 5.2 Retry schedule

| Attempt | Wait before retry | Source of delay |
|---------|-------------------|-----------------|
| 1 (initial) | 0 | worker poll |
| 2 | 30 s | worker scheduler |
| 3 | 2 min | worker scheduler |
| 4 | 10 min | worker scheduler |
| 5 (last) | 1 h | worker scheduler |
| After 5 | dead-letter | view `public.event_dead_letter` |

**§[DEFAULT]** MAX_ATTEMPTS=5. The exponential schedule doubles the wait after each attempt with a 1-hour cap. The worker enforces this by reading the existing `event_log.attempt_count` when it claims an event; if `attempt_count + 1 > MAX_ATTEMPTS` it writes `status='dead_letter'` and moves on. The `dead_letter` status means the event will never be re-claimed (the `claim_pending_events` function filters it out).

This is a deliberate Phase 3 simplification. Phase 12 (Notifications) and Phase 14 (Security Hardening) will want stronger controls (operator-triggered retry, jitter, circuit breakers), but those are out of scope.

### 5.3 Worker lease (the `p_lease_for` parameter)

When a worker calls `claim_pending_events`, it gets back a set of events. It MUST write an `event_log` row (succeeded / failed / dead_letter) for each one within `p_lease_for` (default 60s). If a worker crashes mid-flight, the rows it claimed but did not log will be re-claimed on the next poll (because no succeeded log row exists yet).

There is no separate `claimed_at` column. The next claim is permitted because the original `event_log` insert never landed — Postgres's `FOR UPDATE SKIP LOCKED` on `event_outbox` is the only thing that prevented concurrent claims during the lease window, and once the worker dies its locks are released by Postgres on connection close. **§[DEFAULT]** Lease 60 s. Worker poll cadence 5 s.

### 5.4 What the worker does NOT do
- It does not call user-facing HTTP routes.
- It does not call AI providers. (Phase 8.)
- It does not write to `progress_snapshots` or `student_model_*`. (Phase 4 and 5.)
- It does not delete events. Archiving is a separate Phase 16 maintenance task.
- It does not produce cron-style scheduled work. That goes through the scheduled-job runner (§6.4).

---

## 6. Architecture (apps/api/src/events/, the new module)

```
apps/api/src/events/
  envelope.ts                  # re-exports shared types; adds helpers
  outbox-writer.ts             # emit() used by RPCs and services
  handlers/
    project_progress_evidence.ts
    project_notification.ts
    emit_attempt_analyzed.ts
    mark_review_due.ts         # scheduled-only, not a consumer
    detect_task_missed.ts      # scheduled-only
  registry.ts                  # handler_name -> handler fn, plus the list of scheduled jobs
  worker.ts                    # poll loop, retry, dead-letter
  scheduled-jobs.ts            # cron-style runner, one per Phase 3 job
  __tests__/
    outbox-writer.test.ts
    handlers.test.ts
    worker.retry.test.ts
    idempotency.test.ts
    scheduled-jobs.test.ts
```

### 6.1 `outbox-writer.ts` — the only place that writes to `event_outbox`
- Exposes a typed `emit(client, envelope)` that does the INSERT, ignores `uq_event_outbox_idem` violations (treats them as "already emitted, fine"), and returns the new row.
- Wraps the insert in a `withTx` helper that re-uses the caller's transaction (via the Postgres function approach for RPC-emitted events and via a service-role client for service-emitted events).
- **No event is ever emitted from outside this module.** Routes never call `client.from('event_outbox').insert(...)` directly. Centralized emission = one place to audit the catalog.

### 6.2 Worker
- One Fastify plugin-style entrypoint: `registerEventBus(app, env)` installed in `buildServer`.
- Spawns two child tasks on `app.ready()`:
  1. **Worker poll** — every 5 s, calls `claim_pending_events(p_handler, 25, interval '60s')` per registered handler in turn, runs the handler, writes the `event_log` row. One poll pass = one batch per handler.
  2. **Scheduled jobs** — every 30 s, checks which scheduled jobs are due and runs them.
- Graceful shutdown: stops accepting new claims, drains in-flight handlers, exits when `event_log` is consistent (or 30 s timeout). Wired through `app.addHook('onClose', …)`.
- Concurrency: handlers run in series within a poll pass. **§[DEFAULT]** Phase 3 ships a single-worker process. The `claim_pending_events` function is the synchronization point. Two API instances both running the worker are safe — they each poll, `SKIP LOCKED` keeps them from grabbing the same event. No leader election is required.
- Logging: every event handled emits a `log.info({ eventId, handler, attempt, status })` line. The `requestId` of the originating HTTP request is propagated to the envelope's `actorId` (already in the envelope); the worker adds its own `workerId` (random per process) so dead-letter debugging is straightforward.

### 6.3 Handlers (the Phase 3 set)
1. **`project_progress_evidence`** — the only handler that writes `progress_evidence` from the outbox. Reads the envelope and produces one `progress_evidence` row per relevant payload key. Triggered by every event with a `progress_evidence` impact. Idempotent on `(user_id, dimension, ref_kind, ref_id)`.
2. **`project_notification`** — writes `notifications` rows. Uses the dedup key from TRD §20.1: `user_id, event_type, source_aggregate_type, source_aggregate_id, semantic_occurrence_id`. Triggered by every event whose handler decides a user-visible notification is warranted (defaults listed below).
3. **`emit_attempt_analyzed`** — listens for `attempt.submitted`, emits a downstream `attempt.analyzed` event with the per-question outcome list. Pure transform; idempotent because the `attempt.analyzed` event has its own `(attempt_id, schema_version)` idempotency key.
4. **`mark_review_due`** (scheduled) — every 5 min, scans `review_schedules` where `state='scheduled' AND due_at <= now()`, emits `review.started` (with a transition to `state='due'`). Idempotent because we filter on `state='scheduled'`. (We do NOT mutate state from the worker; we emit the event and rely on a Phase 3 service to flip state. **§[DEFAULT]** For Phase 3, the worker uses a `SECURITY DEFINER` Postgres function `mark_due_reviews()` that does the state transition + emits the event. This avoids RLS friction.)
5. **`detect_task_missed`** (scheduled) — every 15 min, scans `planner_tasks` where `state='planned' AND plan_date < today() AND plan_date >= today() - interval '7 days'`, emits `task.missed` and creates a `backlog_items` row. **§[DEFAULT]** 7-day lookback window; only emits for tasks that crossed midnight local time without a state change.

**Default notification triggers (Phase 3 set):**
- `error.reopened` → `severity='warning'`
- `error.resolved` → `severity='success'`
- `task.missed` → `severity='info'`
- `review.outcome_recorded` (when outcome='incorrect') → `severity='info'`
- `syllabus.node_archived` → `severity='info'`
- `attempt.submitted` → NO notification by default (the per-attempt detail lives in the activity feed; the inbox stays low-noise per PRD §25)

These are Phase 3 defaults, locked in code. Adding/removing triggers is a code change, not a config change, until Phase 12 builds the user-preferences model.

### 6.4 Scheduled jobs
- One file `scheduled-jobs.ts` with a `registerScheduledJobs()` function and a `dueIn` per job. The runner is dead simple: every 30 s, iterate registered jobs, check `last_run_at + interval dueIn < now()`, run, write `last_run_at`. The runner never calls the worker poll loop.
- `mark_review_due` and `detect_task_missed` are the only two Phase 3 scheduled jobs. **§[DEFAULT]** Phase 3 does NOT introduce a `scheduler_state` table — the spec's "scheduler_state (Phase 3)" comment in `03_core_schema.sql` is intentionally satisfied by the `event_log` table plus the in-process scheduler. The dedicated `scheduler_state` table can wait for Phase 12 when there are enough scheduled jobs to warrant a leader-election-friendly run log.
- Each scheduled job is itself a handler with a stable handler name and a (synthetic) event_type so the audit trail flows through `event_log` consistently. The "event" they emit is a `system.tick` envelope with the job's name as `aggregateType`. **§[DEFAULT]** A synthetic event for tick logging is a small piece of magic; if the user prefers a clean separation, Phase 3 can have its own `scheduled_runs` table. Plan calls this out as a request-for-decision below.

### 6.5 What the worker never does
- Never blocks longer than 30 s on a single handler. Handlers with long-running work get split: they write a "started" event and exit; a second handler picks up "started" and does the heavy work. Phase 3 has no such handlers — all five are sub-second. **§[DEFAULT]** 30 s handler timeout. Phase 4's analytics rollups will hit this; Phase 4 will redesign the handler to emit a "rollup.requested" event instead.

---

## 7. Analytics Projections (read models Phase 3 exposes)

Phase 3 does NOT compute metric values. It exposes the **8 dimensions** the PIP §Phase 4 will need. Concretely:

### 7.1 Endpoint: `GET /v1/analytics/dimensions` (NEW)
Returns the canonical list of dimensions, the `progress_evidence.dimension` enum values it currently uses, and the planned Phase 4 metric names. Stable for clients; Phase 4 will not change this list. Shape:
```ts
interface AnalyticsDimensions {
  dimensions: Array<{
    key: 'syllabus_coverage' | 'test_accuracy' | 'test_attempts'
        | 'errors_created' | 'errors_resolved' | 'errors_reopened'
        | 'review_completed' | 'planner_completion' | 'planner_backlog'
        | 'backlog_recovered' | 'consistency' | 'practice_volume'
        | 'composite';
    label: string;            // human-readable
    progressDimension: ProgressDimension | null;  // maps to evidence.dimension
    description: string;
  }>;
  sourceTables: string[];     // which tables feed it
  scheduleNote: string;       // "eventual; computed by Phase 4"
}
```
This is a static JSON served from `apps/api/src/services/analytics-dimensions.ts`. It is versioned via the `KRODEX_VERSION` constant and a `schemaVersion` field in the response.

### 7.2 Endpoint: `GET /v1/analytics/evidence?dimension=...&since=...&until=...&limit=...` (NEW)
This wraps the existing `progress.listProgressEvidence` service and is the same shape Phase 2 already returns. The only addition: a `freshness` block on the envelope: `{ lastEventAt: string | null, eventLagSeconds: number | null }` so clients can show "Updated N seconds ago" honestly. Computed by `MAX(event_outbox.occurred_at) WHERE event_type IN (relevant set) AND user_id = me`.

### 7.3 Endpoint: `GET /v1/analytics/dashboards/overview` (NEW — small, not Phase 4)
Returns three numbers a UI can show on day one: "tests this week" (count of distinct `attempt.submitted` events in the last 7 days), "errors still active" (`error_entries WHERE status='active'`), "reviews due" (`review_schedules WHERE state IN ('scheduled','due') AND due_at <= now()`). All three are direct SQL counts on existing tables, so the endpoint is cheap and always-fresh. Phase 4 replaces this with the real composite metrics; Phase 3 keeps the endpoint for low-stakes "summary card" UIs.

### 7.4 Why these endpoints ship in Phase 3
The PIP §Phase 3 explicitly says "Project progress evidence and notifications." The dimensions list and the evidence query are the first projection surfaces. Without them, Phase 4 has nothing to compute from. The PIP's exit criterion for Phase 3 is "representative event chains are verified end-to-end and duplicate delivery creates no duplicate effects" — the dashboards/overview endpoint is the canonical end-to-end check.

---

## 8. Dependency Map

| Phase 3 module | Depends on (must exist before this) | Produces for (downstream consumer) |
|----------------|-------------------------------------|-----------------------------------|
| Migration 08 | `auth_uid()`, `prevent_user_id_mutation()`, `users` | new `event_outbox`, `event_log`, view, claim fn |
| `outbox-writer.ts` | Migration 08 | handler inputs |
| RPC extensions (3 RPCs) | `outbox-writer` shape (via in-RPC SQL inserts) | `event_outbox` rows |
| Service extensions (errors, review, planner, syllabus) | `outbox-writer` shape | `event_outbox` rows |
| `project_progress_evidence` handler | `progress_evidence` table | `progress_evidence` rows (replaces the hand-rolled writes inside the RPCs) |
| `project_notification` handler | `notifications` table | `notifications` rows |
| `emit_attempt_analyzed` handler | `event_outbox` | secondary `event_outbox` row |
| `mark_review_due` job | `mark_due_reviews()` SQL function | `event_outbox` row + state transition |
| `detect_task_missed` job | `detect_missed_tasks()` SQL function | `event_outbox` row + `backlog_items` row |
| Worker | all of the above | `event_log` rows |
| Analytics dimensions endpoint | shared enums | static JSON |
| Evidence freshness endpoint | `event_outbox` | freshness numbers |
| Dashboards overview endpoint | `event_outbox` + `test_attempts` + `error_entries` + `review_schedules` | 3 numbers |
| Test suite | all of the above | green tests |

The `submit_test_attempt` RPC will change in two ways:
1. It will continue to write `progress_evidence` directly (Phase 2 behavior), because removing it would break the Phase 2 transaction. The `project_progress_evidence` handler **also** writes a `progress_evidence` row from the `attempt.submitted` event, with `(user_id, dimension, ref_kind, ref_id)` set to the attempt row. Idempotency on `(user_id, dimension, ref_kind, ref_id)` prevents the duplicate from the worker.
2. It will append outbox inserts at the end of the existing transaction. The grading logic and ordering are unchanged; we add 1–N outbox rows after the existing progress_evidence + syllabus_progress upserts.

**§[DECISION REQUIRED]** Should Phase 3 drop the in-RPC `progress_evidence` writes and rely entirely on the worker? It would be cleaner (one writer, no duplicate) but it makes `progress_evidence` eventually consistent for the brief window between submit and worker poll. The plan as written keeps both. This is a request for user decision below.

---

## 9. Tests (the verification gate for Phase 3)

Phase 3 ships a new test layer: `event-bus` tests. They live alongside the existing `__tests__` folders, using the same `vitest` setup and the same `makeFakeSupabase` helper where possible (the fake's `tables` config grows a new `event_outbox` and `event_log` table; the worker is tested with a small in-memory `claimPendingEvents` mock so the test does not need a real Postgres connection).

### 9.1 `events/outbox-writer.test.ts`
- `emit()` produces a row with the expected `eventId`, `eventType`, `idempotencyKey`.
- A duplicate `emit()` for the same `(user_id, event_type, idempotency_key)` is silently dropped (uq_event_outbox_idem fires; writer returns the existing row).
- A non-duplicate insert with the same `eventId` (different idempotency key) is rejected (uq_event_id) — this is a programmer error and the writer throws.

### 9.2 `events/idempotency.test.ts`
- End-to-end: emit `attempt.submitted`, run the worker once, run it again with the same claim — second pass is a no-op (succeeded log row already exists).
- A handler that throws on first attempt leaves no `succeeded` log row. The next poll re-claims the event, runs it again. If it now succeeds, `event_log` has exactly one row, `status='succeeded'`, `attempt_count=2`. If it now succeeds-then-fails-then-succeeds across 5 polls, the final `event_log` row has `attempt_count=5` and `status='succeeded'`. (Asserted by a fake `now()` that advances on each poll.)
- A handler that fails 5 times produces an `event_log` row with `status='dead_letter'` and a matching `event_dead_letter` view row.
- `claim_pending_events` skips events with `dead_letter` log rows.

### 9.3 `events/handlers.test.ts`
- `project_progress_evidence` for `attempt.submitted`: produces one `progress_evidence` row per (subject_id) with the expected dimension and metadata.
- `project_notification` for `error.reopened`: produces one `notifications` row with the right `kind`, `severity`, and `payload` linking back to the source aggregate.
- `project_notification` is idempotent on the dedup key: replaying the same event does not produce a second row.
- `emit_attempt_analyzed` for `attempt.submitted`: produces one `event_outbox` row of type `attempt.analyzed` with the per-question answer list.

### 9.4 `events/worker.retry.test.ts`
- Backoff schedule: 30 s, 2 min, 10 min, 1 h, then dead-letter. Test asserts the wait values by stubbing the scheduler.
- Lease expiry: a worker that claims an event but does NOT write an `event_log` row within 60 s allows the next poll to re-claim it.
- Concurrent workers: two parallel claims of the same batch return disjoint sets (SKIP LOCKED). Tested by running the claim function twice in a Promise.all against a small seeded set.

### 9.5 `events/scheduled-jobs.test.ts`
- `mark_review_due` emits a `review.started` event for every review with `state='scheduled' AND due_at <= now()`; does NOT emit for already-due rows on the second tick.
- `detect_task_missed` emits `task.missed` and creates `backlog_items` for the right window. Asserts the 7-day lookback by passing fake `now()` and checking edge cases at day 0/6/7/8.

### 9.6 Route tests (extend the existing test layers)
- `routes/analytics-dimensions.test.ts` — schema validation, enum check, version pin.
- `routes/evidence-freshness.test.ts` — fresh envelope shape, lag math, cache header.
- `routes/dashboards-overview.test.ts` — counts match the underlying tables; auth required.

### 9.7 The Phase 2 test suite stays green
All 354 tests must continue to pass. The error handler test, the syllabus service test, the validation schema test, the route tests — all untouched. The RPC extensions add new behavior but keep existing function signatures and return shapes. The outbox inserts inside the existing RPCs are guarded by `IF NOT EXISTS` patterns and do not affect the existing return.

### 9.8 What Phase 3 explicitly does NOT test live
The Phase 1 deferred item (LIVE_DB integration tests, RLS verification) stays deferred. Phase 3 does not make this worse — it adds no new LIVE_DB-gated tests — but it does not fix it either. **§[REPEAT]** The LIVE_DB=1 suite is still gated off until Phase 14 or 15. Documented again in §11.

---

## 10. Verification Gates (Phase 3's exit criteria, locked in this plan)

The PIP §Phase 3 says: "representative event chains are verified end-to-end and duplicate delivery creates no duplicate effects." Phase 3 enforces this with these gates, all of which must be green before the report is written:

1. **Type safety**: `npm run typecheck` (or the project's configured command) green across all three workspaces.
2. **Build**: `npm run build` (or configured) green across all three workspaces.
3. **Lint**: `npm run lint` (or configured) green.
4. **Tests**: `npm test` reports a pass count ≥ the Phase 2 number (354 + 4 skipped). The skipped 4 are still LIVE_DB-gated. New Phase 3 tests add to the count; the planned new count is ~30–40, all un-skipped.
5. **New test layers** listed in §9 all green.
6. **Migration dry-run**: the new SQL applies cleanly to a clean database. (Cannot be verified against live Supabase until Phase 14 — see deferred-items note.)
7. **End-to-end event chain (unit)**: one test in `events/handlers.test.ts` walks the entire flow — emit `attempt.submitted` from inside a fake RPC, run the worker once, assert (a) `event_outbox` has 1 row, (b) `event_log` has N rows (one per handler), (c) `progress_evidence` has the new row, (d) `notifications` has the (conditional) row. The duplicate-delivery test in §9.2 then asserts (a)+(b) stay the same, (c)+(d) do not grow.
8. **Idempotency replay (unit)**: replaying the HTTP request with the same Idempotency-Key returns the cached response AND emits zero additional events. (Test wires `withIdempotency` to the test cache.)
9. **Dead-letter visibility (unit)**: forcing a handler to fail 5 times produces a row in the `event_dead_letter` view. Tested via the retry test.
10. **PHASE3_REPORT.md** written and committed.

### 10.1 What we are NOT verifying in Phase 3
- **Live Supabase**: the entire event bus is unit-tested against `makeFakeSupabase`. The LIVE_DB=1 integration suite is still deferred. This is the same posture as Phase 1 and Phase 2; Phase 3 keeps it that way on purpose because flipping it on is its own substantial effort.
- **Performance under load**: not measured. Phase 15 owns that.
- **Multi-instance worker correctness**: not measured. The `SKIP LOCKED` claim is exercised in a unit test with two parallel claims, not a real multi-process scenario.

---

## 11. Deferred From Earlier Phases (preserved, not regressed)

The following items were deferred in Phase 1 and Phase 2 reports. Phase 3 does not regress them. They stay open until a later phase explicitly closes them.

- **Live Supabase / RLS / migration verification.** Phase 3's new migration (`08_event_bus.sql`) adds tables and a function. None of them are exercised against a real Supabase project. RLS policies on `event_outbox` and `event_log` are written but not verified against a real `auth.uid()`-bound session. The single source of truth for "the SQL works" remains the `migrations.test.ts` SQL-comment check, which validates the comment block, not the runtime.
- **`scheduler_state` table.** PIP §Phase 3 is silent on whether this is in scope. The plan defers it to Phase 12; the in-process scheduler in §6.4 is sufficient.
- **`analytics_materialized_views`.** Explicitly PIP §Phase 4.
- **`audit_log`.** PIP §Phase 9 (Security Hardening).

### 11.1 What Phase 3 actively adds to the deferred list
- **Cross-instance worker leader election.** Out of scope; Phase 15.
- **Operator tooling for dead-letter replay.** A dry-run endpoint exists for tests; a polished admin UI does not.
- **A real production worker deployment story.** The worker is in-process. Running it as a separate container is a Phase 15/16 ops concern.

---

## 12. Out-of-Scope Items (explicit, so the gate review is unambiguous)

The following are **deliberately** not in Phase 3 and will not be added by Phase 3:

| Item | Why deferred | Phase it belongs to |
|------|--------------|---------------------|
| Phase 4 metric formulas (accuracy windows, error health indices, etc.) | PIP §Phase 4 | 4 |
| `progress_snapshots` writes | PIP §Phase 4 | 4 |
| BKT/IRT calculations | PIP §Phase 5 | 5 |
| `student_model_snapshots` / `student_model_features` writes | PIP §Phase 5 | 5 |
| Email / push notification channels | PIP §Phase 12 | 12 |
| User notification preferences | PIP §Phase 12 | 12 |
| Question snapshot generation | PIP §Phase 9 | 9 |
| AI classification of error mistake_type | PIP §Phase 8 | 8 |
| Web UI for notifications inbox | PIP §Phase 6/7 | 6, 7 |
| Cross-instance worker leader election | ops / perf | 15 |
| pg-boss / external queue adoption | ops / perf | 15/16 |
| `audit_log` table writes | PIP §Phase 14 | 14 |
| Fine-grained RLS verification on the new tables | hardening | 14 |
| Phase 16 release-rehearsal of the new migration | release | 16 |

---

## 13. Decisions Locked in This Plan (and Decisions Still Open)

### 13.1 Locked
- **Single Postgres-backed outbox.** No external queue in Phase 3. Schema is queue-agnostic so swapping later is a worker change, not a producer change.
- **One in-process worker per API instance.** No leader election; concurrency is the `SKIP LOCKED` claim.
- **MAX_ATTEMPTS=5** with the wait schedule 0 / 30 s / 2 min / 10 min / 1 h / dead-letter.
- **Lease 60 s, poll 5 s.**
- **Handler timeout 30 s.**
- **Synthetic `system.tick` event for scheduled-job audit logging.** Reasonable; revisitable in Phase 12.
- **8-dim list locked** to the union of `ProgressDimension` and a new `composite` placeholder. The endpoint is static JSON.

### 13.2 Open — request user decision before approval
The following three have non-obvious trade-offs and would benefit from a sign-off rather than a default:

1. **§[DECISION REQUIRED] Duplicate-write posture for `progress_evidence` on attempt submission.** Keep both writers (RPC + worker) with idempotency dedup, OR drop the RPC's writer and rely on the worker (eventually consistent, but one writer). Plan as written keeps both.
2. **§[DEFAULT] Lease 60 s, poll 5 s, MAX_ATTEMPTS=5, 30 s/2 min/10 min/1 h backoff, 30 s handler timeout.** Confirm or change.
3. **§[DECISION REQUIRED] Synthetic `system.tick` event vs dedicated `scheduled_runs` table.** Plan as written uses the synthetic event (one table, one audit trail). A dedicated table is cleaner but adds a 9th table to the schema.

Any of these can be flipped during planning before code is written.

---

## 14. Implementation Order (when implementation is approved)

The order below minimizes "blocked on N" dependencies. Each step is testable in isolation.

1. Migration `08_event_bus.sql`. Apply it to a clean DB. The `migrations.test.ts` comment-block check passes.
2. `packages/shared/src/events/` — envelope, payload types, dimension list. Type-only, no runtime.
3. `apps/api/src/events/outbox-writer.ts` + `outbox-writer.test.ts`.
4. Extend the 3 RPCs in a new migration `09_extend_rpcs_with_outbox.sql` (cleaner than mutating 07). Each RPC gains an `INSERT INTO event_outbox` at the end. No signature changes.
5. `apps/api/src/events/handlers/project_progress_evidence.ts` + tests.
6. `apps/api/src/events/handlers/project_notification.ts` + tests.
7. `apps/api/src/events/handlers/emit_attempt_analyzed.ts` + tests.
8. `apps/api/src/events/registry.ts` + `worker.ts` + `worker.retry.test.ts`.
9. SQL functions `mark_due_reviews()` and `detect_missed_tasks()` in `10_scheduled_job_fns.sql`.
10. `apps/api/src/events/handlers/mark_review_due.ts` + `detect_task_missed.ts` + `scheduled-jobs.ts` + tests.
11. Service-layer emission points (errors, review, planner, syllabus). One PR per service.
12. New routes: `routes/analytics.ts` with the three new endpoints + tests.
13. Wire `registerEventBus(app, env)` in `apps/api/src/server.ts`. Update `/health` to report worker status.
14. `docs/PHASE3_REPORT.md`. Stop.

### 14.1 Estimated file footprint
- 1 new migration (`08_event_bus.sql`).
- 1 follow-up migration to extend the 3 RPCs (`09_extend_rpcs_with_outbox.sql`).
- 1 migration for scheduled-job SQL functions (`10_scheduled_job_fns.sql`).
- ~10 new files in `apps/api/src/events/`.
- ~6 new test files in `apps/api/src/events/__tests__/`.
- 1 new route file `apps/api/src/routes/analytics.ts`.
- 1 service file `apps/api/src/services/analytics-dimensions.ts`.
- 1 new shared-package file `packages/shared/src/events/index.ts` (plus `envelope.ts` and `payloads.ts`).
- 1 small change to `apps/api/src/server.ts` to register the event bus.
- 1 small change to `apps/api/src/routes/progress.ts` to add the freshness block.
- 1 new `docs/PHASE3_REPORT.md`.

No files are deleted. No existing public route shape changes. No existing RPC signature changes.

---

## 15. Stop Point

This plan is complete. **Phase 3 has not been implemented.** No code has been written. No migrations have been applied. No new tests have been added.

Awaiting approval to begin Step 1 of §14 (migration `08_event_bus.sql`).
