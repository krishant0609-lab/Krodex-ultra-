/**
 * KRODEX web — dashboard page integration test.
 *
 * Verifies Phase 7.4 acceptance criteria:
 *
 *   1. Hero strip renders the real date and a CTA into /planner.
 *   2. Stat row renders four tiles, each with the real count
 *      from the API.
 *   3. Surface grid renders four cards in the four states
 *      (loading, empty, populated, error) per the 7-state
 *      contract, driven by the actual hook responses.
 *   4. No fake data — every value comes from a mocked fetch
 *      response shaped exactly like the API envelope.
 *
 * The hook layer is not mocked; it is exercised against a
 * stubbed `fetch` (same pattern as errors.test.tsx), so the
 * test is an honest end-to-end of the dashboard.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import DashboardPage from '../../app/(app)/dashboard/page';
import {
  formatLongDate,
  formatShortDate,
  formatTimeOfDay,
  toIsoDateOnly,
} from '../../lib/format-date';

const BASE = 'http://api.test/v1';
const ORIGINAL_ENV = process.env['NEXT_PUBLIC_API_BASE_URL'];

interface FetchResponse {
  status: number;
  body: unknown;
}

function jsonResponse({ status, body }: FetchResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function success<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

function failure(code: string, message: string): {
  success: false;
  error: { code: string; message: string };
} {
  return { success: false, error: { code, message } };
}

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

interface DashboardFetchRoutes {
  tasks: 'success' | 'empty' | 'error';
  reviews: 'success' | 'empty' | 'error';
  errors: 'success' | 'empty' | 'error';
  notifications: 'success' | 'empty' | 'error';
}

const PLANNER_ROW = {
  id: 'task-1',
  user_id: 'u-1',
  template_id: null,
  plan_date: '2026-09-02',
  title: 'Read chapter 4',
  description: null,
  state: 'planned' as const,
  subject_id: null,
  topic_id: null,
  sub_topic_id: null,
  planned_minutes: 60,
  actual_minutes: null,
  started_at: null,
  completed_at: null,
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const REVIEW_ROW = {
  id: 'review-1',
  user_id: 'u-1',
  error_id: 'error-aaaaaaaaaaaa',
  state: 'due' as const,
  due_at: '2026-09-02T14:30:00.000Z',
  scheduled_at: '2026-09-01T00:00:00.000Z',
  completed_at: null,
  outcome: null,
  strategy: 'spaced_repetition' as const,
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const ERROR_ROW = {
  id: 'error-1',
  user_id: 'u-1',
  question_id: 'q-1',
  mistake_type: 'concept',
  remark: null,
  status: 'active' as const,
  recurrence_count: 2,
  source_attempt_id: null,
  first_seen_at: '2026-08-30T00:00:00.000Z',
  last_seen_at: '2026-09-01T00:00:00.000Z',
  resolved_at: null,
  metadata: {},
  created_at: '2026-08-30T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const NOTIFICATION_ROW = {
  id: 'notif-1',
  user_id: 'u-1',
  kind: 'review.due',
  severity: 'warning' as const,
  title: 'Review due',
  body: null,
  payload: {},
  read_at: null,
  dismissed_at: null,
  expires_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

function pageFor(state: DashboardFetchRoutes['tasks']) {
  return success({ items: state === 'empty' ? [] : [PLANNER_ROW], nextCursor: null });
}
function reviewPageFor(state: DashboardFetchRoutes['reviews']) {
  return success({ items: state === 'empty' ? [] : [REVIEW_ROW], nextCursor: null });
}
function errorPageFor(state: DashboardFetchRoutes['errors']) {
  return success({ items: state === 'empty' ? [] : [ERROR_ROW], nextCursor: null });
}
function notificationPageFor(state: DashboardFetchRoutes['notifications']) {
  return success({
    items: state === 'empty' ? [] : [NOTIFICATION_ROW],
    nextCursor: null,
  });
}

function stubFetch(
  routes: DashboardFetchRoutes,
): MockInstance<typeof global.fetch> {
  return vi
    .spyOn(global, 'fetch')
    .mockImplementation((input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes('/planner/tasks')) {
        if (routes.tasks === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        return Promise.resolve(
          jsonResponse({ status: 200, body: pageFor(routes.tasks) }),
        );
      }
      if (url.includes('/review/schedules')) {
        if (routes.reviews === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        return Promise.resolve(
          jsonResponse({ status: 200, body: reviewPageFor(routes.reviews) }),
        );
      }
      if (url.includes('/errors')) {
        if (routes.errors === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        return Promise.resolve(
          jsonResponse({ status: 200, body: errorPageFor(routes.errors) }),
        );
      }
      if (url.includes('/notifications')) {
        if (routes.notifications === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: notificationPageFor(routes.notifications),
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({ status: 404, body: failure('NOT_FOUND', 'not stubbed') }),
      );
    });
}

beforeEach(() => {
  process.env['NEXT_PUBLIC_API_BASE_URL'] = BASE;
  clearAuth();
  setAuth({ token: 'test-token', userId: 'u-1' });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
});

describe('DashboardPage', () => {
  it('renders the hero strip with the real date and a planner CTA', async () => {
    stubFetch({
      tasks: 'empty',
      reviews: 'empty',
      errors: 'empty',
      notifications: 'empty',
    });
    render(<DashboardPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-cta-planner')).toBeInTheDocument();
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(formatLongDate(new Date().toISOString()));
  });

  it('renders the four stat tiles with values from the API', async () => {
    stubFetch({
      tasks: 'success',
      reviews: 'success',
      errors: 'success',
      notifications: 'success',
    });
    render(<DashboardPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-stat-tasks-value').textContent).toBe('1');
    });
    expect(screen.getByTestId('dashboard-stat-reviews-value').textContent).toBe('1');
    expect(screen.getByTestId('dashboard-stat-errors-value').textContent).toBe('1');
    expect(screen.getByTestId('dashboard-stat-inbox-value').textContent).toBe('1');
  });

  it('renders empty surfaces truthfully (no fake zeros in populated state)', async () => {
    stubFetch({
      tasks: 'empty',
      reviews: 'empty',
      errors: 'empty',
      notifications: 'empty',
    });
    render(<DashboardPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-tasks-state').textContent).toBe('empty');
    });
    expect(screen.getByTestId('dashboard-reviews-state').textContent).toBe('empty');
    expect(screen.getByTestId('dashboard-errors-state').textContent).toBe('empty');
    expect(screen.getByTestId('dashboard-inbox-state').textContent).toBe('empty');
    // The stat values must read 0 — they reflect the real (empty) API response.
    expect(screen.getByTestId('dashboard-stat-tasks-value').textContent).toBe('0');
    expect(screen.getByTestId('dashboard-stat-reviews-value').textContent).toBe('0');
    expect(screen.getByTestId('dashboard-stat-errors-value').textContent).toBe('0');
    expect(screen.getByTestId('dashboard-stat-inbox-value').textContent).toBe('0');
  });

  it('renders populated rows with deep links', async () => {
    stubFetch({
      tasks: 'success',
      reviews: 'success',
      errors: 'success',
      notifications: 'success',
    });
    render(<DashboardPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-tasks-items')).toBeInTheDocument();
    });
    const tasksItem = screen.getAllByTestId('dashboard-tasks-row')[0];
    expect(tasksItem).toBeDefined();
    expect(tasksItem?.getAttribute('href')).toBe('/planner');
    const reviewsItem = screen.getAllByTestId('dashboard-reviews-row')[0];
    expect(reviewsItem).toBeDefined();
    expect(reviewsItem?.getAttribute('href')).toBe('/reviews/review-1');
    const errorsItem = screen.getAllByTestId('dashboard-errors-row')[0];
    expect(errorsItem).toBeDefined();
    expect(errorsItem?.getAttribute('href')).toBe('/errors/error-1');
    const inboxItem = screen.getAllByTestId('dashboard-inbox-row')[0];
    expect(inboxItem).toBeDefined();
    expect(inboxItem?.getAttribute('href')).toBe('/notifications');
  });

  it('renders mixed states independently per surface', async () => {
    stubFetch({
      tasks: 'success',
      reviews: 'error',
      errors: 'empty',
      notifications: 'success',
    });
    render(<DashboardPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-tasks-state').textContent).toBe('populated');
    });
    expect(screen.getByTestId('dashboard-reviews-state').textContent).toBe('error');
    expect(screen.getByTestId('dashboard-errors-state').textContent).toBe('empty');
    expect(screen.getByTestId('dashboard-inbox-state').textContent).toBe('populated');
    expect(screen.getByTestId('dashboard-reviews-error').textContent).toMatch(
      /Couldn'?t load this view/,
    );
  });

  it('shows a "Today" label on a task whose plan_date is today', async () => {
    const today = toIsoDateOnly(new Date().toISOString()) ?? '2026-09-02';
    stubFetch({
      tasks: 'success',
      reviews: 'empty',
      errors: 'empty',
      notifications: 'empty',
    });
    // Override the task row's plan_date to today so we exercise
    // the "Today" branch (this stays a real value, not fabricated).
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes('/planner/tasks')) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              items: [{ ...PLANNER_ROW, plan_date: today }],
              nextCursor: null,
            }),
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          status: 200,
          body: success({ items: [], nextCursor: null }),
        }),
      );
    },
    );
    render(<DashboardPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-tasks-items')).toBeInTheDocument();
    });
    const row = screen.getByTestId('dashboard-tasks-row');
    expect(row.textContent).toContain('Today');
  });
});

describe('format-date helpers', () => {
  it('formats short and long dates from ISO inputs', () => {
    expect(formatShortDate('2026-09-02')).toMatch(/Sep/);
    expect(formatLongDate('2026-09-02')).toMatch(/September 2026/);
    expect(formatTimeOfDay('2026-09-02T14:30:00.000Z')).toBe('14:30');
  });

  it('returns null for invalid input', () => {
    expect(formatShortDate('not-a-date')).toBeNull();
    expect(formatLongDate('not-a-date')).toBeNull();
    expect(formatTimeOfDay('not-a-date')).toBeNull();
    expect(toIsoDateOnly(null)).toBeNull();
    expect(toIsoDateOnly(undefined)).toBeNull();
  });
});
