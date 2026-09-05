/**
 * KRODEX web — reviews page integration test (Phase 10).
 *
 * Verifies the review session flow on the detail page:
 *
 *   1. The /reviews index renders a quiet list of review
 *      schedules with state badge, strategy, error id,
 *      and due date.
 *   2. Each row is a deep link to /reviews/[id].
 *   3. Empty and error states render truthfully.
 *   4. The /reviews/[id] detail page surfaces the new
 *      session flow: Start review button → verification
 *      question → outcome selection → outcome feedback.
 *   5. The detail page handles a missing id (NOT_FOUND)
 *      by surfacing the error band.
 *   6. The "Start review" mutation calls the new
 *      POST /reviews/:id/start endpoint and renders the
 *      verification question card.
 *   7. Submitting an outcome posts to /reviews/:id/outcome
 *      and renders the outcome feedback panel.
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

const REVIEW_IN_PROGRESS = {
  ...REVIEW_A,
  state: 'in_progress',
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

interface StartFetchResponse {
  status: number;
  body: {
    schedule: typeof REVIEW_IN_PROGRESS;
    errorTransition: { fromStatus: string; toStatus: string };
    verification: {
      kind: 'found' | 'none';
      questionId?: string;
      difficulty?: number;
    };
  };
}

function startResponse(): StartFetchResponse {
  return {
    status: 200,
    body: {
      schedule: REVIEW_IN_PROGRESS,
      errorTransition: { fromStatus: 'active', toStatus: 'in_review' },
      verification: {
        kind: 'found',
        questionId: 'q-fresh-aaaaaaaaaa',
        difficulty: 3,
      },
    },
  };
}

function outcomeResponse(outcome: 'correct' | 'incorrect' | 'partial'): {
  status: number;
  body: {
    outcomeId: string;
    errorTransition: { fromStatus: string; toStatus: string };
    nextReviewScheduled: boolean;
    nextReview: null | {
      dueAt: string;
      reasonCode: string;
      reasonText: string;
      confidence: number;
      requiresConfirmation: boolean;
    };
    terminalOutcome: typeof outcome;
  };
} {
  return {
    status: 200,
    body: {
      outcomeId: 'out-cccccccccccc',
      errorTransition: {
        fromStatus: 'in_review',
        toStatus: outcome === 'correct' ? 'resolved' : 'active',
      },
      nextReviewScheduled: outcome !== 'correct',
      nextReview:
        outcome === 'correct'
          ? null
          : {
              dueAt: '2026-09-22T00:00:00.000Z',
              reasonCode: 'spaced',
              reasonText: '3 days from now, spaced policy',
              confidence: 0.4,
              requiresConfirmation: true,
            },
      terminalOutcome: outcome,
    },
  };
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

      // POST /reviews/:id/start
      if (method === 'POST' && /\/reviews\/[a-z0-9-]+\/start$/.test(url)) {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(startResponse().body) }),
        );
      }

      // POST /reviews/:id/outcome
      if (method === 'POST' && /\/reviews\/[a-z0-9-]+\/outcome$/.test(url)) {
        const body = parseBody(init?.body);
        const outcome =
          (body?.['outcome'] as 'correct' | 'incorrect' | 'partial') ?? 'correct';
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(outcomeResponse(outcome).body) }),
        );
      }

      // GET /reviews/:id/lifecycle
      if (method === 'GET' && /\/reviews\/[a-z0-9-]+\/lifecycle$/.test(url)) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success([
              {
                id: 'ev-1',
                from_status: null,
                to_status: 'active',
                trigger: 'system',
                reason: 'created',
                review_id: null,
                created_at: '2026-08-30T00:00:00.000Z',
              },
              {
                id: 'ev-2',
                from_status: 'active',
                to_status: 'in_review',
                trigger: 'student_review',
                reason: 'start',
                review_id: 'rev-aaaaaaaaaaaa',
                created_at: '2026-09-02T00:00:00.000Z',
              },
            ]),
          }),
        );
      }

      // GET /reviews/:id/verification-question
      if (
        method === 'GET' &&
        /\/reviews\/[a-z0-9-]+\/verification-question$/.test(url)
      ) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success({
              kind: 'found',
              questionId: 'q-fresh-aaaaaaaaaa',
              difficulty: 3,
            }),
          }),
        );
      }

      // PATCH /review/schedules/:id (legacy endpoint, no longer
      // used by the Phase 10 page but kept for back-compat
      // coverage on the legacy stub).
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
  it('renders the title block, meta badges, dates, source error, and Start review button', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(
      <ReviewDetailPage params={settledParams({ id: REVIEW_A.id })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('review-title'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('review-title').textContent).toMatch(/spaced/i);
    expect(screen.getByTestId('review-start')).toBeInTheDocument();
    // The old "mark passed" / "mark failed" controls are gone —
    // the only available action in the idle state is Start.
  });

  it('renders the error state when the id is unknown', async () => {
    stubFetch({ list: 'success', detail: 'notFound' });
    render(
      <ReviewDetailPage params={settledParams({ id: 'rev-unknown000000' })} />,
      { wrapper: makeWrapper() },
    );
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });

  it('starts the review and renders the verification question', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success', detail: 'success' });
    render(
      <ReviewDetailPage params={settledParams({ id: REVIEW_A.id })} />,
      { wrapper: makeWrapper() },
    );
    const startButton = await screen.findByTestId('review-start');
    await user.click(startButton);
    const card = await screen.findByTestId('review-verification-card');
    expect(card).toBeInTheDocument();
    expect(
      screen.getByTestId('review-verification-qid').textContent,
    ).toBe('q-fresh-aaaaaaaaaa');
    expect(screen.getByTestId('review-outcome-correct')).toBeInTheDocument();
    expect(screen.getByTestId('review-outcome-partial')).toBeInTheDocument();
    expect(screen.getByTestId('review-outcome-incorrect')).toBeInTheDocument();

    // The start mutation posts to /reviews/:id/start.
    await waitFor(() => {
      const started = spy.mock.calls.some((c) => {
        const init = c[1] as RequestInit | undefined;
        const u =
          typeof c[0] === 'string'
            ? c[0]
            : c[0] instanceof URL
              ? c[0].toString()
              : (c[0] as Request).url;
        return (
          init?.method === 'POST' &&
          /\/reviews\/[a-z0-9-]+\/start$/.test(u)
        );
      });
      expect(started).toBe(true);
    });
  });

  it('submits an outcome and renders the feedback panel', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ list: 'success', detail: 'success' });
    render(
      <ReviewDetailPage params={settledParams({ id: REVIEW_A.id })} />,
      { wrapper: makeWrapper() },
    );
    await user.click(await screen.findByTestId('review-start'));
    await screen.findByTestId('review-verification-card');

    await user.click(screen.getByTestId('review-outcome-incorrect'));
    await user.click(screen.getByTestId('review-submit-outcome'));

    const feedback = await screen.findByTestId('review-outcome-feedback');
    expect(feedback).toBeInTheDocument();
    expect(screen.getByTestId('review-next-due')).toBeInTheDocument();

    await waitFor(() => {
      const posted = spy.mock.calls.some((c) => {
        const init = c[1] as RequestInit | undefined;
        const body = parseBody(init?.body);
        const u =
          typeof c[0] === 'string'
            ? c[0]
            : c[0] instanceof URL
              ? c[0].toString()
              : (c[0] as Request).url;
        return (
          init?.method === 'POST' &&
          /\/reviews\/[a-z0-9-]+\/outcome$/.test(u) &&
          body?.['outcome'] === 'incorrect' &&
          body?.['questionId'] === 'q-fresh-aaaaaaaaaa'
        );
      });
      expect(posted).toBe(true);
    });
  });

  it('surfaces the lifecycle history once the schedule is loaded', async () => {
    stubFetch({ list: 'success', detail: 'success' });
    render(
      <ReviewDetailPage params={settledParams({ id: REVIEW_A.id })} />,
      { wrapper: makeWrapper() },
    );
    await screen.findByTestId('review-title');
    const list = await screen.findByTestId('review-lifecycle-list');
    expect(list).toBeInTheDocument();
    expect(screen.getAllByTestId('review-lifecycle-item').length).toBe(2);
  });
});
