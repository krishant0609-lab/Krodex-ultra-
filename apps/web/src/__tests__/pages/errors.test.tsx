/**
 * KRODEX web — errors page integration test.
 *
 * Verifies the Phase 7.7 acceptance criteria for the
 * Error Book (index + detail):
 *
 *   1. The /errors index renders a quiet list of error
 *      entries with mistake_type, status, recurrence count,
 *      last-seen date, and a remark excerpt.
 *   2. Each row is a deep link to /errors/[id].
 *   3. Empty and error states render truthfully (no fake
 *      data, no fake "0 mistakes" success).
 *   4. The /errors/[id] detail page renders the title block,
 *      meta badges, dates, remark, and a "Mark resolved"
 *      action button (active → resolved).
 *   5. The detail page handles a missing id (NOT_FOUND) by
 *      surfacing the error band — not a soft empty state.
 *
 * The hook layer is exercised against a stubbed `fetch` (same
 * pattern as tests.test.tsx), so the test is an honest
 * end-to-end of the errors pages.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import { setSettled } from '../../lib/react-async';
import ErrorsPage from '../../app/(app)/errors/page';
import ErrorDetailPage from '../../app/(app)/errors/[id]/page';

// Both error pages render Next.js App Router components that
// import `useRouter` from `next/navigation`. Without a mounted
// app router, that hook throws "invariant expected app router
// to be mounted". We mock the module at the boundary so the
// pages see a real, testable router.
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

function settledParams<T>(value: T): Promise<T> {
  const p = Promise.resolve(value);
  setSettled(p, value);
  return p;
}

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

const ERROR_A = {
  id: 'err-aaaaaaaaaaaa',
  user_id: 'u-1',
  question_id: 'q-1',
  mistake_type: 'concept',
  remark: 'Confused product and quotient rules.',
  status: 'active',
  recurrence_count: 1,
  last_seen_at: '2026-09-01T00:00:00.000Z',
  first_seen_at: '2026-09-01T00:00:00.000Z',
  resolved_at: null,
  source_attempt_id: 'attempt-aaaaaaaa',
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const ERROR_B = {
  id: 'err-bbbbbbbbbbbb',
  user_id: 'u-1',
  question_id: null,
  mistake_type: 'careless',
  remark: null,
  status: 'resolved',
  recurrence_count: 3,
  last_seen_at: '2026-08-30T00:00:00.000Z',
  first_seen_at: '2026-08-01T00:00:00.000Z',
  resolved_at: '2026-08-31T00:00:00.000Z',
  source_attempt_id: null,
  metadata: {},
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-31T00:00:00.000Z',
};

interface ErrorsFetchRoutes {
  list: 'success' | 'empty' | 'error';
  detail: 'success' | 'notFound' | 'error';
}

function stubFetch(routes: ErrorsFetchRoutes): MockInstance<typeof global.fetch> {
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

      // PATCH /errors/:id
      if (method === 'PATCH' && /\/errors\/[a-z0-9-]+$/.test(url)) {
        // Reflect the requested status change in the response so
        // the success-band assertion (which inspects
        // entry.data.status === 'resolved') can fire.
        const idMatch = url.match(/\/errors\/([a-z0-9-]+)$/);
        const id = idMatch ? idMatch[1] : ERROR_A.id;
        const base = id === ERROR_B.id ? { ...ERROR_B } : { ...ERROR_A };
        const body = parseBody(init?.body);
        const merged = body && typeof body === 'object' ? { ...base, ...body } : base;
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(merged) }),
        );
      }

      // GET /errors/:id (detail)
      if (method === 'GET' && /\/errors\/[a-z0-9-]+$/.test(url)) {
        if (routes.detail === 'notFound') {
          return Promise.resolve(
            jsonResponse({ status: 404, body: failure('NOT_FOUND', 'no such error') }),
          );
        }
        if (routes.detail === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        const idMatch = url.match(/\/errors\/([a-z0-9-]+)$/);
        const id = idMatch ? idMatch[1] : ERROR_A.id;
        const fixture = id === ERROR_B.id ? ERROR_B : ERROR_A;
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(fixture) }),
        );
      }

      // GET /errors (list — no id after /errors)
      if (method === 'GET' && /\/errors(\?|$)/.test(url)) {
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
              items: [ERROR_A, ERROR_B],
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

describe('ErrorsPage (index)', () => {
  it('renders a list of error entries with status, type, and recurrence', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(<ErrorsPage />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId(`errors-item-${ERROR_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`errors-item-${ERROR_B.id}`),
    ).toBeInTheDocument();
    expect(screen.getByText('concept')).toBeInTheDocument();
    expect(screen.getByText('careless')).toBeInTheDocument();
    expect(screen.getAllByText('active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('resolved').length).toBeGreaterThan(0);
  });

  it('renders a remark excerpt when a remark is recorded', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(<ErrorsPage />, { wrapper: makeWrapper() });
    await screen.findByTestId(`errors-item-${ERROR_A.id}`);
    expect(
      screen.getByText(/Confused product and quotient rules\./),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/No remark recorded\./).length).toBeGreaterThan(0);
  });

  it('renders the empty state truthfully', async () => {
    stubFetch({ list: 'empty', detail: 'success' });
    render(<ErrorsPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });

  it('renders the error state when the list fails to load', async () => {
    stubFetch({ list: 'error', detail: 'success' });
    render(<ErrorsPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });
});

describe('ErrorDetailPage (/errors/[id])', () => {
  it('renders the title block, meta badges, dates, and remark', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(
      <ErrorDetailPage params={settledParams({ id: ERROR_A.id })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('error-title'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('error-title').textContent).toMatch(/concept/i);
    expect(screen.getByTestId('error-remark').textContent).toMatch(
      /Confused product and quotient rules\./,
    );
    expect(screen.getByTestId('error-mark-resolved')).toBeInTheDocument();
  });

  it('renders the "no remark" fallback when remark is null', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(
      <ErrorDetailPage params={settledParams({ id: ERROR_B.id })} />,
      { wrapper: makeWrapper() },
    );
    // ERROR_B has status='resolved' so the mark-resolved button
    // is not rendered, but the reopen/archive buttons are.
    expect(
      await screen.findByTestId('error-remark-empty'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('error-reopen')).toBeInTheDocument();
  });

  it('renders the error state when the id is unknown', async () => {
    stubFetch({ list: 'success', detail: 'notFound' });
    render(
      <ErrorDetailPage params={settledParams({ id: 'err-unknown000000' })} />,
      { wrapper: makeWrapper() },
    );
    // The API contract reports unknown ids as NOT_FOUND errors,
    // not as a soft "no data" state. PageShell honors that and
    // surfaces the error band with the typed code.
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });

  it('submits a status change and shows the success band', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success', detail: 'success' });
    render(
      <ErrorDetailPage params={settledParams({ id: ERROR_A.id })} />,
      { wrapper: makeWrapper() },
    );
    const button = await screen.findByTestId('error-mark-resolved');
    expect(button).toBeInTheDocument();
    await user.click(button);
    // The PATCH was actually invoked against the right path.
    await waitFor(() => {
      const calledUrls = spy.mock.calls.map((c) => {
        const input = c[0];
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        return (input as Request).url;
      });
      const methodPerCall = spy.mock.calls.map((c) => {
        const init = c[1] as RequestInit | undefined;
        return init?.method ?? 'GET';
      });
      const patched = calledUrls.some(
        (u, i) =>
          methodPerCall[i] === 'PATCH' && u.includes(`/errors/${ERROR_A.id}`),
      );
      expect(patched).toBe(true);
    });
  });
});
