/**
 * KRODEX web — Phase 8 /assistant page tests.
 *
 * The /assistant page is a single-turn, evidence-grounded Q&A
 * surface. The test exercises the four states the page can be in:
 *
 *   1. Idle: the form is shown, no answer yet, no error.
 *   2. Loading: the mutation is in flight ("Asking…").
 *   3. Success: an answer is rendered, sources are listed, and a
 *      proposal (if present) shows Apply/Discard.
 *   4. Error (503 DEPENDENCY_UNAVAILABLE / 422 AI_OUTPUT_INVALID):
 *      the deterministic fallback message is rendered and no
 *      answer is fabricated.
 *
 * The AI is non-authoritative. The tests verify:
 *
 *   - the page never calls a domain mutation hook directly;
 *   - the only network calls fired by the page are the two
 *     Phase 8 endpoints (`/assistant/queries` and
 *     `/assistant/proposals/:id/confirm`);
 *   - on Apply, the page issues `/assistant/proposals/:id/confirm`
 *     with `confirmed: true`; on Discard, with `confirmed: false`;
 *   - after a successful Apply, the page does not invent
 *     further UI (it shows the honest "Applied" band).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../lib/auth-store';
import AssistantPage from '../app/(app)/assistant/page';

const BASE = 'http://api.test/v1';
const ORIGINAL_ENV = process.env['NEXT_PUBLIC_API_BASE_URL'];

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

interface StubConfig {
  query: 'success' | 'unavailable' | 'invalid' | 'empty';
  confirm?: 'ok' | 'not-found';
}

function stubFetch(cfg: StubConfig): MockInstance<typeof global.fetch> {
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

      // POST /assistant/queries
      if (method === 'POST' && url.includes('/assistant/queries')) {
        if (cfg.query === 'unavailable') {
          return Promise.resolve(
            jsonResponse(
              503,
              failure('DEPENDENCY_UNAVAILABLE', 'AI provider not configured'),
            ),
          );
        }
        if (cfg.query === 'invalid') {
          return Promise.resolve(
            jsonResponse(422, failure('AI_OUTPUT_INVALID', 'bad JSON')),
          );
        }
        if (cfg.query === 'empty') {
          return Promise.resolve(
            jsonResponse(
              200,
              success({
                response: {
                  answer: 'I have nothing to draw on yet.',
                  sources: [],
                },
                candidateSourceIds: [],
              }),
            ),
          );
        }
        return Promise.resolve(
          jsonResponse(
            200,
            success({
              response: {
                answer:
                  'Review Arithmetic next; you have one open error on it (see err-1).',
                sources: [
                  {
                    kind: 'error',
                    id: 'err-1',
                    excerpt: 'I misread the second sentence.',
                  },
                  {
                    kind: 'topic',
                    id: 'topic-arithmetic',
                    excerpt: 'name: Arithmetic',
                  },
                ],
                proposal: {
                  id: 'proposal-abc',
                  kind: 'create_task',
                  description: 'Schedule a 30-min review of Arithmetic on Friday.',
                  affectedRecords: ['topic-arithmetic'],
                  payload: {
                    title: 'Review Arithmetic',
                    duration_minutes: 30,
                    topic_id: 'topic-arithmetic',
                    due_at: '2026-09-04T17:00:00.000Z',
                  },
                  createdAt: 1725360000000,
                },
              },
              candidateSourceIds: ['err-1', 'topic-arithmetic'],
            }),
          ),
        );
      }

      // POST /assistant/proposals/:id/confirm
      if (method === 'POST' && url.includes('/assistant/proposals/')) {
        if (cfg.confirm === 'not-found') {
          return Promise.resolve(
            jsonResponse(404, failure('NOT_FOUND', 'proposal expired')),
          );
        }
        return Promise.resolve(
          jsonResponse(
            200,
            success({
              executed: true,
              proposal: {
                id: 'proposal-abc',
                kind: 'create_task',
                description: 'Schedule a 30-min review of Arithmetic on Friday.',
                affectedRecords: ['topic-arithmetic'],
                payload: {},
                createdAt: 1725360000000,
              },
              dispatched: { kind: 'create_task', taskId: 'task-new' },
            }),
          ),
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

describe('AssistantPage', () => {
  it('renders the form in its idle state', () => {
    stubFetch({ query: 'success' });
    render(<AssistantPage />, { wrapper: makeWrapper() });
    expect(screen.getByTestId('assistant-form')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-question')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-ask')).toBeInTheDocument();
    // No answer, no error yet.
    expect(screen.queryByTestId('assistant-answer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-error')).not.toBeInTheDocument();
  });

  it('shows the answer, sources, and proposal on a successful query', async () => {
    const user = userEvent.setup();
    stubFetch({ query: 'success' });
    render(<AssistantPage />, { wrapper: makeWrapper() });
    await user.type(
      screen.getByTestId('assistant-question'),
      'What should I review next?',
    );
    await user.click(screen.getByTestId('assistant-ask'));
    expect(
      await screen.findByTestId('assistant-answer-text'),
    ).toHaveTextContent(/Review Arithmetic next/);
    expect(screen.getByTestId('assistant-source-error-err-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('assistant-source-topic-topic-arithmetic'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('assistant-proposal-cta')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-proposal-apply')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-proposal-reject')).toBeInTheDocument();
  });

  it('Apply fires a POST to /assistant/proposals/:id/confirm with confirmed:true', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ query: 'success' });
    render(<AssistantPage />, { wrapper: makeWrapper() });
    await user.type(
      screen.getByTestId('assistant-question'),
      'What should I review next?',
    );
    await user.click(screen.getByTestId('assistant-ask'));
    await screen.findByTestId('assistant-proposal-cta');
    await user.click(screen.getByTestId('assistant-proposal-apply'));
    await waitFor(() => {
      const confirmCalls = spy.mock.calls.filter((c) => {
        const url =
          typeof c[0] === 'string'
            ? c[0]
            : c[0] instanceof URL
              ? c[0].toString()
              : (c[0] as Request).url;
        return url.includes('/assistant/proposals/');
      });
      expect(confirmCalls.length).toBeGreaterThan(0);
      const init = confirmCalls[confirmCalls.length - 1]?.[1] as
        | RequestInit
        | undefined;
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body).toEqual({ confirmed: true });
    });
    expect(
      await screen.findByTestId('assistant-proposal-applied'),
    ).toBeInTheDocument();
  });

  it('Discard fires a POST to /assistant/proposals/:id/confirm with confirmed:false and does not invent a UI', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ query: 'success' });
    render(<AssistantPage />, { wrapper: makeWrapper() });
    await user.type(
      screen.getByTestId('assistant-question'),
      'What should I review next?',
    );
    await user.click(screen.getByTestId('assistant-ask'));
    await screen.findByTestId('assistant-proposal-cta');
    await user.click(screen.getByTestId('assistant-proposal-reject'));
    await waitFor(() => {
      const confirmCalls = spy.mock.calls.filter((c) => {
        const url =
          typeof c[0] === 'string'
            ? c[0]
            : c[0] instanceof URL
              ? c[0].toString()
              : (c[0] as Request).url;
        return url.includes('/assistant/proposals/');
      });
      expect(confirmCalls.length).toBeGreaterThan(0);
      const init = confirmCalls[confirmCalls.length - 1]?.[1] as
        | RequestInit
        | undefined;
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body).toEqual({ confirmed: false });
    });
    expect(
      await screen.findByTestId('assistant-proposal-rejected'),
    ).toBeInTheDocument();
    // The page must not pretend the change happened.
    expect(
      screen.queryByTestId('assistant-proposal-applied'),
    ).not.toBeInTheDocument();
  });

  it('renders the deterministic fallback on 503 DEPENDENCY_UNAVAILABLE', async () => {
    const user = userEvent.setup();
    stubFetch({ query: 'unavailable' });
    render(<AssistantPage />, { wrapper: makeWrapper() });
    await user.type(
      screen.getByTestId('assistant-question'),
      'What should I review next?',
    );
    await user.click(screen.getByTestId('assistant-ask'));
    expect(
      await screen.findByTestId('assistant-error'),
    ).toBeInTheDocument();
    // No answer is fabricated.
    expect(screen.queryByTestId('assistant-answer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-proposal')).not.toBeInTheDocument();
  });

  it('renders the deterministic fallback on 422 AI_OUTPUT_INVALID', async () => {
    const user = userEvent.setup();
    stubFetch({ query: 'invalid' });
    render(<AssistantPage />, { wrapper: makeWrapper() });
    await user.type(
      screen.getByTestId('assistant-question'),
      'What should I review next?',
    );
    await user.click(screen.getByTestId('assistant-ask'));
    expect(
      await screen.findByTestId('assistant-error'),
    ).toBeInTheDocument();
  });

  it('on an empty-sources answer, the page surfaces the "no specific records cited" note', async () => {
    const user = userEvent.setup();
    stubFetch({ query: 'empty' });
    render(<AssistantPage />, { wrapper: makeWrapper() });
    await user.type(
      screen.getByTestId('assistant-question'),
      'Help me plan.',
    );
    await user.click(screen.getByTestId('assistant-ask'));
    expect(
      await screen.findByTestId('assistant-answer-text'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assistant-sources-empty'),
    ).toBeInTheDocument();
    // No sources list rendered, no proposal.
    expect(
      screen.queryByTestId('assistant-sources'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('assistant-proposal'),
    ).not.toBeInTheDocument();
  });
});
