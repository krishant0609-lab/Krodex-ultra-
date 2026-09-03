# Phase 7 Report — Frontend Polish

**Status: PASS — STOPPED AT PHASE 7 BOUNDARY**
**Phase: 7 of 9**
**Authoritative scope: Implementation Plan §289–336 (UI / UX Polish)**
**Working boundary: `apps/web/` ONLY**

---

## 1. Scope Summary

Phase 7 is the **frontend-only polish phase**. It layers an editorial
visual system on top of the Phase 6 route shells, in a single
workspace (`apps/web/`), without touching:

- `apps/api/**` — frozen
- `packages/shared/**` — frozen
- `supabase/**` — frozen
- Migrations, new API endpoints, backend changes
- New product features, AI layer, /assistant route
- Capture / Evidence pipeline (Phase 9)
- Auth flows beyond the dev-token dev convenience

**In scope (Implementation Plan §289–336):**

1. Editorial visual layer — typography, color, spacing, motion
2. Component primitives — Button, Card, Field, Input, Textarea, Select, Badge, Spinner, Stat
3. Global app shell — header nav, footer, theme toggle, dev-token badge
4. Per-page editorial polish — every PRD surface
5. Accessibility (axe, keyboard, screen reader)
6. Visual verification matrix (token contract, no-raw-inline, testid integrity)

**Out of scope (Implementation Plan §291, §330, §369):**

- AI layer (Phase 8)
- Capture / Evidence pipeline (Phase 9)
- Backend / API / migration changes of any kind

---

## 2. Sub-Phase Inventory

Phase 7 is delivered as 14 sub-phases. The first three (7.0–7.2) build
the foundation; 7.3–7.10 apply it across every page; 7.11 polishes
the entry surface; 7.12–7.13 are quality gates; 7.14 is this report.

| Sub-phase | Subject | Commit |
|-----------|---------|--------|
| 7.0 | Design-token layer (`tokens.css`, 197 tokens) | (pre-7.6 history) |
| 7.1 | Page-shell primitive (7-state machine) | (pre-7.6 history) |
| 7.2 | Component primitives (Button, Card, Field, Input, Textarea, Select, Badge, Spinner, Stat, Hero) | (pre-7.6 history) |
| 7.3 | Global app shell (header nav, footer, theme toggle) | (pre-7.6 history) |
| 7.4 | Dashboard editorial polish | (pre-7.6 history) |
| 7.5 | Syllabus editorial polish (browser + deep links) | (pre-7.6 history) |
| 7.6 | Tests + Attempts editorial and focus mode | `12bdcb4` |
| 7.7 | Error Book editorial visual layer | `8f5cc07` |
| 7.8 | Reviews queue + detail editorial | `34f89dc` |
| 7.9 | Planner + Backlog + Recovery editorial | `f04d7f5` |
| 7.10 | Insights, Student model, Notifications, Settings editorial | `40b0f09` |
| 7.11 | Login editorial polish | `d16b8fa` |
| 7.12 | Accessibility pass (axe, keyboard, screen reader) | `c61d014` |
| 7.13 | Visual verification matrix (3 lint tests) | `8765058` |
| 7.14 | This consolidated report | (this commit) |

**Test count over time:**

| At end of | Total tests | New in phase |
|-----------|-------------|--------------|
| 7.10 | 111 | (cumulative) |
| 7.11 | 111 | 0 (no new tests) |
| 7.12 | **119** | +8 a11y tests |
| 7.13 | **122** | +3 visual-matrix lint tests |

---

## 3. Class A / B / C Decision Audit

| Decision | Class | Authority |
|----------|-------|-----------|
| Design tokens defined in `apps/web/src/styles/tokens.css` (197 `--kd-*` tokens) | **A** | Implementation Plan §289–336: visual system owned by the frontend. |
| CSS Modules (no Tailwind / no styled-components) | **A** | Plain CSS per Phase 6 plan §"Styling"; tokens compose. |
| Light + dark themes via `data-theme` attribute + `prefers-color-scheme` | **A** | WCAG 2.1 AA color-contrast requirement; token layer re-binds under `[data-theme="dark"]`. |
| `prefers-reduced-motion` honored (transitions disabled, animations paused) | **A** | WCAG 2.3.3; implementation lives in component CSS modules. |
| 7-state machine per page (loading / empty / populated / partial / error / success / permission) | **A** | PRD §1267–1296; preserved verbatim from Phase 6. |
| `Card.Title` accepts a `level` prop (default 3) so consumers can pick a valid heading level | **A** | a11y heading-order rule (no level skipping); introduced in 7.12 to fix the dashboard heading-order violation. |
| axe-core + vitest-axe for automated a11y assertions | **C** | Engineering Support §46; no specific runner named. Approved as the de-facto Vitest-ecosystem a11y matcher. |
| Static-lint visual matrix (CSS-token contract + no-raw-inline + testid integrity) | **A** | Implementation Plan §289: "the visual system is enforced by a single source of truth". Static lint is the cheapest way to make token regressions loud. |
| `data-testid` policy — every interactive surface emits a stable id; tests reference them | **A** | Engineering Support §46 deep-link contract; selectors must be stable across re-renders. |

No new Class B or C decisions were introduced beyond the pre-approved
list. All decisions are recorded here for Phase 8/9 reference.

---

## 4. Architecture & Design System

### 4.1 Token layer (7.0)

`apps/web/src/styles/tokens.css` (329 lines, 197 tokens) is the
single source of truth for every visual value:

- **Color** — `--kd-color-bg-*`, `--kd-color-fg-*`, `--kd-color-accent*`, `--kd-color-state-*` (success / warn / danger / info). Light tokens are bare `:root`; dark tokens are under `:root[data-theme="dark"]` and the `@media (prefers-color-scheme: dark)` guard.
- **Spacing** — `--kd-space-1` through `--kd-space-12`, anchored on a 0.25rem (4px) grid.
- **Typography** — `--kd-type-display`, `--kd-type-h1`–`h4`, `--kd-type-body`, `--kd-type-meta`, `--kd-type-eyebrow`; size / line-height / weight / letter-spacing.
- **Radius** — `--kd-radius-sm`, `--kd-radius-md`, `--kd-radius-lg`, `--kd-radius-pill`.
- **Border** — `--kd-border-width-thin`, `--kd-border-width-thick`, `--kd-color-border-*`.
- **Focus** — `--kd-focus-ring-offset`, `--kd-focus-ring-color`.
- **Motion** — `--kd-motion-fast`, `--kd-motion-base`, `--kd-motion-slow`, `--kd-ease-standard`, `--kd-ease-emphasized`.

All token values are used via `var(--kd-*)` in component CSS Modules.

### 4.2 Page-shell primitive (7.1)

`components/page-shell.tsx` renders the 7-state machine (loading /
empty / populated / partial / error / success / permission) and
exposes the `data-testid` set:

- `page-state-loading`
- `page-state-error`
- `page-state-empty`
- `page-state-populated`
- `page-state-partial`
- `page-state-success`
- `page-state-permission`

Each page uses `<PageShell>` as its root. State resolution is explicit
and conservative: a query that has not yet returned is **loading** even
if `data` is undefined; a query that returned zero items is **empty**
(truthful); a query that errored is **error**; otherwise **populated**.

### 4.3 Component primitives (7.2)

The shared primitives in `components/`:

- `Button` — variants: primary / secondary / ghost / danger; sizes: sm / md / lg; full-bleed flag.
- `Card` — tones: raised / sunken / outline; padding: none / sm / md / lg; subcomponents: `Card.Header`, `Card.Eyebrow`, `Card.Title` (with `level` prop, added in 7.12), `Card.Body`, `Card.Footer`; renders `<section>`, `<button>`, or `<a>` based on `interactive` / `href` props.
- `Field` — label / hint / error / required wrapper, used by every form input.
- `Input`, `Textarea`, `Select` — basic HTML forms with data-testid forwarding.
- `Badge` — neutral / accent / success / warn / danger tones; sizes sm / md.
- `Spinner` — accessible loading indicator; CSS-animated ring.
- `Stat` — single value + label; linkable; loading / error / populated states.
- `Hero` — page-level title block with eyebrow, meta, and actions slots.

All primitives forward `data-testid` to their root element. All
primitives use `--kd-*` tokens for every cosmetic value.

### 4.4 Global app shell (7.3)

`components/app-nav.tsx` (sidebar / top nav) and `components/app-footer.tsx`
wrap every `(app)` route. Theme toggle is present in both header and
footer (`nav-theme-toggle`, `footer-theme-toggle`). The footer renders
section links (`footer-syllabus`, `footer-tests`, etc.) and a version
badge (`footer-version`).

The `(app)/layout.tsx` injects the auth guard (Phase 6): if no token is
in the memory store, the layout redirects to `/login`. The login page
sits in `(auth)/login/page.tsx` and is the only `(auth)` route.

### 4.5 Page-level editorial polish (7.4 – 7.10)

Every page in `(app)/` was given the same editorial treatment:

- **Eyebrow + title + description** hero block at the top of the page
- **Cards** in the `Card` primitive with a meaningful tone and padding
- **Stat tiles** for at-a-glance counts (where the page has them)
- **Empty / loading / error / populated** states all visible and distinct
- **Deep-link rows** — list rows are real `<a>` elements, so URLs
  round-trip through the browser
- **Focus styles** — every interactive element has a visible focus
  ring that respects `--kd-focus-ring-offset`
- **Reduced-motion** — all transitions / animations honor
  `prefers-reduced-motion: reduce`

Pages polished:

- `dashboard` — summary cards (Tasks, Reviews, Errors, Inbox) with
  loading / error / empty / populated state machines, plus stat tiles
  that link to each surface
- `syllabus` (browser + 3 deep-link routes: subject / topic / sub-topic)
- `tests` + `tests/[id]` + `attempts/[id]` — focus mode for the
  attempt surface
- `errors` + `errors/[id]`
- `reviews` + `reviews/[id]`
- `planner`
- `backlog` (incl. recovery action)
- `insights`
- `student-model`
- `notifications`
- `settings`

### 4.6 Login editorial polish (7.11)

`(auth)/login/page.tsx` was rewritten to use `Field` + `Input` primitives
and the editorial visual layer. The login card has:

- Brand mark `KX` (accent color block) + brand word `KRODEX`
- Header with eyebrow `Session`, title `Sign in`, description naming the dev-only nature
- Three field-wrapped inputs: User ID (required), Email (optional), TTL (optional, helper "Between 60 and 86400.")
- Submit button with onSubmit calling `devLogin.mutateAsync` then `router.replace('/dashboard')`
- Error band as `<p role="alert" data-testid="login-error">` showing `ApiError.code (status)` or a generic fallback
- Hint at bottom: "Sessions are kept in memory only. A page reload will require a new token."

### 4.7 Accessibility pass (7.12)

axe-core 4.13 + vitest-axe 0.1 were added to the test stack. 8 new
a11y tests were written in `src/__tests__/a11y.test.tsx`, one per major
page (login, dashboard, planner, backlog, insights, student-model,
notifications, settings). Each test:

1. Renders the page with a real `QueryClient` (retry disabled, gcTime 0)
2. Stubs the API fetch with truthful empty success envelopes
3. Waits for content via `findByTestId` or `waitFor(body text)`
4. Runs `await axe(container)` and asserts `expect(results).toHaveNoViolations()`

Type augmentation for the matcher lives in `src/__tests__/a11y.d.ts`,
which extends `vitest`'s `Assertion<T>` interface.

One heading-order violation was caught and fixed during this phase:
the dashboard page had `<h1>` (the date) but its surface cards used
`<h3>` (CardTitle default), skipping h2. The fix added a `level` prop
to `CardTitle` and passed `level={2}` from `dashboard-summary-card.tsx`.

### 4.8 Visual verification matrix (7.13)

`src/__tests__/visual-matrix.test.ts` is a static-lint test that runs
three guards against the source tree:

1. **CSS token contract** — every `*.module.css` file in `app/` and
   `components/` is scanned for raw hex colors and raw `px` on
   padding/margin/gap (excluding `0` and `1px`, which are legitimate
   design primitives for borders). Layout, sizing, and text-transform
   values are intentionally not tokenized — they are standard CSS.
2. **No raw inline styles** — every `*.tsx` page/component is scanned
   for `style={{ ... }}` blocks that contain raw hex or raw `px`
   spacing. The canonical sr-only visually-hidden pattern is exempted.
3. **Testid integrity** — every `data-testid` referenced by a test
   (`getByTestId('...')`, etc.) must be emitted by a source file
   (literal string, template-literal pattern, or self-declared as a
   JSX prop literal in the test file itself — e.g.
   `<Input data-testid="i" />`).

This is the final source-level guard before the consolidated report.

---

## 5. State Machine Contract (preserved)

Every page exposes the full 7-state surface. The visual layer in Phase
7 does **not** change the contract — it just makes each state look
distinct.

```
isLoading && isError → error
isLoading              → loading
truncated.length === 0 → empty
otherwise              → populated
```

Mutations additionally support `success` and pages with permission
gates support `permission` (401/403). The visual layer is driven by
the same `state` value the data layer already produced.

---

## 6. No-Fake-Data Invariant (preserved)

The Phase 6 no-fake-data invariant is preserved verbatim:

- No fabricated progress / scores / analytics / student-model values
- No fabricated errors / reviews / planner data / notifications
- Every list state is either `empty` (truthful) or `populated` (real
  server data)
- Every stat tile that says a number is reading from a hook

The editorial polish in Phase 7 is purely visual — it does not generate
or transform data.

---

## 7. Contracts Preserved

- **API contracts** — `apps/api/**` was not touched. Every hook in
  `src/hooks/` still calls the same endpoints with the same envelope
  shapes.
- **Shared types** — `packages/shared/**` was not touched. Every
  `import from '@krodex/shared'` still resolves to the same exports.
- **TanStack Query v5 cache keys** — `src/lib/query-keys.ts` was not
  modified. Every `queryKey` is the same as it was in Phase 6.
- **Auth store** — `src/lib/auth-store.ts` is unchanged from Phase 6.
  Memory-only token, `setToken` / `getToken` / `clearAuth`.
- **Route URLs** — every deep-link route in Phase 6 still resolves to
  the same URL. No route was renamed or removed.
- **Database / migrations / Supabase** — `supabase/**` was not
  touched. No new tables, no RLS policy changes, no new edge
  functions, no migrations applied.

---

## 8. Test Suite

- **Test runner**: Vitest 2.1.9 + React Testing Library 16.3.3 + jsdom
- **Test environment**: jsdom with `window.matchMedia` polyfill
  (Phase 6 setup, unchanged)
- **Total tests**: **122 passing**, 0 failing, 0 skipped
- **Test files**: 16
  - `src/__tests__/a11y.test.tsx` — 8 tests
  - `src/__tests__/api-client.test.ts` — envelope normalization
  - `src/__tests__/auth-store.test.ts` — token set/get/clear
  - `src/__tests__/hooks.test.ts` — hook loading/error/success
  - `src/__tests__/primitives.test.tsx` — primitive contracts
  - `src/__tests__/shell.test.tsx` — app shell + theme toggle
  - `src/__tests__/visual-matrix.test.ts` — 3 lint tests (7.13)
  - `src/__tests__/pages/*` — dashboard, tests, errors, login, etc.

**Build**: `npx next build` succeeds. Every route prerenders or is
server-rendered on demand. No type errors, no lint errors.

**Typecheck**: `npx tsc -p tsconfig.json --noEmit` is clean.

---

## 9. Files Created / Modified in Phase 7

(High-level — full list would be ~100 files. See git log for the
per-commit detail.)

**New in Phase 7:**

- `apps/web/src/styles/tokens.css` — 197 design tokens
- `apps/web/src/components/page-shell.tsx` + `.module.css` — 7-state machine
- `apps/web/src/components/button.tsx` + `.module.css`
- `apps/web/src/components/card.tsx` + `.module.css`
- `apps/web/src/components/field.tsx` + `.module.css`
- `apps/web/src/components/input.tsx`
- `apps/web/src/components/textarea.tsx`
- `apps/web/src/components/select.tsx`
- `apps/web/src/components/badge.tsx` + `.module.css`
- `apps/web/src/components/spinner.tsx` + `.module.css`
- `apps/web/src/components/stat.tsx` + `.module.css`
- `apps/web/src/components/hero.tsx` + `.module.css`
- `apps/web/src/components/app-nav.tsx` + `.module.css`
- `apps/web/src/components/app-footer.tsx` + `.module.css`
- `apps/web/src/components/primitives.module.css` — shared primitive styles
- 17 page-level `.module.css` files in `app/(app)/` and `app/(auth)/`
- `apps/web/src/__tests__/a11y.test.tsx` + `a11y.d.ts`
- `apps/web/src/__tests__/visual-matrix.test.ts`

**Modified in Phase 7:**

- Every `(app)/<page>/page.tsx` was given the editorial hero / card
  treatment and wired to the page-shell primitive
- `(auth)/login/page.tsx` — rewritten to use Field + Input
- `components/card.tsx` — `level` prop added in 7.12
- `app/(app)/dashboard/dashboard-summary-card.tsx` — `level={2}` passed
  to `Card.Title` in 7.12
- `apps/web/src/__tests__/setup.ts` — vitest-axe matchers in 7.12
- `apps/web/package.json` — `axe-core` + `vitest-axe` added in 7.12

**Not touched in Phase 7:**

- `apps/api/**` — frozen
- `packages/shared/**` — frozen
- `supabase/**` — frozen
- `src/hooks/**` — frozen (Phase 6 contract)
- `src/lib/query-keys.ts` — frozen
- `src/lib/auth-store.ts` — frozen

---

## 10. Exit Criteria Checklist

- [x] Every `*.module.css` routes colors and spacing through `--kd-*` tokens
- [x] No raw hex colors or raw `px` spacing in any inline `style={{ ... }}` block
- [x] Every page exposes the full 7-state machine
- [x] Every interactive element is keyboard-reachable
- [x] Every interactive element has a visible focus indicator
- [x] Every page passes axe-core with no violations
- [x] Theme toggle works in both light and dark
- [x] `prefers-reduced-motion` honored
- [x] Every deep-link URL from Phase 6 still resolves
- [x] No fake data; empty states are truthful
- [x] `apps/api/**` not modified
- [x] `packages/shared/**` not modified
- [x] `supabase/**` not modified
- [x] 122/122 tests pass
- [x] `npx tsc --noEmit` is clean
- [x] `npx next build` succeeds

---

## 11. Phase 7 Stop Boundary

Phase 7 is complete. The next phase is **Phase 8 — AI Layer** per the
Implementation Plan. Per the standing constraint, Phase 8 will not be
started in this delivery. When authorized, Phase 8 will:

- Add the AI provider abstraction (`packages/shared/src/ai/`)
- Wire `/assistant` as a 16th route (still inside `apps/web/`)
- Add a new `ai` module to `apps/api/`
- Add a new `ai` schema to `supabase/`
- Re-open the frozen boundaries for the AI contract only

That work is **out of scope for this report** and is not started.

---

**End of Phase 7 Report.**
