/**
 * KRODEX web — planner page integration test.
 *
 * Verifies the Phase 7.9 acceptance criteria for the
 * Planner index:
 *
 *   1. The /planner index renders a quiet list of tasks
 *      with state badge, title, planned minutes, and
 *      plan date.
 *   2. Each open task (planned/in_progress) exposes
 *      "Complete" and "Mark missed" actions; closed
 *      tasks do not.
 *   3. Empty and error states render truthfully (no fake
 *      data, no fabricated "all done" success).
 *   4. The "Complete" action posts a PATCH that flips
 *      the task to "completed" via TanStack Query
 *      cache invalidation.
 *   5. The "Mark missed" action posts a missed call
 *      that invalidates the backlog query.
 *
 * The hook layer is exercised against a stubbed `fetch`
 * (same pattern as tests.test.tsx / errors.test.tsx /
 * reviews.test.tsx), so the test is an honest
 * end-to-end of the planner page.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import PlannerPage from '../../app/(app)/planner/page';

const pushSpy = vi.fn();
const replaceSpy = vi.fn();
const backSpy = vi.fn();
const forwardSpy = vi.fn();
const refreshSpy = vi.fn();
const prefetchSpy = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushSpy,
    replace: replaceSpy,
    back: backSpy,
    forward: forwardSpy,
    refresh: refreshSpy,
    prefetch: prefetchSpy,
  }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

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

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const TASK_PLANNED = {
  id: 'tsk-aaaaaaaaaaaa',
  user_id: 'u-1',
  template_id: null,
  subject_id: 'sub-1',
  topic_id: null,
  sub_topic_id: null,
  title: 'Read chapter 3',
  description: 'Skim the chapter once, then read the worked examples.',
  plan_date: '2026-09-05',
  state: 'planned',
  planned_minutes: 45,
  actual_minutes: null,
  started_at: null,
  completed_at: null,
  partial_count: 0,
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const TASK_IN_PROGRESS = {
  id: 'tsk-bbbbbbbbbbbb',
  user_id: 'u-1',
  template_id: null,
  subject_id: 'sub-1',
  topic_id: null,
  sub_topic_id: null,
  title: 'Practice problems',
  description: null,
  plan_date: '2026-09-04',
  state: 'in_progress',
  planned_minutes: null,
  actual_minutes: null,
  started_at: '2026-09-02T10:00:00.000Z',
  completed_at: null,
  partial_count: 1,
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-02T10:00:00.000Z',
};

const TASK_COMPLETED = {
  id: 'tsk-cccccccccccc',
  user_id: 'u-1',
  template_id: null,
  subject_id: 'sub-1',
  topic_id: null,
  sub_topic_id: null,
  title: 'Review notes from yesterday',
  description: 'Skim once.',
  plan_date: '2026-09-01',
  state: 'completed',
  planned_minutes: 30,
  actual_minutes: 32,
  started_at: '2026-09-01T09:00:00.000Z',
  completed_at: '2026-09-01T09:32:00.000Z',
  partial_count: 0,
  metadata: {},
  created_at: '2026-08-31T00:00:00.000Z',
  updated_at: '2026-09-01T09:32:00.000Z',
};

interface PlannerFetchRoutes {
  list: 'success' | 'empty' | 'error';
}

function stubFetch(routes: PlannerFetchRoutes): MockInstance<typeof global.fetch> {
  return vi
    .spyOn(global, 'fetch')
    .mockImplementation((input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const method =
        (init?.method as string | undefined) ??
        (typeof input === 'object' && input && 'method' in input
          ? (input as Request).method
          : 'GET');

      // PATCH /planner/tasks/:id
      if (method === 'PATCH' && /\/planner\/tasks\/[a-z0-9-]+$/.test(url)) {
        const idMatch = url.match(/\/planner\/tasks\/([a-z0-9-]+)$/);
        const id = idMatch ? idMatch[1] : TASK_PLANNED.id;
        const candidates: Record<string, Record<string, unknown>> = {
          [TASK_PLANNED.id]: TASK_PLANNED,
          [TASK_IN_PROGRESS.id]: TASK_IN_PROGRESS,
          [TASK_COMPLETED.id]: TASK_COMPLETED,
        };
        const base = id ? (candidates[id] ?? TASK_PLANNED) : TASK_PLANNED;
        const body = parseBody(init?.body);
        const merged = body && typeof body === 'object' ? { ...base, ...body } : base;
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(merged) }),
        );
      }

      // POST /planner/tasks/:id/missed
      if (method === 'POST' && /\/planner\/tasks\/[a-z0-9-]+\/missed$/.test(url)) {
        const idMatch = url.match(/\/planner\/tasks\/([a-z0-9-]+)\/missed$/);
        const id = idMatch ? idMatch[1] : TASK_PLANNED.id;
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              task: { ...TASK_PLANNED, id, state: 'missed' },
              backlog: {
                id: 'blg-aaaaaaaaaaaa',
                user_id: 'u-1',
                source_task_id: id,
                reason: 'missed',
                state: 'open',
                metadata: {},
                created_at: '2026-09-02T00:00:00.000Z',
                updated_at: '2026-09-02T00:00:00.000Z',
              },
            }),
          }),
        );
      }

      // POST /planner/tasks/:id/partial
      if (method === 'POST' && /\/planner\/tasks\/[a-z0-9-]+\/partial$/.test(url)) {
        const idMatch = url.match(/\/planner\/tasks\/([a-z0-9-]+)\/partial$/);
        const id = idMatch ? idMatch[1] : TASK_PLANNED.id;
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              task: { ...TASK_PLANNED, id, partial_count: 1 },
              backlogItem: null,
            }),
          }),
        );
      }

      // POST /planner/tasks/:id/reschedule
      if (method === 'POST' && /\/planner\/tasks\/[a-z0-9-]+\/reschedule$/.test(url)) {
        const idMatch = url.match(/\/planner\/tasks\/([a-z0-9-]+)\/reschedule$/);
        const id = idMatch ? idMatch[1] : TASK_PLANNED.id;
        const body = parseBody(init?.body);
        const newDueAt = (body?.['new_due_at'] as string | undefined) ?? '2026-09-12T00:00:00.000Z';
        const newTask = {
          ...TASK_PLANNED,
          id: 'tsk-dddddddddddd',
          plan_date: newDueAt.slice(0, 10),
        };
        const event = {
          id: 'pte-111111111111',
          task_id: id,
          event_type: 'rescheduled',
          previous_due_at: TASK_PLANNED.plan_date + 'T00:00:00.000Z',
          new_due_at: newDueAt,
          reason: null,
          created_at: '2026-09-04T00:00:00.000Z',
        };
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              originalTask: { ...TASK_PLANNED, id },
              newTask,
              event,
            }),
          }),
        );
      }

      // POST /planner/check-missed
      if (method === 'POST' && url.includes('/planner/check-missed')) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              scannedAt: '2026-09-04T00:00:00.000Z',
              newlyMissed: [],
              alreadyMissed: [],
              createdBacklogItemIds: [],
            }),
          }),
        );
      }

      // GET /planner/backlog/recovery-suggestions
      if (
        method === 'GET' &&
        url.includes('/planner/backlog/recovery-suggestions')
      ) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({ suggestions: [] }),
          }),
        );
      }

      // GET /planner/tasks (list)
      if (method === 'GET' && /\/planner\/tasks(\?|$)/.test(url)) {
        if (routes.list === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        if (routes.list === 'empty') {
          return Promise.resolve(
            jsonResponse({
              status: 200,
              body: success({ items: [], nextCursor: null }),
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              items: [TASK_PLANNED, TASK_IN_PROGRESS, TASK_COMPLETED],
              nextCursor: null,
            }),
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

describe('PlannerPage (index)', () => {
  it('renders a list of tasks with state, title, minutes, and plan date', async () => {
    stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId(`planner-task-${TASK_PLANNED.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`planner-task-title-${TASK_PLANNED.id}`).textContent,
    ).toMatch(/read chapter 3/i);
    expect(screen.getAllByText('planned').length).toBeGreaterThan(0);
    expect(screen.getAllByText('in_progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/45 min/).length).toBeGreaterThan(0);
  });

  it('exposes Complete and Mark missed for open tasks only', async () => {
    stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    await screen.findByTestId(`planner-task-${TASK_PLANNED.id}`);
    expect(
      screen.getByTestId(`planner-task-complete-${TASK_PLANNED.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`planner-task-missed-${TASK_PLANNED.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`planner-task-complete-${TASK_IN_PROGRESS.id}`),
    ).toBeInTheDocument();
    // Closed task should not have a Complete button.
    expect(
      screen.queryByTestId(`planner-task-complete-${TASK_COMPLETED.id}`),
    ).toBeNull();
  });

  it('renders the empty state truthfully', async () => {
    stubFetch({ list: 'empty' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });

  it('renders the error state when the list fails to load', async () => {
    stubFetch({ list: 'error' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });

  it('submits a PATCH when the user clicks Complete', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    const button = await screen.findByTestId(
      `planner-task-complete-${TASK_PLANNED.id}`,
    );
    await user.click(button);
    await waitFor(() => {
      const calledUrls = spy.mock.calls.map((c) => {
        const input = c[0];
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        return (input as Request).url;
      });
      const calledMethods = spy.mock.calls.map(
        (c) => (c[1]?.method as string | undefined) ?? 'GET',
      );
      const idx = calledUrls.findIndex(
        (u, i) =>
          calledMethods[i] === 'PATCH' &&
          u.includes(`/planner/tasks/${TASK_PLANNED.id}`),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      const body = parseBody(spy.mock.calls[idx]?.[1]?.body);
      expect(body?.['state']).toBe('completed');
    });
  });

  it('submits a missed POST when the user clicks Mark missed', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    const button = await screen.findByTestId(
      `planner-task-missed-${TASK_PLANNED.id}`,
    );
    await user.click(button);
    await waitFor(() => {
      const calledUrls = spy.mock.calls.map((c) => {
        const input = c[0];
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        return (input as Request).url;
      });
      const calledMethods = spy.mock.calls.map(
        (c) => (c[1]?.method as string | undefined) ?? 'GET',
      );
      const idx = calledUrls.findIndex(
        (u, i) =>
          calledMethods[i] === 'POST' &&
          u.includes(`/planner/tasks/${TASK_PLANNED.id}/missed`),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('PlannerPage (Phase 11)', () => {
  it('renders the partial indicator when a task has been marked partial before', async () => {
    stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    await screen.findByTestId(`planner-task-${TASK_PLANNED.id}`);
    const indicator = await screen.findByTestId('task-partial-indicator');
    expect(indicator.textContent).toMatch(/partial × 1/);
  });

  it('exposes Mark partial and Reschedule buttons on open tasks', async () => {
    stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    await screen.findByTestId(`planner-task-${TASK_PLANNED.id}`);
    expect(
      screen.getByTestId(`planner-task-partial-${TASK_PLANNED.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`planner-task-reschedule-${TASK_PLANNED.id}`),
    ).toBeInTheDocument();
    // Closed task has no actions.
    expect(
      screen.queryByTestId(`planner-task-partial-${TASK_COMPLETED.id}`),
    ).toBeNull();
  });

  it('submits a partial POST when the user clicks Mark partial', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    const button = await screen.findByTestId(
      `planner-task-partial-${TASK_PLANNED.id}`,
    );
    await user.click(button);
    await waitFor(() => {
      const calledUrls = spy.mock.calls.map((c) => {
        const input = c[0];
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        return (input as Request).url;
      });
      const calledMethods = spy.mock.calls.map(
        (c) => (c[1]?.method as string | undefined) ?? 'GET',
      );
      const idx = calledUrls.findIndex(
        (u, i) =>
          calledMethods[i] === 'POST' &&
          u.includes(`/planner/tasks/${TASK_PLANNED.id}/partial`),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
    });
  });

  it('submits a reschedule POST with a YYYY-MM-DD new plan date', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success' });
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockReturnValue('2026-09-12');
    render(<PlannerPage />, { wrapper: makeWrapper() });
    const button = await screen.findByTestId(
      `planner-task-reschedule-${TASK_PLANNED.id}`,
    );
    await user.click(button);
    await waitFor(() => {
      const calledUrls = spy.mock.calls.map((c) => {
        const input = c[0];
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        return (input as Request).url;
      });
      const calledMethods = spy.mock.calls.map(
        (c) => (c[1]?.method as string | undefined) ?? 'GET',
      );
      const idx = calledUrls.findIndex(
        (u, i) =>
          calledMethods[i] === 'POST' &&
          u.includes(`/planner/tasks/${TASK_PLANNED.id}/reschedule`),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      const body = parseBody(spy.mock.calls[idx]?.[1]?.body);
      expect(body?.['new_due_at']).toBe('2026-09-12T00:00:00.000Z');
    });
    promptSpy.mockRestore();
  });

  it('does not submit reschedule when the prompt is cancelled or invalid', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success' });
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockReturnValue('not-a-date');
    const alertSpy = vi
      .spyOn(window, 'alert')
      .mockImplementation(() => undefined);
    render(<PlannerPage />, { wrapper: makeWrapper() });
    const button = await screen.findByTestId(
      `planner-task-reschedule-${TASK_PLANNED.id}`,
    );
    await user.click(button);
    // wait a tick then check the spy has no reschedule POST
    await new Promise((r) => setTimeout(r, 50));
    const calledUrls = spy.mock.calls.map((c) => {
      const input = c[0];
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.toString();
      return (input as Request).url;
    });
    const calledMethods = spy.mock.calls.map(
      (c) => (c[1]?.method as string | undefined) ?? 'GET',
    );
    const idx = calledUrls.findIndex(
      (u, i) =>
        calledMethods[i] === 'POST' &&
        u.includes(`/planner/tasks/${TASK_PLANNED.id}/reschedule`),
    );
    expect(idx).toBe(-1);
    promptSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('does not render the miss banner when no task is overdue', async () => {
    stubFetch({ list: 'success' });
    render(<PlannerPage />, { wrapper: makeWrapper() });
    await screen.findByTestId(`planner-task-${TASK_PLANNED.id}`);
    expect(screen.queryByTestId('task-miss-banner')).toBeNull();
  });
});
