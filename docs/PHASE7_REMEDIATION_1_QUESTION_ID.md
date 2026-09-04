# Phase 7 — Remediation #1: Attempt Question-ID Integrity

**Status: PASS — REMEDIATION COMPLETE, STOPPED AT PHASE 7 BOUNDARY**
**Scope: `apps/web/` ONLY — `apps/api/`, `packages/shared/`, `supabase/` frozen**
**Authoritative contract: Phase 6 hooks + query keys; no new API endpoints, no backend changes, no fabricated identifiers**

---

## 1. Root Cause

`apps/web/src/app/(app)/attempts/[id]/page.tsx` synthesized a
client-side `question_id` and submitted it to
`POST /tests/attempts/:id/answers`. The pattern was structurally
equivalent to:

```ts
question_id: `${attemptId}-q${questionIndex + 1}`
```

This is fabricated data being submitted to a server as a real
identifier, in violation of the no-fake-data invariant. The
authoritative `question_id` is already available in the application —
it is returned by the Phase 6 endpoint `GET /tests/:id/questions`
(cached in TanStack Query via `useTestQuestions(testId)`) — but the
attempt page was not consuming that list.

Secondary issue: the same page rendered a "Focus mode" headline that
was an invented product label, not supported by the PRD / TRD / Phase 6
contract. The legitimate single-question reader visual contract was
preserved (distraction-free, single column, no decorative accent /
motion / shimmer, gated critical learning action); only the invented
product label was removed.

---

## 2. Exact Files Changed

```
 M apps/web/src/app/(app)/attempts/[id]/page.tsx
 M apps/web/src/__tests__/pages/attempts.test.tsx
```

No other files in `apps/web/**` were modified. Verified by
`git status --short apps/web` — only the two files above.

`apps/api/**`, `packages/shared/**`, `supabase/**` — verified
unmodified by `git status --short apps/api packages/shared supabase`
(output: empty).

No `package.json` change, no new dependency added, no lockfile change.

---

## 3. Behavior — Before / After

### Before

- Attempt page loaded `attempt` and `answers` only.
- On each step, the page built `question_id` from the attempt id
  and a 1-based step counter, e.g. `att-123-q1`, `att-123-q2`.
- That synthetic value was POSTed to `/tests/attempts/:id/answers`.
- Headline read "Focus mode" — a product label not in the governing
  specs.
- If the questions list was missing or in an unexpected state, the
  page would happily submit another synthetic id and fail server-side
  with a 4xx the user could not act on.

### After

- Attempt page additionally loads `useTestQuestions(testId)` — the
  Phase 6 hook that returns the authoritative `TestQuestionRow[]`
  for the bound test.
- The list is sorted by `display_order` ascending. The current step's
  authoritative id is `orderedQuestions[recordedAnswers.length]?.question_id`.
- The submit handler **fails closed** if the authoritative id is
  unavailable: `if (!authoritativeQuestionId) return;`
- The submit button is **disabled** while the questions query is
  loading, while it has errored, and while the index is past the end
  of the list.
- The page surfaces honest inline states for each failure mode:
  - `attempt-focus-loading` — questions query still loading.
  - `attempt-focus-questions-error` — questions query errored.
  - `attempt-focus-no-id` — index is past the list (test has fewer
    attached questions than the attempt claims).
  - `attempt-focus-no-test` — attempt is not bound to any test.
- Headline now reads one of the honest attempt states: "Attempt in
  progress", "Submitted", "Timed out", "Abandoned", or "Attempt". The
  invented "Focus mode" label is gone.
- Legitimate attempt-mode visual contract preserved: distraction-free,
  single column, no decorative accent, no decorative motion, no
  shimmer, critical learning actions wait for server acknowledgement.

---

## 4. Tests Added

`apps/web/src/__tests__/pages/attempts.test.tsx` — total of 9 tests,
of which 5 are new regression tests proving the integrity contract:

1. **Renders the next-question step with the first question** —
   existing happy-path rendering, updated to expect the new labels.
2. **Submits a free-text answer with the authoritative question_id
   and advances** — captures the `question_id` submitted to
   `POST /tests/attempts/:id/answers` and asserts it equals
   `q-authoritative-1`. **NEW REGRESSION.**
3. **Submits the second authoritative id on the second step** —
   same capture + assertion for the second recorded answer. **NEW
   REGRESSION.**
4. **Renders the closed state for a submitted attempt.**
5. **Renders the error state when the attempt id is unknown.**
6. **Submits the attempt and shows the success band.**
7. **Disables the form when the questions query failed and submits
   nothing** — `questions: 'error'` route variant; asserts
   `attempt-focus-questions-error` is present, submit is disabled,
   and `submittedQuestionIds` is empty. **NEW REGRESSION.**
8. **Disables the form when the questions list is empty (out of
   range)** — `questions: 'empty'` route variant; asserts
   `attempt-focus-no-id` is present. **NEW REGRESSION.**
9. **Never submits a question_id containing the attempt id
   (regression)** — explicit guard:
   `expect(submittedQuestionIds.some((id) => id.startsWith(ATTEMPT_ID + '-q'))).toBe(false)`.
   **NEW REGRESSION.**

The regression suite also fixes a pre-existing esbuild parser quirk
in the `failure` helper by extracting the inline return type to a
named `FailureBody` alias — without that fix, the test file would
not transform.

---

## 5. Test Results

Run from `apps/web/` (the working directory whose `vitest.config.ts`
applies the jsdom environment):

```
$ cd apps/web && npx vitest run

 Test Files  16 passed (16)
      Tests  126 passed (126)
   Duration  12.43s
```

All 126 tests across 16 files pass. The 9 attempts tests pass,
including all 5 new regression tests.

Stderr noise in the run is environmental, not failures:
- `axe-core` calls `HTMLCanvasElement.prototype.getContext` while
  measuring color contrast in jsdom (no `canvas` package installed).
  This is a pre-existing known limitation of axe-core + jsdom.
- A handful of `act()` warnings from background query refetches
  after test cleanup. Pre-existing, no test changes needed.

---

## 6. Other Verification

### TypeScript

```
$ npx tsc -p apps/web/tsconfig.json --noEmit
```

No output. Clean.

### Lint

```
$ npx eslint apps/web/src
```

0 errors. 3 pre-existing warnings (unrelated to this remediation:
`a11y.d.ts` unused `T` type parameter, `syllabus/page.tsx` useMemo
dep-shape, `lib/theme.tsx` unused `STORAGE_KEY`).

### Next build

```
$ cd apps/web && npx next build
```

Build successful. All 18 routes compiled. The only matches for
"error" in the build log are route name fragments, not build errors.

### Frozen directories

```
$ git status --short apps/api packages/shared supabase
(empty output)
```

`apps/api/**`, `packages/shared/**`, and `supabase/**` are
completely untouched. No migrations, no new endpoints, no shared-type
changes, no backend or schema changes.

---

## 7. Constraints Honored

- ✅ apps/web/** only — 2 files modified, both inside the working
  boundary.
- ✅ apps/api/** frozen — verified by `git status`.
- ✅ packages/shared/** frozen — verified by `git status`.
- ✅ supabase/** frozen — verified by `git status`.
- ✅ No migrations, no new API endpoints, no backend changes.
- ✅ No invented backend behavior; the page uses only the Phase 6
  `useTestQuestions(testId)` hook (already returns
  `TestQuestionRow[]` from `GET /tests/:id/questions`).
- ✅ No workaround that fabricates identifiers — submit is gated
  on the authoritative id being present, and fails closed otherwise.
- ✅ No redesign of unrelated Phase 7 UI — only the attempt page
  was modified.
- ✅ No visual-regression work begun.
- ✅ No a11y coverage expansion begun.
- ✅ No Phase 8 work begun.
- ✅ 7-state contract (loading, empty, error, populated, success,
  permission) still honored — the page now adds honest inline
  sub-states for the questions query so the user can tell what is
  blocking submission.
- ✅ STOPPED after this remediation.

---

## 8. Summary

A fabricated `question_id` was being submitted to a real API from the
attempt page. The authoritative id was already available via an
existing Phase 6 hook. The page now consumes that hook, fails closed
when the hook is loading / errored / out-of-range, and renders honest
inline error messages for each failure mode. 5 new regression tests
prove the integrity contract, and all 126 tests in the web test
suite pass. TypeScript is clean, lint reports 0 errors, and the
Next build succeeds. No frozen directory was touched.
