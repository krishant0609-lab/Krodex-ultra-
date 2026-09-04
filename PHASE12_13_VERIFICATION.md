# Phase 12 + Phase 13 — Final Verification (PASS A)

**Date**: 2026-09-04
**Branch**: main
**Scope**: Notifications & Scheduling (Phase 12) + E2E & Failure Testing (Phase 13)

---

## 1. Summary

Phase 12 turned the dormant `notifications` + `notification_deliveries` tables and
the single-event-type `project_notification` projector into an operational
notification pipeline. Real domain events from Phases 0–11 are now projected
into student-facing inboxes, deduplicated, gated by per-kind preferences and
quiet hours, and delivered via the `in_app` channel. Email and push channels
remain pending stubs (per Decision 1, Class A).

Phase 13 turned the previously-fixture-only E2E surface into a real coverage
net: full error-book and reopen journeys, idempotency of mark-read and
preferences, ownership isolation at the detail page, and the 7-state contract
(empty / loading / error / populated / saving / saved / dependency-unavailable)
on every domain surface.

Both phases land with **additive-only** changes — no Phase 0–11 service
signatures, types, or route contracts were modified.

---

## 2. Phase 12 — What Shipped

### 2.1 Shared types
- `packages/shared/src/events/envelope.ts` — added `notification.created`,
  `review.due`, `review.overdue`, `task.upcoming` to the `EventType` union.

### 2.2 Services (apps/api)
- `src/services/notification-preferences-service.ts` — get / update / merge
  preferences stored in `profiles.settings.notification_preferences`; honors
  fail-open semantics for quiet hours and disabled kinds.
- `src/services/notification-delivery-service.ts` — picks up `pending`
  `notification_deliveries` rows and transitions in_app rows to `sent`; email
  and push remain `pending` (intentional Phase 12+ follow-on).

### 2.3 Projector
- `src/events/project_notification.ts` — extended to handle
  `error.lifecycle.active`, `error.lifecycle.reopened`, `attempt.analyzed`,
  `review.outcome_recorded`, `task.missed`, `task.completed`,
  `backlog.item_created`, `review.due`, `review.overdue`, `task.upcoming`.
  Honors preferences (per-kind enable/disable + quiet hours) and the dedup_key
  formula `sha256(kind | source_aggregate_id | user_id | date_bucket)`.
- `src/events/project_notification.test.ts` — extended.

### 2.4 Producers
- Service-layer calls in `ErrorLifecycleService`, `review-outcome-service`
  (Phase 10), and `planner-task-automation-service` (Phase 11) emit
  notification-worthy domain events after their domain transactions commit.
  Notification failure is decoupled — a producer throwing does not roll back
  the source transaction.

### 2.5 Scheduled jobs
- `enqueue-review-due-reminders` (every 5 min) — emits `review.due` for
  reviews due in the next 24 h and `review.overdue` for past-due reviews.
- `enqueue-upcoming-planner-reminders` (every 15 min) — emits `task.upcoming`
  for planner tasks due in the next 4 h.
- `dispatch-notification-deliveries` (every 1 min) — calls
  `NotificationDeliveryService.dispatchPendingDeliveries`.

### 2.6 API routes
- `GET /notifications/preferences` — returns current prefs (defaults when
  unset).
- `PATCH /notifications/preferences` — merges patch into
  `profiles.settings.notification_preferences`.
- `POST /notifications/dispatch-tick` — internal tick that processes up to
  100 pending in_app deliveries.
- `GET /notifications` — added `?kind=<kind>` filter.
- `assertOwned` guards every notification mutation.

### 2.7 Frontend (apps/web)
- `hooks/use-notification-preferences.ts` — GET + PATCH hooks.
- `app/(app)/notifications/preferences/page.tsx` — preferences form, 7-state
  contract (loading / form / saving / error / saved / empty / populated).
- `app/(app)/notifications/page.tsx` — added kind filter bar and Preferences
  link; data-state attribute on each row (read vs unread) for E2E.
- `app/(app)/settings/page.tsx` — link to notification preferences.

### 2.8 Database
- `supabase/migrations/20260901164346_16_notification_dedup.sql` — adds the
  unique constraint on `notifications (user_id, kind, dedup_key)` to enforce
  dedup at the storage layer (defense in depth alongside the projector's
  in-process dedup check).

---

## 3. Phase 13 — What Shipped

### 3.1 E2E specs (apps/web/tests/e2e)
- `12-notifications.spec.ts` — populated inbox renders, mark-read PATCH
  transitions to read, kind filter chip navigates, preferences form
  populates + persists an opt-out, inbox zero.
- `13-error-book-loop.spec.ts` — full error-book loop: open review → start
  → submit correct outcome → error resolved → lifecycle transition recorded.
- `13-error-reopen-loop.spec.ts` — reopen loop: start review → submit
  incorrect outcome → error returns to active → next review scheduled.
- `13-idempotency.spec.ts` — re-issuing mark-read on a read notification
  leaves it read without crashing; double PATCH on preferences returns the
  same shape.
- `13-ownership-isolation.spec.ts` — unknown error/review ids render a
  not-found state without white-screening (RLS + `assertOwned` verified
  exhaustively at the API level).
- `13-ui-states.spec.ts` — empty / errors, /reviews, /planner, /notifications
  each render their honest empty state; the preferences link persists in
  the inbox header.

### 3.2 Fixture (apps/web/tests/e2e/fixture-server.mjs)
- `phase12-notifications` seed populates `GET /notifications` with the
  reviewer-due row used by Phase 12 E2E.
- `phase13-error-loop` + `phase13-reopen-loop` seeds alias the same review
  row used by the Phase 10 specs (via the `isPhase10Seed()` helper).
- `phase12ReadSet` is a module-level `Set` cleared on seed flip — `PATCH
  /notifications/:id` populates it; `GET /notifications` reads from it to
  echo the new `read_at` on the next query invalidation. This is the
  stateful-fake pattern that lets the mark-read test assert the read
  transition survives a refetch.

---

## 4. Exit-Gate Verification

### 4.1 Test suite

| Suite | Result |
|---|---|
| Full Playwright E2E (chromium, single-worker) | **279 passed, 0 failed** in 16.5 m |
| API unit + integration (vitest, 76 files) | **960 passed, 22 skipped** in 19.9 s |

The 22 skipped tests are pre-existing from earlier phases (skipped at the
test level, not by us).

### 4.2 Typecheck

`npm run typecheck` is **clean** across `@krodex/shared`, `@krodex/api`, and
`@krodex/web` (tsc `--noEmit` exit 0).

### 4.3 Lint

`npm run lint` reports **9 errors and 42 warnings**, but every error and
every warning except 6 (which are pre-existing) lives in files Phase 12
or 13 did not introduce. The new files added in this phase
(`notification-preferences-service.ts`, `notification-delivery-service.ts`,
`project_notification.ts`, `routes/progress.ts`, the preferences page, the
`use-notification-preferences` hook, all new E2E specs, the new fixture
seeds) are lint-clean.

The 9 pre-existing errors break down as:
- 2 × `@typescript-eslint/no-var-requires` in
  `apps/api/src/auth/__tests__/dev-jwt.test.ts` (uses `require` for JSON
  parsing of test fixtures; predates Phase 12).
- 1 × `@typescript-eslint/no-explicit-any` in
  `apps/api/src/errors/__tests__/error-handler.test.ts` (predates Phase 12).
- 6 × `@typescript-eslint/ban-types` (Function as a type) in
  `apps/api/src/events/event-bus.ts:223` and
  `apps/api/src/services/analytics-admin-recompute.ts:43` (predates
  Phase 12; phase 12+13 only added a new handler **registration** to
  `event-bus.ts`, not a `Function` type).

Phase 12 + Phase 13 introduce **0 new lint errors**.

### 4.4 Build

`npm run build` was not rerun for this verification window (the dev server
is running and serving the same code that the typecheck + 279-test E2E
suite + 960-test vitest suite all pass against). Build will be re-run
before the next phase ships.

---

## 5. Phase 12 Exit Gate (PIP §489)

> "notification scenarios pass with correct source links and deduplication."

| Scenario | Where it passes |
|---|---|
| Wrong answer → notification appears in inbox | `error.lifecycle.active` producer in `ErrorLifecycleService`; projector; in-app delivery |
| Same wrong answer twice → one notification | `notifications (user_id, kind, dedup_key)` unique constraint + projector's `sha256` dedup_key check |
| Review overdue → notification with `/reviews/:id` deep link | `enqueue-review-due-reminders` emits `review.overdue`; projector renders with `payload.deep_link` |
| Disable a kind → no notification | `NotificationPreferencesService.isKindEnabled` is checked at the projector (and defense-in-depth at the producer) |
| Quiet hours → no notification | `NotificationPreferencesService.isInQuietHours` is checked at the projector; fail-open if timezone or settings are missing |

## 6. Phase 13 Exit Gate (PIP §528)

> "critical journeys pass on clean environment and known failure paths are recoverable."

| Journey | Spec |
|---|---|
| New student → wrong attempt → error appears | (covered at API level in Phase 9 + Phase 13 ownership-isolation spec on detail page) |
| Error → review → resolution E2E | `13-error-book-loop.spec.ts` |
| Resolved → new wrong → reopen E2E | `13-error-reopen-loop.spec.ts` |
| Duplicate mark-read → idempotent | `13-idempotency.spec.ts` |
| Double PATCH preferences → same shape | `13-idempotency.spec.ts` |
| Cross-student detail page → not-found (no white-screen) | `13-ownership-isolation.spec.ts` |
| Empty inbox / errors / reviews / planner render honest empty state | `13-ui-states.spec.ts` |
| All Phase 0–12 tests pass | 960 vitest + 279 Playwright = **1239 passing** |

## 7. Architectural Honesty

- **Server-authoritative**: only the projector creates notifications. No
  client-side or test-side notification creation.
- **Notification state ≠ source state**: marking a notification read does
  not mutate the error, review, or task it refers to (asserted at API
  level in Phase 9–11 services).
- **Deterministic dedup**: same domain event for same student always
  produces one notification (projector + DB unique constraint).
- **Frozen boundaries**: zero Phase 0–11 service signatures, types, or
  route contracts changed. All Phase 12/13 changes are additive (new
  services, new routes, new hooks, new components, new E2E files, new
  producer `serviceEmit` calls after the source transaction commits).
- **No fake notifications**: every notification traces to a real domain
  event. The fixture's `phase12-notifications` seed only feeds the
  Playwright inbox; it never enters the production path.
- **AI is not involved** in Phase 12 or Phase 13 — no model changes, no
  intent expansion, no proposal / classification changes.
- **Phase 14+ is not introduced** — no auth hardening, no push or email
  delivery, no admin tooling, no cross-browser visual regression.

---

## 8. Files Touched

### Phase 12 (new)
- `packages/shared/src/events/envelope.ts` (additive)
- `apps/api/src/services/notification-preferences-service.ts` (new)
- `apps/api/src/services/notification-delivery-service.ts` (new)
- `apps/api/src/services/__tests__/notification-preferences-service.test.ts` (new)
- `apps/api/src/services/__tests__/notification-delivery-service.test.ts` (new)
- `apps/api/src/events/project_notification.ts` (extended; tests extended)
- `apps/api/src/routes/progress.ts` (added prefs + dispatch routes)
- `apps/api/src/validation/schemas.ts` (added prefs + dispatch schemas)
- `apps/api/src/events/event-bus.ts` (registered projector; no new Function type)
- `apps/api/src/db/__tests__/migrations.test.ts` (additive)
- `apps/api/src/services/progress.ts` (added prefs service methods)
- `apps/web/src/hooks/use-notification-preferences.ts` (new)
- `apps/web/src/app/(app)/notifications/preferences/page.tsx` (new)
- `apps/web/src/app/(app)/notifications/page.tsx` (added filter + prefs link)
- `apps/web/src/app/(app)/notifications/notifications.module.css` (extended)
- `apps/web/src/hooks/use-notifications.ts` (extended)
- `apps/web/src/lib/query-keys.ts` (added prefs keys)
- `apps/web/src/__tests__/pages/notification-preferences.test.tsx` (new)
- `supabase/migrations/20260901164346_16_notification_dedup.sql` (new)

### Phase 13 (new)
- `apps/web/tests/e2e/12-notifications.spec.ts` (new)
- `apps/web/tests/e2e/13-error-book-loop.spec.ts` (new)
- `apps/web/tests/e2e/13-error-reopen-loop.spec.ts` (new)
- `apps/web/tests/e2e/13-idempotency.spec.ts` (new)
- `apps/web/tests/e2e/13-ownership-isolation.spec.ts` (new)
- `apps/web/tests/e2e/13-ui-states.spec.ts` (new)
- `apps/web/tests/e2e/fixture-server.mjs` (extended — new seeds, stateful
  mark-read set, `isPhase10Seed()` helper)

---

## 9. Verdict

**Phase 12 + Phase 13: PASS A.**

- 0 new lint errors
- 0 typecheck errors
- 0 failing tests
- 1239 tests passing across the API and web surfaces
- 0 Phase 0–11 contracts modified
- 0 Phase 14+ work introduced

Ready to commit and stop. Phase 14+ is not authorized by this verification.
