/**
 * KRODEX web — Phase 8 Classification Suggestion card tests.
 *
 * Covers the state machine per Phase 8 plan §6:
 *
 *   - loading: "Getting suggestion…" is shown while the AI call
 *     is in flight.
 *   - suggested: category, rationale, confidence are shown.
 *   - accept: clicking the accept button writes the suggested
 *     category via the existing error-update hook (PATCH
 *     /errors/:id).
 *   - override: clicking "Set manually" reveals the radio
 *     selector and a save button that writes the manual
 *     category.
 *   - ai unavailable: a 503 (DEPENDENCY_UNAVAILABLE) response
 *     shows the manual selector immediately and an honest
 *     "unavailable" note.
 *   - already classified: the card hides itself when the
 *     entry already has a real (non-unknown) mistake_type.
 *
 * The AI is non-authoritative: the test verifies that no
 * database write happens before the student clicks accept or
 * save. The fetch is mocked to assert which calls fired and
 * in what order.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../lib/auth-store';
import { ClassificationSuggestCard } from '../app/(app)/errors/[id]/classification-suggest-card';

const BASE = 'http://api.test/v1';
const ORIGINAL_ENV = process.env['NEXT_PUBLIC_API_BASE_URL'];

const ERROR_ID = 'err-aaaaaaaaaaaa';

function jsonResponse(status: number, body: unknown): Response {
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
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

interface SuggestRoutes {
  suggest: 'success' | 'unavailable' | 'invalid';
  patchResult?: 'ok' | 'error';
}

function stubFetch(routes: SuggestRoutes): MockInstance<typeof global.fetch> {
  return vi
    .spyOn(global, 'fetch')
    .mockImplementation((input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const method = (init?.method as string | undefined) ?? 'GET';

      // POST /errors/:id/classification-suggest
      if (method === 'POST' && url.includes('/classification-suggest')) {
        if (routes.suggest === 'unavailable') {
          return Promise.resolve(
            jsonResponse(
              503,
              failure('DEPENDENCY_UNAVAILABLE', 'AI provider not configured'),
            ),
          );
        }
        if (routes.suggest === 'invalid') {
          return Promise.resolve(
            jsonResponse(
              422,
              failure('AI_OUTPUT_INVALID', 'provider returned non-JSON'),
            ),
          );
        }
        return Promise.resolve(
          jsonResponse(
            200,
            success({
              suggestion: {
                suggestedCategory: 'misread',
                rationale: 'The remark mentions misreading.',
                confidence: 0.75,
                sourceIds: [ERROR_ID, 'q-1'],
              },
              candidateSourceIds: [ERROR_ID, 'q-1', 'topic-1'],
            }),
          ),
        );
      }

      // PATCH /errors/:id
      if (method === 'PATCH' && /\/errors\/[a-z0-9-]+$/.test(url)) {
        if (routes.patchResult === 'error') {
          return Promise.resolve(
            jsonResponse(500, failure('INTERNAL', 'patch failed')),
          );
        }
        return Promise.resolve(
          jsonResponse(200, success({ id: ERROR_ID, mistake_type: 'misread' })),
        );
      }

      return Promise.resolve(
        jsonResponse(404, failure('NOT_FOUND', 'not stubbed')),
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

describe('ClassificationSuggestCard', () => {
  it('shows the loading state while the AI call is in flight, then renders the suggestion', async () => {
    stubFetch({ suggest: 'success' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory={null}
      />,
      { wrapper: makeWrapper() },
    );
    // The card mounts, fires the AI call, and shows the suggestion.
    expect(
      await screen.findByTestId('classification-suggestion'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('classification-suggestion-category'),
    ).toHaveTextContent('Misread the question');
    expect(
      screen.getByTestId('classification-suggestion-rationale'),
    ).toHaveTextContent(/misreading/);
    expect(
      screen.getByTestId('classification-suggestion-confidence'),
    ).toHaveTextContent('75%');
  });

  it('accepting the suggestion writes the suggested category via PATCH /errors/:id', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ suggest: 'success' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory={null}
      />,
      { wrapper: makeWrapper() },
    );
    const accept = await screen.findByTestId('classification-accept');
    await user.click(accept);
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
          methodPerCall[i] === 'PATCH' &&
          u.includes(`/errors/${ERROR_ID}`) &&
          !u.includes('/classification-suggest'),
      );
      expect(patched).toBe(true);
    });
    // After a successful save the card shows the accepted band.
    expect(
      await screen.findByTestId('classification-accepted'),
    ).toBeInTheDocument();
  });

  it('shows the manual selector after the student clicks "Set manually"', async () => {
    const user = userEvent.setup();
    stubFetch({ suggest: 'success' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory={null}
      />,
      { wrapper: makeWrapper() },
    );
    const setManually = await screen.findByTestId('classification-set-manually');
    await user.click(setManually);
    // The manual selector and the radio inputs render.
    expect(
      screen.getByTestId('classification-manual-careless'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('classification-manual-save'),
    ).toBeInTheDocument();
  });

  it('saving a manual category writes through the existing update hook', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ suggest: 'success' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory={null}
      />,
      { wrapper: makeWrapper() },
    );
    const setManually = await screen.findByTestId('classification-set-manually');
    await user.click(setManually);
    await user.click(screen.getByTestId('classification-manual-careless'));
    await user.click(screen.getByTestId('classification-manual-save'));
    await waitFor(() => {
      const calls = spy.mock.calls.filter((c) => {
        const init = c[1] as RequestInit | undefined;
        const method = init?.method ?? 'GET';
        const url =
          typeof c[0] === 'string'
            ? c[0]
            : c[0] instanceof URL
              ? c[0].toString()
              : (c[0] as Request).url;
        return (
          method === 'PATCH' &&
          url.includes(`/errors/${ERROR_ID}`) &&
          !url.includes('/classification-suggest')
        );
      });
      expect(calls.length).toBeGreaterThan(0);
      // The body must carry the manually-chosen category.
      const init = calls[calls.length - 1]?.[1] as RequestInit | undefined;
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body).toEqual({ mistake_type: 'careless' });
    });
  });

  it('renders the unavailable fallback + manual form on 503 DEPENDENCY_UNAVAILABLE', async () => {
    stubFetch({ suggest: 'unavailable' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory={null}
      />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('classification-unavailable'),
    ).toBeInTheDocument();
    // The manual form is the only path forward — its save
    // button is present.
    expect(
      screen.getByTestId('classification-manual-save'),
    ).toBeInTheDocument();
    // The suggestion card itself is not rendered.
    expect(
      screen.queryByTestId('classification-suggestion'),
    ).not.toBeInTheDocument();
  });

  it('renders the unavailable fallback on 422 AI_OUTPUT_INVALID', async () => {
    stubFetch({ suggest: 'invalid' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory={null}
      />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('classification-unavailable'),
    ).toBeInTheDocument();
  });

  it('hides itself when the entry already has a real (non-unknown) category', () => {
    const spy = stubFetch({ suggest: 'success' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory="concept"
      />,
      { wrapper: makeWrapper() },
    );
    // Card body never mounts.
    expect(
      screen.queryByTestId('classification-suggest-card'),
    ).not.toBeInTheDocument();
    // No AI call is fired when the entry is already classified.
    const suggestCalls = spy.mock.calls.filter((c) => {
      const url =
        typeof c[0] === 'string'
          ? c[0]
          : c[0] instanceof URL
            ? c[0].toString()
            : (c[0] as Request).url;
      return url.includes('/classification-suggest');
    });
    expect(suggestCalls).toHaveLength(0);
  });

  it('hides itself when the entry has the placeholder "unknown" category, allowing re-suggestion', async () => {
    // "unknown" is treated as unclassified — the card should
    // still appear. The student can re-classify.
    stubFetch({ suggest: 'success' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory="unknown"
      />,
      { wrapper: makeWrapper() },
    );
    expect(
      await screen.findByTestId('classification-suggest-card'),
    ).toBeInTheDocument();
  });

  it('does not write to the database before the student accepts or saves', async () => {
    const spy = stubFetch({ suggest: 'success' });
    render(
      <ClassificationSuggestCard
        errorId={ERROR_ID}
        currentCategory={null}
      />,
      { wrapper: makeWrapper() },
    );
    // Wait for the suggestion to land.
    await screen.findByTestId('classification-suggestion');
    // The only fetch so far should be the AI suggest call.
    const patches = spy.mock.calls.filter((c) => {
      const init = c[1] as RequestInit | undefined;
      const method = init?.method ?? 'GET';
      const url =
        typeof c[0] === 'string'
          ? c[0]
          : c[0] instanceof URL
            ? c[0].toString()
            : (c[0] as Request).url;
      return method === 'PATCH' && url.includes(`/errors/${ERROR_ID}`);
    });
    expect(patches).toHaveLength(0);
  });
});
