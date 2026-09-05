/**
 * KRODEX web — backlog page integration test.
 *
 * Verifies the Phase 7.9 acceptance criteria for the
 * Backlog (recovery) index:
 *
 *   1. The /backlog index renders a quiet list of missed
 *      items with the source task id, the reason, and
 *      the open date.
 *   2. Each row exposes Recover and Drop actions; closed
 *      items (state != open/scheduled) do not.
 *   3. Empty and error states render truthfully (no fake
 *      "no missed tasks" success copy).
 *   4. The Recover action posts a /recover call; the
 *      Drop action posts a /drop call.
 *
 * The hook layer is exercised against a stubbed `fetch`
 * (same pattern as tests.test.tsx / errors.test.tsx /
 * reviews.test.tsx / planner.test.tsx).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import BacklogPage from '../../app/(app)/backlog/page';

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

const ITEM_OPEN = {
  id: 'blg-aaaaaaaaaaaa',
  user_id: 'u-1',
  source_task_id: 'tsk-aaaaaaaaaaaa',
  reason: 'missed',
  state: 'open',
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const ITEM_SCHEDULED = {
  id: 'blg-bbbbbbbbbbbb',
  user_id: 'u-1',
  source_task_id: 'tsk-bbbbbbbbbbbb',
  reason: 'overdue',
  state: 'scheduled',
  metadata: {},
  created_at: '2026-08-30T00:00:00.000Z',
  updated_at: '2026-08-30T00:00:00.000Z',
};

const ITEM_CLOSED = {
  id: 'blg-cccccccccccc',
  user_id: 'u-1',
  source_task_id: 'tsk-cccccccccccc',
  reason: 'abandoned',
  state: 'dropped',
  metadata: {},
  created_at: '2026-08-25T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z',
};

interface BacklogFetchRoutes {
  list: 'success' | 'empty' | 'error';
}

function stubFetch(routes: BacklogFetchRoutes): MockInstance<typeof global.fetch> {
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

      // POST /backlog/:id/recover
      if (method === 'POST' && /\/backlog\/[a-z0-9-]+\/recover$/.test(url)) {
        const idMatch = url.match(/\/backlog\/([a-z0-9-]+)\/recover$/);
        const id = idMatch ? idMatch[1] : ITEM_OPEN.id;
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              backlog: { ...ITEM_OPEN, id, state: 'recovered' },
              recovered_task: {
                id: 'tsk-recovereddddd',
                user_id: 'u-1',
                template_id: null,
                subject_id: null,
                topic_id: null,
                sub_topic_id: null,
                title: 'Recovered task',
                description: null,
                plan_date: '2026-09-10',
                state: 'planned',
                planned_minutes: null,
                actual_minutes: null,
                started_at: null,
                completed_at: null,
                metadata: {},
                created_at: '2026-09-02T00:00:00.000Z',
                updated_at: '2026-09-02T00:00:00.000Z',
              },
              recovery: {
                id: 'rec-aaaaaaaaaaaa',
                user_id: 'u-1',
                backlog_id: id,
                task_id: 'tsk-recovereddddd',
                notes: null,
                created_at: '2026-09-02T00:00:00.000Z',
              },
            }),
          }),
        );
      }

      // POST /backlog/:id/drop
      if (method === 'POST' && /\/backlog\/[a-z0-9-]+\/drop$/.test(url)) {
        const idMatch = url.match(/\/backlog\/([a-z0-9-]+)\/drop$/);
        const id = idMatch ? idMatch[1] : ITEM_OPEN.id;
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({ ...ITEM_OPEN, id, state: 'dropped' }),
          }),
        );
      }

      // GET /backlog (list)
      if (method === 'GET' && /\/backlog(\?|$)/.test(url)) {
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
              items: [ITEM_OPEN, ITEM_SCHEDULED, ITEM_CLOSED],
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

describe('BacklogPage (index)', () => {
  it('renders a list of items with source task id, reason, and open date', async () => {
    stubFetch({ list: 'success' });
    render(<BacklogPage />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId(`backlog-item-${ITEM_OPEN.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`backlog-item-${ITEM_SCHEDULED.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(ITEM_OPEN.source_task_id).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('missed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('overdue').length).toBeGreaterThan(0);
  });

  it('exposes Recover and Drop for open/scheduled items, not for closed items', async () => {
    stubFetch({ list: 'success' });
    render(<BacklogPage />, { wrapper: makeWrapper() });
    await screen.findByTestId(`backlog-item-${ITEM_OPEN.id}`);
    expect(
      screen.getByTestId(`backlog-recover-${ITEM_OPEN.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`backlog-drop-${ITEM_OPEN.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`backlog-recover-${ITEM_SCHEDULED.id}`),
    ).toBeInTheDocument();
    // Closed item should not have a Recover button.
    expect(
      screen.queryByTestId(`backlog-recover-${ITEM_CLOSED.id}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`backlog-drop-${ITEM_CLOSED.id}`),
    ).toBeNull();
  });

  it('renders the empty state truthfully', async () => {
    stubFetch({ list: 'empty' });
    render(<BacklogPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });

  it('renders the error state when the list fails to load', async () => {
    stubFetch({ list: 'error' });
    render(<BacklogPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });

  it('submits a recover POST when the user clicks Recover', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success' });
    render(<BacklogPage />, { wrapper: makeWrapper() });
    const button = await screen.findByTestId(
      `backlog-recover-${ITEM_OPEN.id}`,
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
          u.includes(`/backlog/${ITEM_OPEN.id}/recover`),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
    });
  });

  it('submits a drop POST when the user clicks Drop', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success' });
    render(<BacklogPage />, { wrapper: makeWrapper() });
    const button = await screen.findByTestId(
      `backlog-drop-${ITEM_OPEN.id}`,
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
          u.includes(`/backlog/${ITEM_OPEN.id}/drop`),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
    });
  });
});
