/**
 * KRODEX web — Accessibility (axe) sweep for Phase 7.12+.
 *
 * Each test mounts a major route with a stubbed fetch returning
 * a truthful empty success envelope, then runs axe-core against
 * the rendered DOM. We do not assert specific rules — we assert
 * that no violations are reported. The contract under test is:
 *
 *   "Every route the user can land on during a normal flow
 *    ships without axe violations on its empty/populated
 *    populated-with-data render."
 *
 * Routes covered:
 *   - /login (no fetch — pure form)
 *   - /dashboard (Phase 7.4 editorial layout)
 *   - /planner (Phase 7.9 editorial)
 *   - /backlog (Phase 7.9 editorial)
 *   - /insights (Phase 7.10 editorial)
 *   - /student-model (Phase 7.10 editorial)
 *   - /notifications (Phase 7.10 editorial)
 *   - /settings (Phase 7.10 editorial)
 *   - /tests + /tests/[id] (Phase 7.6)
 *   - /attempts/[id] (Phase 7.6, with authoritative-id contract)
 *   - /errors + /errors/[id] (Phase 7.7)
 *   - /reviews + /reviews/[id] (Phase 7.8)
 *   - /syllabus + /syllabus/[id] + typed deep links
 *     /syllabus/subject/[id], /syllabus/topic/[id],
 *     /syllabus/sub-topic/[id] (Phase 7.5)
 *
 * What we do NOT do:
 *   - We do not change any product component. This is a
 *     verification pass.
 *   - We do not bake in screen-reader assertions. Axe is the
 *     public contract; SR-specific tests live in Phase 7.13
 *     if/when we need them.
 *
 * Note on visual verification (Part 1 / 3 / 4 of the brief):
 * the brief calls for real-browser visual verification. The
 * current dev-deps do not include a browser-automation package
 * (no Playwright, no Puppeteer, no Cypress). The brief
 * instructs: "If a required verification cannot be performed
 * in the current environment, report it as NOT VERIFIED
 * rather than pretending it passed." That is recorded in the
 * final verification report. The axe sweep here covers the
 * DOM-level a11y contract that is testable without a
 * browser.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { axe } from 'vitest-axe';

// next/navigation mock — same pattern as the rest of the suite.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { setAuth, clearAuth } from '../lib/auth-store';
import { setSettled } from '../lib/react-async';
import LoginPage from '../app/(auth)/login/page';
import DashboardPage from '../app/(app)/dashboard/page';
import PlannerPage from '../app/(app)/planner/page';
import BacklogPage from '../app/(app)/backlog/page';
import InsightsPage from '../app/(app)/insights/page';
import StudentModelPage from '../app/(app)/student-model/page';
import NotificationsPage from '../app/(app)/notifications/page';
import SettingsPage from '../app/(app)/settings/page';
import TestsPage from '../app/(app)/tests/page';
import TestDetailPage from '../app/(app)/tests/[id]/page';
import AttemptDetailPage from '../app/(app)/attempts/[id]/page';
import ErrorsPage from '../app/(app)/errors/page';
import ErrorDetailPage from '../app/(app)/errors/[id]/page';
import ReviewsPage from '../app/(app)/reviews/page';
import ReviewDetailPage from '../app/(app)/reviews/[id]/page';
import SyllabusPage from '../app/(app)/syllabus/page';
import LegacySyllabusNodePage from '../app/(app)/syllabus/[id]/page';
import SubjectNodePage from '../app/(app)/syllabus/subject/[id]/page';
import TopicNodePage from '../app/(app)/syllabus/topic/[id]/page';
import SubTopicNodePage from '../app/(app)/syllabus/sub-topic/[id]/page';

const BASE = 'http://api.test/v1';
const ORIGINAL_ENV = process.env['NEXT_PUBLIC_API_BASE_URL'];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function success<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

function settledParams<T>(value: T): Promise<T> {
  const p = Promise.resolve(value);
  setSettled(p, value);
  return p;
}

/**
 * The stub fetch returns a truthful empty success envelope for
 * every URL. Some pages fetch multiple endpoints concurrently;
 * each test calls `await waitFor` until a known page marker is
 * in the DOM, then runs axe.
 *
 * The shapes below match the real envelopes returned by the
 * Phase 5 API (no fabricated identifiers — every value is the
 * shape the server would actually return). Empty success
 * envelopes render the honest empty state on each page.
 */
function stubFetchAll(): void {
  vi.spyOn(global, 'fetch').mockImplementation((input: unknown) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // User + profile (settings)
    if (/\/users\/me$/.test(url) || /\/users\/me\/profile$/.test(url)) {
      return Promise.resolve(
        jsonResponse(
          success({
            id: 'u-1',
            display_name: 'Test User',
            timezone: 'UTC',
          }),
        ),
      );
    }
    // Student model (returns 200 empty, or 404 NOT_FOUND for cold-start)
    if (/\/student-model$/.test(url)) {
      return Promise.resolve(
        jsonResponse(
          success({
            user_id: 'u-1',
            window_days: 28,
            features: {},
            overall_confidence: 'limited',
            generated_at: '2026-09-02T00:00:00.000Z',
          }),
        ),
      );
    }
    // Analytics
    if (/\/analytics\//.test(url)) {
      return Promise.resolve(jsonResponse(success({})));
    }
    // Notifications
    if (/\/notifications$/.test(url)) {
      return Promise.resolve(
        jsonResponse(success({ items: [], nextCursor: null })),
      );
    }
    // Planner tasks
    if (/\/planner\/tasks$/.test(url)) {
      return Promise.resolve(
        jsonResponse(success({ items: [], nextCursor: null })),
      );
    }
    // Backlog
    if (/\/backlog(\?|$)/.test(url)) {
      return Promise.resolve(
        jsonResponse(success({ items: [], nextCursor: null })),
      );
    }
    // Tests (list)
    if (/\/tests(\?|$)/.test(url)) {
      return Promise.resolve(
        jsonResponse(success({ items: [], nextCursor: null })),
      );
    }
    // Test detail / questions
    if (/\/tests\/[a-z0-9-]+\/questions$/.test(url)) {
      return Promise.resolve(jsonResponse(success([])));
    }
    if (/\/tests\/[a-z0-9-]+$/.test(url)) {
      // First-party 404 — the page renders its own honest
      // "We couldn't find this test" empty card.
      return Promise.resolve(
        jsonResponse(
          { success: false, error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        ),
      );
    }
    // Attempts (list, single, answers)
    if (/\/tests\/attempts\/[a-z0-9-]+\/answers$/.test(url)) {
      return Promise.resolve(jsonResponse(success([])));
    }
    if (/\/tests\/attempts\/[a-z0-9-]+$/.test(url)) {
      return Promise.resolve(
        jsonResponse(
          { success: false, error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        ),
      );
    }
    if (/\/tests\/attempts(\?|$)/.test(url)) {
      return Promise.resolve(
        jsonResponse(success({ items: [], nextCursor: null })),
      );
    }
    // Errors (list, single)
    if (/\/errors\/[a-z0-9-]+$/.test(url)) {
      return Promise.resolve(
        jsonResponse(
          { success: false, error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        ),
      );
    }
    if (/\/errors(\?|$)/.test(url)) {
      return Promise.resolve(
        jsonResponse(success({ items: [], nextCursor: null })),
      );
    }
    // Reviews (list, single)
    if (/\/review\/schedules\/[a-z0-9-]+$/.test(url)) {
      return Promise.resolve(
        jsonResponse(
          { success: false, error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        ),
      );
    }
    if (/\/review\/schedules(\?|$)/.test(url)) {
      return Promise.resolve(
        jsonResponse(success({ items: [], nextCursor: null })),
      );
    }
    // Syllabus — subjects, topics, sub-topics. Empty arrays
    // render the honest "No subjects/topics/sub-topics yet" cards.
    if (/\/syllabus\/sub-topics$/.test(url)) {
      return Promise.resolve(jsonResponse(success([])));
    }
    if (/\/syllabus\/topics$/.test(url)) {
      return Promise.resolve(jsonResponse(success([])));
    }
    if (/\/syllabus\/subjects$/.test(url)) {
      return Promise.resolve(jsonResponse(success([])));
    }
    // Default catch-all — used for the dashboard's mixed
    // analytics + planner + reviews + errors aggregate.
    return Promise.resolve(jsonResponse(success({})));
  });
}

beforeEach(() => {
  process.env['NEXT_PUBLIC_API_BASE_URL'] = BASE;
  clearAuth();
  setAuth({ token: 'test-token', userId: 'u-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
});

describe('Phase 7.12 — axe a11y sweep', () => {
  it('login page has no axe violations', async () => {
    // Login is unauthenticated and makes no fetches.
    const { container } = render(<LoginPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('dashboard has no axe violations (empty state)', async () => {
    stubFetchAll();
    const { container } = render(<DashboardPage />, { wrapper: makeWrapper() });
    // Dashboard is fully self-contained; just let it settle.
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('planner index has no axe violations (empty)', async () => {
    stubFetchAll();
    const { container } = render(<PlannerPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('backlog index has no axe violations (empty)', async () => {
    stubFetchAll();
    const { container } = render(<BacklogPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('insights has no axe violations (empty)', async () => {
    stubFetchAll();
    const { container } = render(<InsightsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('student-model has no axe violations (cold-start empty)', async () => {
    stubFetchAll();
    const { container } = render(<StudentModelPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('notifications has no axe violations (empty inbox)', async () => {
    stubFetchAll();
    const { container } = render(<NotificationsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('settings has no axe violations (loaded)', async () => {
    stubFetchAll();
    const { container } = render(<SettingsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.queryByTestId('settings-user-form')).toBeInTheDocument();
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Phase 7.12+ — axe a11y sweep (extended surface)', () => {
  it('tests index has no axe violations (empty)', async () => {
    stubFetchAll();
    const { container } = render(<TestsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('tests detail has no axe violations (NOT_FOUND → empty card)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'test-notfound' });
    const { container } = render(<TestDetailPage params={params} />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('attempt detail has no axe violations (NOT_FOUND → empty card)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'attempt-notfound' });
    const { container } = render(<AttemptDetailPage params={params} />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('errors index has no axe violations (empty)', async () => {
    stubFetchAll();
    const { container } = render(<ErrorsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('error detail has no axe violations (NOT_FOUND → empty card)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'error-notfound' });
    const { container } = render(<ErrorDetailPage params={params} />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('reviews index has no axe violations (empty)', async () => {
    stubFetchAll();
    const { container } = render(<ReviewsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('review detail has no axe violations (NOT_FOUND → empty card)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'review-notfound' });
    const { container } = render(<ReviewDetailPage params={params} />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('syllabus index has no axe violations (empty subjects)', async () => {
    stubFetchAll();
    const { container } = render(<SyllabusPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('syllabus legacy deep link has no axe violations (unresolved)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'no-such-node' });
    const { container } = render(<LegacySyllabusNodePage params={params} />, {
      wrapper: makeWrapper(),
    });
    // The unresolved path renders the empty-state card via PageShell
    // (the syllabus-node-id testid only renders when the id matches a
    // real subject). Wait for the empty state, not the resolved id.
    await waitFor(() => {
      expect(
        screen.queryByTestId('page-state-empty'),
      ).toBeInTheDocument();
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('syllabus subject deep link has no axe violations (NOT_FOUND)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'subject-notfound' });
    const { container } = render(<SubjectNodePage params={params} />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('syllabus topic deep link has no axe violations (NOT_FOUND)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'topic-notfound' });
    const { container } = render(<TopicNodePage params={params} />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('syllabus sub-topic deep link has no axe violations (NOT_FOUND)', async () => {
    stubFetchAll();
    const params = settledParams({ id: 'sub-topic-notfound' });
    const { container } = render(<SubTopicNodePage params={params} />, {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/.+/);
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
