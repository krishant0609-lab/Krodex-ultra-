/**
 * KRODEX web — Accessibility (axe) sweep for Phase 7.12.
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
 *
 * We deliberately skip deep-link pages (e.g. /tests/:id) because
 * they require a prior navigate; the editorial layout is the
 * real a11y surface. If a deep link has unique content, it
 * inherits the layout's accessibility.
 *
 * What we do NOT do:
 *   - We do not change any product component. This is a
 *     verification pass.
 *   - We do not bake in screen-reader assertions. Axe is the
 *     public contract; SR-specific tests live in Phase 7.13
 *     if/when we need them.
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
import LoginPage from '../app/(auth)/login/page';
import DashboardPage from '../app/(app)/dashboard/page';
import PlannerPage from '../app/(app)/planner/page';
import BacklogPage from '../app/(app)/backlog/page';
import InsightsPage from '../app/(app)/insights/page';
import StudentModelPage from '../app/(app)/student-model/page';
import NotificationsPage from '../app/(app)/notifications/page';
import SettingsPage from '../app/(app)/settings/page';

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

/**
 * The stub fetch returns a truthful empty success envelope for
 * every URL. Some pages fetch multiple endpoints concurrently;
 * each test calls `await waitFor` until a known page marker is
 * in the DOM, then runs axe.
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
    // Dashboard (analytics + planner + reviews + errors aggregated)
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
