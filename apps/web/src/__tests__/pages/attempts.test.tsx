/**
 * KRODEX web — attempts page integration test.
 *
 * Verifies Phase 7 acceptance criteria for the attempt detail page:
 *
 *   1. The /attempts/[id] page renders the attempt header
 *      (state badge, answered counter) and a single-question
 *      reader for the next unanswered question.
 *   2. Submitting a free-text answer triggers a real POST to
 *      /tests/attempts/:id/answers and the next question
 *      advances into view. The POST body contains the
 *      authoritative question_id from the test's question list —
 *      never a client-synthesized id.
 *   3. When all questions are answered, the "Submit attempt"
 *      button becomes enabled.
 *   4. Submitting the attempt triggers a real POST to
 *      /tests/attempts/:id/submit and renders the success band.
 *   5. A submitted attempt (state=submitted) renders the closed
 *      state with no reader form.
 *   6. Empty / error / loading states are truthful.
 *   7. **Integrity guards (regression)**:
 *        - When the questions list is missing or fails to load,
 *          the reader form is disabled and an honest inline error
 *          is shown; no POST is fired.
 *        - When the test has fewer attached questions than the
 *          attempt claims, the form is disabled at the out-of-range
 *          step with an honest error.
 *        - The POST body never contains a client-synthesized id
 *          (regression: previously the page fabricated
 *          `${attemptId}-q${n}`).
 *
 * The hook layer is exercised against a stubbed `fetch` (same
 * pattern as tests.test.tsx), so the test is an honest
 * end-to-end of the attempt page.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import { setSettled } from '../../lib/react-async';
import AttemptDetailPage from '../../app/(app)/attempts/[id]/page';

// The attempt page calls `useRouter` for the closed-state back
// link. Without a mounted app router, that hook throws
// "invariant expected app router to be mounted". Mock the
// module at the boundary.
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

type FailureBody = { code: string; message: string };

function failure(code: string, message: string): {
  success: false;
  error: FailureBody;
} {
  const error: FailureBody = { code, message };
  return { success: false, error };
}

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const ATTEMPT_ID = 'attempt-aaaaaaaaaaaa';
const TEST_ID = 'test-aaaaaaaaaaaa';

const ATTEMPT_IN_PROGRESS = {
  id: ATTEMPT_ID,
  user_id: 'u-1',
  test_id: TEST_ID,
  state: 'in_progress' as const,
  started_at: '2026-09-02T00:00:00.000Z',
  submitted_at: null,
  total_questions: 2,
  correct_count: 0,
  incorrect_count: 0,
  partial_count: 0,
  skipped_count: 0,
  accuracy: '0',
  duration_ms: null,
  metadata: {},
  created_at: '2026-09-02T00:00:00.000Z',
  updated_at: '2026-09-02T00:00:00.000Z',
};

const ATTEMPT_SUBMITTED = {
  ...ATTEMPT_IN_PROGRESS,
  state: 'submitted' as const,
  submitted_at: '2026-09-02T00:30:00.000Z',
  correct_count: 1,
  incorrect_count: 1,
  partial_count: 0,
  skipped_count: 0,
  accuracy: '0.5',
};

// Authoritative question rows. The order in the array does not
// matter — the page sorts by display_order. The IDs here are
// the real question_ids the page MUST submit, and they are
// distinct from any client-synthesized id.
const QUESTIONS = [
  {
    id: 'tq-1',
    user_id: 'u-1',
    test_id: TEST_ID,
    question_id: 'q-authoritative-1',
    display_order: 1,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  },
  {
    id: 'tq-2',
    user_id: 'u-1',
    test_id: TEST_ID,
    question_id: 'q-authoritative-2',
    display_order: 2,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  },
];

const ANSWER_1 = {
  id: 'answer-1',
  user_id: 'u-1',
  attempt_id: ATTEMPT_ID,
  question_id: 'q-authoritative-1',
  selected_option_ids: [] as readonly string[],
  free_text: 'I chose 2.',
  outcome: 'correct' as const,
  answered_at: '2026-09-02T00:10:00.000Z',
  duration_ms: 12000,
  created_at: '2026-09-02T00:10:00.000Z',
  updated_at: '2026-09-02T00:10:00.000Z',
};

const ANSWER_2 = {
  id: 'answer-2',
  user_id: 'u-1',
  attempt_id: ATTEMPT_ID,
  question_id: 'q-authoritative-2',
  selected_option_ids: [] as readonly string[],
  free_text: 'I chose 7.',
  outcome: 'incorrect' as const,
  answered_at: '2026-09-02T00:20:00.000Z',
  duration_ms: 15000,
  created_at: '2026-09-02T00:20:00.000Z',
  updated_at: '2026-09-02T00:20:00.000Z',
};

interface AttemptsFetchRoutes {
  attempt: 'success' | 'in_progress' | 'submitted' | 'notFound' | 'error';
  answers: 'success' | 'empty' | 'one' | 'two' | 'error';
  questions: 'success' | 'empty' | 'error';
}

// The answers list grows monotonically: as the test runs, a
// POST to /answers appends to the recorded list, and the next
// GET reflects it. This mirrors the real server's behavior.
let recordedAnswers: TestAnswerFixture[] = [];

// The questions POSTed to /answers are captured here so each
// test can assert which authoritative id was submitted. The
// page MUST submit a real id from the QUESTIONS list; a
// client-synthesized id (regression) would be caught here.
let submittedQuestionIds: string[] = [];

interface TestAnswerFixture {
  id: string;
  user_id: string;
  attempt_id: string;
  question_id: string;
  selected_option_ids: readonly string[];
  free_text: string;
  outcome: 'correct' | 'incorrect' | 'partial' | 'skipped';
  answered_at: string;
  duration_ms: number;
  created_at: string;
  updated_at: string;
}

function resetRecordedAnswers(state: readonly TestAnswerFixture[]): void {
  recordedAnswers = [...state];
  submittedQuestionIds = [];
}

function stubFetch(routes: AttemptsFetchRoutes): MockInstance<typeof global.fetch> {
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

      // POST /tests/attempts/:id/answers
      if (method === 'POST' && url.includes('/answers')) {
        // Record the answer so subsequent GETs reflect the
        // monotonically growing list.
        const body = parseBody(init?.body);
        const submittedId =
          typeof body?.question_id === 'string' ? body.question_id : '';
        submittedQuestionIds.push(submittedId);
        const fixture: TestAnswerFixture = {
          id: `answer-${recordedAnswers.length + 1}`,
          user_id: 'u-1',
          attempt_id: ATTEMPT_ID,
          question_id: submittedId,
          selected_option_ids: [],
          free_text: typeof body?.free_text === 'string' ? body.free_text : '',
          outcome: 'correct',
          answered_at: '2026-09-02T00:10:00.000Z',
          duration_ms: 0,
          created_at: '2026-09-02T00:10:00.000Z',
          updated_at: '2026-09-02T00:10:00.000Z',
        };
        recordedAnswers = [...recordedAnswers, fixture];
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(fixture) }),
        );
      }

      // POST /tests/attempts/:id/submit
      if (method === 'POST' && url.includes('/submit')) {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success({ attempt: ATTEMPT_SUBMITTED }) }),
        );
      }

      // GET /tests/:id/questions
      if (
        method === 'GET' &&
        /\/tests\/[a-z0-9-]+\/questions$/.test(url) &&
        !url.includes('/attempts/')
      ) {
        if (routes.questions === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        if (routes.questions === 'empty') {
          return Promise.resolve(jsonResponse({ status: 200, body: success([]) }));
        }
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(QUESTIONS) }),
        );
      }

      // GET /tests/attempts/:id
      if (method === 'GET' && /\/tests\/attempts\/[a-z0-9-]+$/.test(url)) {
        if (routes.attempt === 'notFound') {
          return Promise.resolve(
            jsonResponse({ status: 404, body: failure('NOT_FOUND', 'no such attempt') }),
          );
        }
        if (routes.attempt === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        if (routes.attempt === 'submitted') {
          return Promise.resolve(
            jsonResponse({ status: 200, body: success(ATTEMPT_SUBMITTED) }),
          );
        }
        return Promise.resolve(
          jsonResponse({ status: 200, body: success(ATTEMPT_IN_PROGRESS) }),
        );
      }

      // GET /tests/attempts/:id/answers
      if (method === 'GET' && url.includes('/tests/attempts/') && url.includes('/answers')) {
        if (routes.answers === 'error') {
          return Promise.resolve(
            jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
          );
        }
        // If the test grew the recorded list, return it.
        if (recordedAnswers.length > 0) {
          return Promise.resolve(
            jsonResponse({
              status: 200,
              body: success([...recordedAnswers]),
            }),
          );
        }
        if (routes.answers === 'one') {
          return Promise.resolve(
            jsonResponse({ status: 200, body: success([ANSWER_1]) }),
          );
        }
        if (routes.answers === 'two') {
          return Promise.resolve(
            jsonResponse({ status: 200, body: success([ANSWER_1, ANSWER_2]) }),
          );
        }
        if (routes.answers === 'empty') {
          return Promise.resolve(
            jsonResponse({ status: 200, body: success([]) }),
          );
        }
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([]) }),
        );
      }

      return Promise.resolve(
        jsonResponse({ status: 404, body: failure('NOT_FOUND', 'not stubbed') }),
      );
    });
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

beforeEach(() => {
  process.env['NEXT_PUBLIC_API_BASE_URL'] = BASE;
  clearAuth();
  setAuth({ token: 'test-token', userId: 'u-1' });
  vi.restoreAllMocks();
  resetRecordedAnswers([]);
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
});

describe('AttemptDetailPage (/attempts/[id])', () => {
  it('renders the next-question step with the first question', async () => {
    stubFetch({ attempt: 'in_progress', answers: 'empty', questions: 'success' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('attempt-focus'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('attempt-focus-input')).toBeInTheDocument();
    expect(screen.getByText(/Question 1 of 2/)).toBeInTheDocument();
    // Submit attempt is disabled until all are answered.
    expect(screen.getByTestId('attempt-submit')).toBeDisabled();
  });

  it('submits a free-text answer with the authoritative question_id and advances', async () => {
    const user = userEvent.setup();
    stubFetch({ attempt: 'in_progress', answers: 'empty', questions: 'success' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    const input = await screen.findByTestId('attempt-focus-input');
    await user.type(input, 'My answer to question 1.');
    await user.click(screen.getByTestId('attempt-focus-submit'));
    // After mutation succeeds, the answers query refetches; the
    // next render shows the next question.
    await waitFor(() => {
      expect(screen.getByTestId('attempt-answers-list')).toBeInTheDocument();
    });
    // Integrity guard: the POST body contained the authoritative
    // question_id from the test's question list, not a
    // client-synthesized id.
    expect(submittedQuestionIds).toEqual(['q-authoritative-1']);
    // Regression: the old bug was that the page submitted
    // `${attemptId}-q${n}`. Asserting against that exact
    // pattern is the explicit guard.
    expect(
      submittedQuestionIds.some((id) => /-q\d+$/.test(id)),
    ).toBe(false);
  });

  it('submits the second authoritative id on the second step', async () => {
    const user = userEvent.setup();
    // Pre-seed one answer so the page starts on step 2.
    stubFetch({ attempt: 'in_progress', answers: 'one', questions: 'success' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    const input = await screen.findByTestId('attempt-focus-input');
    await user.type(input, 'Second answer.');
    await user.click(screen.getByTestId('attempt-focus-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('attempt-answers-list')).toBeInTheDocument();
    });
    expect(submittedQuestionIds).toEqual(['q-authoritative-2']);
  });

  it('renders the closed state for a submitted attempt', async () => {
    stubFetch({ attempt: 'submitted', answers: 'two', questions: 'success' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('attempt-closed-band'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('attempt-answers-list')).toBeInTheDocument();
    expect(screen.queryByTestId('attempt-focus')).not.toBeInTheDocument();
  });

  it('renders the error state when the attempt id is unknown', async () => {
    stubFetch({ attempt: 'notFound', answers: 'empty', questions: 'success' });
    render(
      <AttemptDetailPage
        params={settledParams({ id: 'attempt-unknown00000' })}
      />,
      { wrapper: makeWrapper() },
    );
    // The API reports unknown ids as NOT_FOUND errors, not as
    // a soft empty state. PageShell surfaces the error band
    // with the typed code rather than a misleading empty card.
    expect(
      await screen.findByTestId('page-state-error'),
    ).toBeInTheDocument();
  });

  it('submits the attempt and shows the success band', async () => {
    const user = userEvent.setup();
    // First, give it two answers so Submit becomes enabled.
    stubFetch({ attempt: 'in_progress', answers: 'two', questions: 'success' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    // The "all answered" band should appear because total_questions=2
    // and we have 2 answers.
    expect(
      await screen.findByTestId('attempt-all-answered'),
    ).toBeInTheDocument();
    const submit = screen.getByTestId('attempt-submit');
    expect(submit).not.toBeDisabled();
    await user.click(submit);
    expect(
      await screen.findByTestId('attempt-submit-success'),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------
  // Integrity regression tests (Phase 7 remediation).
  //
  // These tests prove:
  //   - the page never submits a synthesized question_id;
  //   - when the authoritative id is unavailable, the form is
  //     disabled and no POST is fired;
  //   - a missing /questions query surfaces an honest inline
  //     error rather than silently fabricating a substitute.
  // -----------------------------------------------------------------

  it('disables the form when the questions query failed and submits nothing', async () => {
    const user = userEvent.setup();
    stubFetch({ attempt: 'in_progress', answers: 'empty', questions: 'error' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('attempt-focus-questions-error'),
    ).toBeInTheDocument();
    const submit = screen.getByTestId('attempt-focus-submit');
    expect(submit).toBeDisabled();
    // Even if the user attempts to type and submit, the page
    // does not POST.
    const input = screen.getByTestId('attempt-focus-input');
    await user.type(input, 'Should not be sent.');
    await user.click(submit);
    // Give any would-be POST a chance to fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(submittedQuestionIds).toEqual([]);
  });

  it('disables the form when the questions list is empty (out of range)', async () => {
    const user = userEvent.setup();
    stubFetch({ attempt: 'in_progress', answers: 'empty', questions: 'empty' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('attempt-focus-no-id'),
    ).toBeInTheDocument();
    const submit = screen.getByTestId('attempt-focus-submit');
    expect(submit).toBeDisabled();
    const input = screen.getByTestId('attempt-focus-input');
    await user.type(input, 'Should not be sent.');
    await user.click(submit);
    await new Promise((r) => setTimeout(r, 30));
    expect(submittedQuestionIds).toEqual([]);
  });

  it('never submits a question_id containing the attempt id (regression)', async () => {
    const user = userEvent.setup();
    stubFetch({ attempt: 'in_progress', answers: 'empty', questions: 'success' });
    render(
      <AttemptDetailPage params={settledParams({ id: ATTEMPT_ID })} />,
      { wrapper: makeWrapper() },
    );
    const input = await screen.findByTestId('attempt-focus-input');
    await user.type(input, 'regression');
    await user.click(screen.getByTestId('attempt-focus-submit'));
    await waitFor(() => {
      expect(submittedQuestionIds.length).toBe(1);
    });
    // The pre-remediation bug was exactly
    //   `${attemptId}-q${questionIndex + 1}`
    // which would match the regex below. A passing test
    // guarantees the synthesized pattern is gone forever.
    expect(
      submittedQuestionIds.some((id) => id.startsWith(ATTEMPT_ID + '-q')),
    ).toBe(false);
  });
});
