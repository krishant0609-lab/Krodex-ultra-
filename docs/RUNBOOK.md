# KRODEX — Operational Runbook

**Status:** Phase 16 M6 deliverable (frozen at v1.0)
**Source of truth:** TRD §39 "Operational Alerts" + Engineering Support §58 "Production Readiness"
**Audience:** on-call engineer, release engineer, ops lead
**Last reviewed:** 2026-09-04

This runbook is the recovery-side complement to `docs/RELEASE_CHECKLIST.md`
(M9). Where the release checklist is a forward-looking gate ("did every
item pass before v1.0?"), the runbook is a backward-looking guide ("an
alert fired; what now?"). Every section has four fields:

- **Alert definition** — the symptom + the metric the alert watches.
- **Recovery procedure** — the steps to take, in order.
- **Owner** — the role that owns the recovery, not a person's name.
- **Verification step** — what the on-call does to confirm recovery.

The 8 categories are the TRD §39 list, in TRD §39 order. There are no
other categories at v1.0.

---

## 1. Submission failure spike

| Field | Value |
|---|---|
| **Alert definition** | The `attempt.submitted` event creation rate (events per minute, per `event_outbox`) drops by more than 50% vs. the trailing 7-day baseline, OR the `event_log.status='failed'` count for the `submit_test_attempt` handler exceeds 5 in any 5-minute window. The metric source is the `/ops/event-failures` route (Phase 16 M8) with `since = now − 5m`, `until = now`, `status = 'failed'`. |
| **Recovery procedure** | 1. Query `/ops/event-failures?since=…&until=…&status=failed` and confirm the spike is bounded to the `submit_test_attempt` handler. 2. Inspect the corresponding `event_log.last_error` rows (`event_log` is service-role only; use the service-role client). 3. If the failure mode is a downstream RPC error (`recompute_student_model`, etc.), restart the API and re-emit the events from the outbox (outbox is replayable). 4. If the failure mode is a Postgres constraint violation (23505 / 23503), the `error_entries` upsert collided on `(user_id, question_id)` — investigate the caller's submit rate. 5. If the failure mode is a 5xx in the API's Fastify logs, capture the stack and open a follow-up ticket. |
| **Owner** | Backend on-call |
| **Verification step** | After recovery, the `/ops/event-failures` `failed` count for the `submit_test_attempt` handler returns to 0 within 10 minutes. The `attempt.submitted` event rate returns to the 7-day baseline within 15 minutes. |

## 2. Evidence capture failure spike

| Field | Value |
|---|---|
| **Alert definition** | The `evidence.captured` event creation rate drops by more than 50% vs. the trailing 7-day baseline, OR the `event_log.status='failed'` count for the `evidence_capture` handler exceeds 3 in any 5-minute window. Symptom-side companion: `POST /tests/attempts/:id/evidence` returns 5xx at a rate above 1%. |
| **Recovery procedure** | 1. Confirm Supabase Storage (`STORAGE_BUCKET_ERROR_CAPTURES`, `STORAGE_BUCKET_QUESTION_SNAPSHOTS`) is reachable from the API host. 2. Inspect the API logs for the `evidence_capture` handler's `last_error`. 3. If the failure is a 413 (oversize), the client is exceeding `evidenceSnapshotMaxBytes` (5 MiB). Update the client's pre-upload size check. 4. If the failure is a 403 (signature/permission), the service-role key on the API host is mismatched with the bucket's RLS policy — rotate via the secret-rotation procedure (M5 R5). 5. If the failure is transient (network blip), the outbox will replay; no manual action needed beyond waiting one lease-cycle (60s). |
| **Owner** | Backend on-call |
| **Verification step** | The `evidence_captured` rate returns to baseline within 15 minutes. A test upload via the dev fixture server returns 201. |

## 3. Dead-letter jobs

| Field | Value |
|---|---|
| **Alert definition** | Any new row appears in `public.event_dead_letter` (the view defined in migration 08.3). The `event_log.status='dead_letter'` count for any handler is non-zero. The metric source is `/ops/event-failures` with `status=dead_letter`; the route returns the per-handler dead-letter count over the time window. |
| **Recovery procedure** | 1. Query `/ops/event-failures?since=…&until=…&status=dead_letter`. 2. For each `handler_name`, inspect the `event_log.last_error` + `event_log.attempt_count` to decide: a) **safe to replay** — handler is idempotent on `(event_id, handler_name)` per migration 08; re-emit via the outbox-worker restart (the worker's `claim_pending_events` skips succeeded/dead_letter by default, so a manual requeue requires a one-shot SQL `update event_log set status='succeeded' where event_id=… and handler_name=…` only as a last resort). b) **not safe to replay** — the dead-letter event is now in an inconsistent state; open a follow-up ticket and quarantine. 3. Document every replay decision in the incident log. |
| **Owner** | Backend on-call + release engineer (for replay decisions) |
| **Verification step** | The `dead_letter` count for the affected handler is 0 after replay. The corresponding downstream state (notifications delivered, student model updated, etc.) matches the expected post-replay state. |

## 4. Queue age breach

| Field | Value |
|---|---|
| **Alert definition** | The age of the oldest unprocessed row in `public.event_outbox` exceeds 5 minutes. The worker polls via `claim_pending_events(p_handler, p_batch, p_lease_for)`; the lease is 60s, so the next poll should reclaim within ~60s of expiry. |
| **Recovery procedure** | 1. Confirm the API process is running. 2. Confirm the worker's poll loop is making progress: query `event_outbox` for rows with `processed_at IS NULL` and order by `created_at ASC limit 10`; if the oldest is older than 5 minutes, the worker is stalled. 3. Restart the API. 4. If restart does not recover, inspect the API's Fastify logs for the `claim_pending_events` errors. 5. If the database is saturated, see §5. |
| **Owner** | Backend on-call |
| **Verification step** | The oldest unprocessed `event_outbox` row's age is below 60s within 10 minutes of recovery. |

## 5. Database saturation

| Field | Value |
|---|---|
| **Alert definition** | Postgres `pg_stat_activity` shows active connections above 80% of `max_connections`, OR `pg_stat_user_tables` shows sequential scans on tables that have indexes defined (notably `notifications`, `event_log`, `event_outbox`, `notification_deliveries`, `review_schedules`, `backlog_items` — all of which have partial indexes from migration 18). |
| **Recovery procedure** | 1. Identify the long-running query via `pg_stat_activity`; if it's a one-off (e.g. an admin `recompute_*` RPC), wait or cancel (`pg_cancel_backend`). 2. If the saturation is from the API's pooled connections, the Supabase pooler is hitting its limit; reduce the API's `db.pool.max` (engine-level setting) and restart. 3. If the saturation is from a hot table without an index, the query plan is doing seq-scan — verify the partial indexes from migration 18 are present (`\di+ idx_*`); if missing, re-apply migration 18 via the migration-rehearsal procedure (M3). 4. If the saturation is sustained, page the on-call DBA and the host platform owner (resolution may require a vertical scale). |
| **Owner** | Backend on-call + DBA (for sustained saturation) |
| **Verification step** | Active connection count returns below 50% of `max_connections` within 15 minutes. The `idx_*` partial indexes from migration 18 are present and used (verify with `EXPLAIN` on the hot query). |

## 6. Authorization error anomaly

| Field | Value |
|---|---|
| **Alert definition** | The rate of 401 / 403 responses in the API's structured logs exceeds 5% of total 4xx responses over a 15-minute window, OR `assertOwned` rejections exceed 0.1% of `assertOwned` calls in the same window. `assertOwned` is the server-side authorization helper used 83 times across 19 files at v1.0 (see `docs/RELEASE_CONTRACTS_v1.0.md` §3.3). |
| **Recovery procedure** | 1. Sample 10 4xx responses from the API logs and identify the source. 2. If the source is a missing / expired JWT, the client's session expired; this is benign and the client should refresh (the refresh-TTL is `AUTH_REFRESH_TTL_SECONDS`, default 30 days). 3. If the source is a real `assertOwned` rejection (an authenticated user attempting to access another user's resource), treat as a possible intrusion — collect the actor's IP, userId, and the rejected target, and file a follow-up. 4. If the source is a new code path that forgot to call `assertOwned`, open a P0 ticket; the absence of `assertOwned` is a release-blocker. |
| **Owner** | Backend on-call + security lead (for intrusion cases) |
| **Verification step** | The 4xx rate returns below the 5% threshold within 30 minutes. Every `assertOwned` call site in `apps/api/src` still totals 83 (re-run the contract-freeze check from `docs/RELEASE_CONTRACTS_v1.0.md` §3.3). |

## 7. AI provider failure rate

| Field | Value |
|---|---|
| **Alert definition** | The `AI_*` RPC / route calls return 5xx at a rate above 10% over a 15-minute window, OR the API's `ai_timeout` (env: `AI_TIMEOUT_MS`, default 20s) trips on more than 5% of AI calls in the same window. The AI service lives behind `AI_PROVIDER_URL` with `AI_API_KEY`; the `assistant` service has its own retry loop (`AI_MAX_RETRIES`, default 2). |
| **Recovery procedure** | 1. Check the upstream provider's status page (OpenAI / Anthropic / etc. as configured). 2. If the upstream is degraded, switch to the fallback model via the env-var revert procedure (M5 R2): set `AI_MODEL_DEFAULT` to the documented fallback (Phase 4 §12 records the fallback chain). 3. If the upstream is healthy, inspect the API logs for the specific failure mode. 4. If `AI_API_KEY` is the cause, rotate via the secret-rotation procedure (M5 R5). 5. If the failure is a rate-limit (HTTP 429), the API is exceeding the upstream's quota — back off via a short `AI_MAX_RETRIES` reduction (do NOT increase the timeout past 60s). |
| **Owner** | Backend on-call + AI platform owner |
| **Verification step** | The 5xx rate from the `assistant` route returns below 1% within 15 minutes of switching to the fallback model (or rotating the key, as appropriate). The `ai_timeout` rate returns below 1% within the same window. |

## 8. Projection lag

| Field | Value |
|---|---|
| **Alert definition** | The age of the oldest pending row in `public.notification_deliveries` exceeds 5 minutes (D-9, Class C — Approved Product Policy), OR the `project_notification` handler's `event_log.status='failed'` count exceeds 3 in any 5-minute window. The `project_notification` projector is the consumer of the `notification.created` event and is the dominant writer to `notifications` + `notification_deliveries`. |
| **Recovery procedure** | 1. Query `/ops/event-failures?since=…&until=…&status=failed` and filter on `handler_name=project_notification`. 2. If the failures are transient (network / SMTP relay 4xx), the retry loop will recover; wait one lease-cycle. 3. If the failures are sustained (>3 in 5min), the projector is stalled; restart the API. 4. If restart does not recover, inspect the `event_log.last_error` for the `project_notification` handler. 5. If the lag is bounded but the projector is slow (not failed), the in-app delivery dispatcher's partial index `idx_notification_deliveries_pending_channel_time` from migration 18 may be missing — verify with `EXPLAIN`. |
| **Owner** | Backend on-call |
| **Verification step** | The oldest pending `notification_deliveries` row's age is below 60s within 10 minutes. The `project_notification` `event_log` failure count returns to 0 within the same window. |

---

## Cross-references

- The metric source for §1, §3, §6 (when `assertOwned` rejections are visible in the API logs), §7, and §8 is the **`/ops/event-failures` route** (Phase 16 M8). It is service-role only and is registered in `apps/api/src/routes/ops.ts`.
- The migration contract for §5 is the **18-file set** in `docs/RELEASE_CONTRACTS_v1.0.md` §1. The migration-rehearsal script (M3) is the recovery-side tool.
- The release-time check for every category in this runbook is the **7 M1-in-scope CI stages** + the **22 PRD Appendix A scenarios** in the release checklist (M9).
- The rollback-side companion to this runbook is **`docs/ROLLBACK.md`** (M5). If a category's recovery procedure includes "revert the deploy", follow the build-rollback procedure (M5 R4) and document the deviation in `docs/PHASE16_VERIFICATION.md`.
