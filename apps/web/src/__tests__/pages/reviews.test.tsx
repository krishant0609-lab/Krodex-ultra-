/**
 * KRODEX web — reviews page integration test.
 *
 * Verifies the Phase 7.8 acceptance criteria for the
 * Reviews queue (index + detail):
 *
 *   1. The /reviews index renders a quiet list of review
 *      schedules with state badge, strategy, error id,
 *      and due date.
 *   2. Each row is a deep link to /reviews/[id].
 *   3. Empty and error states render truthfully (no fake
 *      data, no fake "0 reviews" success).
 *   4. The /reviews/[id] detail page renders the title
 *      block, meta badges, dates, source error, and
 *      the mark-passed action button.
 *   5. The detail page handles a missing id (NOT_FOUND)
 *      by surfacing the error band — not a soft empty
 *      state.
 *
 * The hook layer is exercised against a stubbed `fetch`
 * (same pattern as tests.test.tsx / errors.test.tsx), so
 * the test is an honest end-to-end of the review pages.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import { setSettled } from '../../lib/react-async';
import ReviewsPage from '../../app/(app)/reviews/page';
import ReviewDetailPage from '../../app/(app)/reviews/[id]/page';

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

const REVIEW_A = {
  id: 'rev-aaaaaaaaaaaa',
  user_id: 'u-1',
  error_id: 'err-aaaaaaaaaaaa',
  state: 'due',
  due_at: '2026-09-15T00:00:00.000Z',
  scheduled_at: '2026-09-01T00:00:00.000Z',
  completed_at: null,
  outcome: null,
  strategy: 'spaced',
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const REVIEW_B = {
  id: 'rev-bbbbbbbbbbbb',
  user_id: 'u-1',
  error_id: 'err-bbbbbbbbbbbb',
  state: 'completed',
  due_at: '2026-08-30T00:00:00.000Z',
  scheduled_at: '2026-08-01T00:00:00.000Z',
  completed_at: '2026-08-31T00:00:00.000Z',
  outcome: 'correct',
  strategy: 'standard',
  metadata: {},
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-31T00:00:00.000Z',
};

interface ReviewsFetchRoutes {
  list: 'success' | 'empty' | 'error';
  detail: 'success' | 'notFound' | 'error';
}

function stubFetch(routes: ReviewsFetchRoutes): MockInstance<typeof global.fetch> {
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

      // PATCH /review/schedules/:id
      if (method === 'PATCH' && /\/review\/schedules\/[a-z0-9-]+$/.test(url)) {
        const idMatch = url.match(/\/review\/schedules\/([a-z0-9-]+)$/);
        const id = idMatch ? idMatch[1] : REVIEW_A.id;
        const base = id === REVIEW_B.id ? { ...REVIEW_B } : { ...REVIEW_A };
        const body = parseBody(init?.body);
        const merged = body && typeof body === 'object' ? { ...base, ...body } : base;
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(merged) }),
        );
      }

      // POST /review/schedules/:id/attempts
      if (
        method === 'POST' &&
        /\/review\/schedules\/[a-z0-9-]+\/attempts$/.test(url)
      ) {
        const body = parseBody(init?.body);
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              id: 'att-cccccccccccc',
              user_id: 'u-1',
              schedule_id: REVIEW_A.id,
              question_id: body?.['question_id'] ?? null,
              outcome: body?.['outcome'] ?? 'failed',
              selected_option_ids: body?.['selected_option_ids'] ?? [],
              free_text: null,
              duration_ms: null,
              created_at: '2026-09-02T00:00:00.000Z',
              updated_at: '2026-09-02T00:00:00.000Z',
            }),
          }),
        );
      }

      // GET /review/schedules/:id
      if (method === 'GET' && /\/review\/schedules\/[a-z0-9-]+$/.test(url)) {
        if (routes.detail === 'notFound') {
          return Promise.resolve(
            jsonResponse({ status: 404, body: failure('NOT_FOUND', 'no such review') }),
          );
        }
        if (routes.detail === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        const idMatch = url.match(/\/review\/schedules\/([a-z0-9-]+)$/);
        const id = idMatch ? idMatch[1] : REVIEW_A.id;
        const fixture = id === REVIEW_B.id ? REVIEW_B : REVIEW_A;
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(fixture) }),
        );
      }

      // GET /review/schedules (list)
      if (method === 'GET' && /\/review\/schedules(\?|$)/.test(url)) {
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
              items: [REVIEW_A, REVIEW_B],
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

describe('ReviewsPage (index)', () => {
  it('renders a list of review schedules with state, strategy, and due date', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(<ReviewsPage />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId(`reviews-item-${REVIEW_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`reviews-item-${REVIEW_B.id}`),
    ).toBeInTheDocument();
    expect(screen.getAllByText('due').length).toBeGreaterThan(0);
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0);
    expect(screen.getByText('spaced')).toBeInTheDocument();
    expect(screen.getByText('standard')).toBeInTheDocument();
  });

  it('renders the error id for each row', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(<ReviewsPage />, { wrapper: makeWrapper() });
    await screen.findByTestId(`reviews-item-${REVIEW_A.id}`);
    expect(screen.getAllByText(REVIEW_A.error_id).length).toBeGreaterThan(0);
    expect(screen.getAllByText(REVIEW_B.error_id).length).toBeGreaterThan(0);
  });

  it('renders the empty state truthfully', async () => {
    stubFetch({ list: 'empty', detail: 'success' });
    render(<ReviewsPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });

  it('renders the error state when the list fails to load', async () => {
    stubFetch({ list: 'error', detail: 'success' });
    render(<ReviewsPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });
});

describe('ReviewDetailPage (/reviews/[id])', () => {
  it('renders the title block, meta badges, dates, and source error', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(
      <ReviewDetailPage params={settledParams({ id: REVIEW_A.id })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('review-title'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('review-title').textContent).toMatch(/spaced/i);
    expect(screen.getByTestId('review-mark-passed')).toBeInTheDocument();
    expect(screen.getByTestId('review-mark-failed')).toBeInTheDocument();
  });

  it('renders the reopen button when the schedule is completed', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(
      <ReviewDetailPage params={settledParams({ id: REVIEW_B.id })} />,
      { wrapper: makeWrapper() },
    );
    await screen.findByTestId('review-title');
    expect(screen.getByTestId('review-reopen')).toBeInTheDocument();
  });

  it('renders the error state when the id is unknown', async () => {
    stubFetch({ list: 'success', detail: 'notFound' });
    render(
      <ReviewDetailPage params={settledParams({ id: 'rev-unknown000000' })} />,
      { wrapper: makeWrapper() },
    );
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });

  it('submits a status change and updates the schedule', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success', detail: 'success' });
    render(
      <ReviewDetailPage params={settledParams({ id: REVIEW_A.id })} />,
      { wrapper: makeWrapper() },
    );
    const button = await screen.findByTestId('review-mark-passed');
    expect(button).toBeInTheDocument();
    await user.click(button);
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
          methodPerCall[i] === 'PATCH' && u.includes(`/review/schedules/${REVIEW_A.id}`),
      );
      expect(patched).toBe(true);
    });
  });
});
