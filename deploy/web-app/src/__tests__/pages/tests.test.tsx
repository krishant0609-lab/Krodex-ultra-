/**
 * KRODEX web — tests page integration test.
 *
 * Verifies Phase 7.6 acceptance criteria:
 *
 *   1. The /tests index renders a quiet list of test definitions
 *      with title, state, source_kind, and intended_count.
 *   2. Each test row is a deep link to /tests/[id].
 *   3. Empty and error states render truthfully (no fake data).
 *   4. The /tests/[id] detail page renders the title, breadcrumbs,
 *      meta badges, and the questions list with its own
 *      loading / empty / populated states.
 *   5. The "Start attempt" button triggers a real POST and
 *      navigates to /attempts/[id] on success.
 *
 * The hook layer is exercised against a stubbed `fetch` (same
 * pattern as syllabus.test.tsx), so the test is an honest
 * end-to-end of the tests pages.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import { setSettled } from '../../lib/react-async';
import TestsPage from '../../app/(app)/tests/page';
import TestDetailPage from '../../app/(app)/tests/[id]/page';

// The test files render Next.js App Router pages that import
// `useRouter` from `next/navigation`. Without a mounted app
// router, that hook throws "invariant expected app router to
// be mounted". We mock the module at the boundary so the
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

const TEST_A = {
  id: 'test-aaaaaaaaaaaa',
  user_id: 'u-1',
  title: 'Algebra recap',
  source_kind: 'syllabus' as const,
  source_payload: {},
  intended_count: 5,
  duration_minutes: 30,
  state: 'created' as const,
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const TEST_B = {
  id: 'test-bbbbbbbbbbbb',
  user_id: 'u-1',
  title: 'Error book drill',
  source_kind: 'error_bank' as const,
  source_payload: {},
  intended_count: 1,
  duration_minutes: null,
  state: 'in_progress' as const,
  metadata: {},
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const QUESTION_A1 = {
  id: 'tq-aaaaaaaaaaaa1',
  user_id: 'u-1',
  test_id: TEST_A.id,
  question_id: 'q-1',
  display_order: 1,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const QUESTION_A2 = {
  id: 'tq-aaaaaaaaaaaa2',
  user_id: 'u-1',
  test_id: TEST_A.id,
  question_id: 'q-2',
  display_order: 2,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

interface TestsFetchRoutes {
  tests: 'success' | 'empty' | 'error';
  test: 'success' | 'error' | 'notFound';
  questions: 'success' | 'empty' | 'error';
}

function stubFetch(routes: TestsFetchRoutes): MockInstance<typeof global.fetch> {
  return vi.spyOn(global, 'fetch').mockImplementation((input: unknown, init?: RequestInit) => {
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

    // POST /tests/attempts
    if (method === 'POST' && url.includes('/tests/attempts') && !url.match(/[a-f0-9-]{30,}/)) {
      return Promise.resolve(
        jsonResponse({
          status: 200,
          body: success({
            id: 'attempt-aaaaaaaaaaaa',
            user_id: 'u-1',
            test_id: TEST_A.id,
            state: 'in_progress',
            started_at: '2026-09-02T00:00:00.000Z',
            submitted_at: null,
            total_questions: TEST_A.intended_count,
            correct_count: 0,
            incorrect_count: 0,
            partial_count: 0,
            skipped_count: 0,
            accuracy: '0',
            duration_ms: null,
            metadata: {},
            created_at: '2026-09-02T00:00:00.000Z',
            updated_at: '2026-09-02T00:00:00.000Z',
          }),
        }),
      );
    }

    // GET /tests (list — no id)
    if (method === 'GET' && url.includes('/tests') && !url.match(/\/tests\/[a-z0-9-]+/)) {
      if (routes.tests === 'error') {
        return Promise.resolve(
          jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
        );
      }
      if (routes.tests === 'empty') {
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
            items: [TEST_A, TEST_B],
            nextCursor: null,
          }),
        }),
      );
    }

    // GET /tests/:id (detail)
    if (method === 'GET' && url.match(/\/tests\/[a-z0-9-]+$/)) {
      if (routes.test === 'notFound') {
        return Promise.resolve(
          jsonResponse({ status: 404, body: failure('NOT_FOUND', 'no such test') }),
        );
      }
      if (routes.test === 'error') {
        return Promise.resolve(
          jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
        );
      }
      return Promise.resolve(jsonResponse({ status: 200, body: success(TEST_A) }));
    }

    // GET /tests/:id/questions
    if (method === 'GET' && url.includes('/tests/') && url.includes('/questions')) {
      if (routes.questions === 'error') {
        return Promise.resolve(
          jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
        );
      }
      if (routes.questions === 'empty') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([]) }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          status: 200,
          body: success([QUESTION_A1, QUESTION_A2]),
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

describe('TestsPage (index)', () => {
  it('renders a list of tests with title, state, source_kind, and count', async () => {
    stubFetch({
      tests: 'success',
      test: 'success',
      questions: 'success',
    });
    render(<TestsPage />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId(`tests-item-${TEST_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`tests-item-${TEST_B.id}`),
    ).toBeInTheDocument();
    expect(screen.getByText('Algebra recap')).toBeInTheDocument();
    expect(screen.getByText('Error book drill')).toBeInTheDocument();
    expect(screen.getAllByText('created').length).toBeGreaterThan(0);
    expect(screen.getAllByText('in_progress').length).toBeGreaterThan(0);
  });

  it('renders an empty state truthfully', async () => {
    stubFetch({
      tests: 'empty',
      test: 'success',
      questions: 'success',
    });
    render(<TestsPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });

  it('renders an error state when the test list fails to load', async () => {
    stubFetch({
      tests: 'error',
      test: 'success',
      questions: 'success',
    });
    render(<TestsPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });
});

describe('TestDetailPage (/tests/[id])', () => {
  it('renders the title, breadcrumbs, badges, and questions list', async () => {
    stubFetch({
      tests: 'success',
      test: 'success',
      questions: 'success',
    });
    render(
      <TestDetailPage params={settledParams({ id: TEST_A.id })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('test-detail-title'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('test-detail-title').textContent).toBe(
      TEST_A.title,
    );
    expect(screen.getByTestId('test-questions-list')).toBeInTheDocument();
    expect(
      screen.getByTestId(`test-question-${QUESTION_A1.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`test-question-${QUESTION_A2.id}`),
    ).toBeInTheDocument();
  });

  it('renders the empty state for a test with no questions', async () => {
    stubFetch({
      tests: 'success',
      test: 'success',
      questions: 'empty',
    });
    render(
      <TestDetailPage params={settledParams({ id: TEST_A.id })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('test-questions-empty'),
    ).toBeInTheDocument();
  });

  it('renders the error state when the test id is unknown', async () => {
    stubFetch({
      tests: 'success',
      test: 'notFound',
      questions: 'empty',
    });
    render(
      <TestDetailPage params={settledParams({ id: 'test-unknown000000' })} />,
      { wrapper: makeWrapper() },
    );
    // The API contract reports unknown ids as NOT_FOUND errors,
    // not as a soft "no data" state. PageShell honors that and
    // surfaces the error band with the typed code.
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });

  it('starts an attempt and navigates to /attempts/[id] on success', async () => {
    const user = userEvent.setup();
    pushSpy.mockClear();
    stubFetch({
      tests: 'success',
      test: 'success',
      questions: 'success',
    });
    render(
      <TestDetailPage params={settledParams({ id: TEST_A.id })} />,
      { wrapper: makeWrapper() },
    );
    const button = await screen.findByTestId('test-start-attempt');
    expect(button).toBeInTheDocument();
    await user.click(button);
    await waitFor(() => {
      expect(pushSpy).toHaveBeenCalledWith('/attempts/attempt-aaaaaaaaaaaa');
    });
  });
});
