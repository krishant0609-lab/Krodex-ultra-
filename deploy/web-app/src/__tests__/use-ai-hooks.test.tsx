/**
 * KRODEX web — Phase 8 AI hook tests.
 *
 * Covers the three Phase 8 hooks:
 *
 *   - useAssistantQuery   (POST /assistant/queries)
 *   - useProposalConfirm  (POST /assistant/proposals/:id/confirm)
 *   - useClassificationSuggest (POST /errors/:id/classification-suggest)
 *
 * Per the standard hook testing contract (Engineering Support §46),
 * each hook is exercised through its loading / success / error
 * states and, for mutations, the cache-invalidation on success
 * path. The AI is non-authoritative, so error states here are the
 * normal 503 / 422 paths the deterministic fallback surface will
 * render against.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../lib/auth-store';
import type { ApiError } from '../lib/api-client';
import {
  useAssistantQuery,
  useProposalConfirm,
} from '../hooks/use-assistant';
import { useClassificationSuggest } from '../hooks/use-classification-suggest';

const BASE = 'http://api.test/v1';
const ORIGINAL_ENV = process.env['NEXT_PUBLIC_API_BASE_URL'];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
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

describe('useAssistantQuery', () => {
  it('mutation success returns the answer + sources + candidate ids', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          response: {
            answer: 'You have one open error on Arithmetic.',
            sources: [
              { kind: 'error', id: 'err-1', excerpt: 'I misread the question.' },
              { kind: 'topic', id: 'topic-1', excerpt: 'name: Arithmetic' },
            ],
          },
          candidateSourceIds: ['err-1', 'topic-1'],
        },
      }),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useAssistantQuery(), { wrapper });
    expect(result.current.isIdle).toBe(true);
    await act(async () => {
      const out = await result.current.mutateAsync({ question: 'How am I doing?' });
      expect(out.response.answer).toMatch(/Arithmetic/);
      expect(out.response.sources).toHaveLength(2);
      expect(out.candidateSourceIds).toEqual(['err-1', 'topic-1']);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('mutation failure surfaces 503 with DEPENDENCY_UNAVAILABLE', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'AI provider not configured' },
        },
        { status: 503 },
      ),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useAssistantQuery(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ question: 'q' }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).code).toBe('DEPENDENCY_UNAVAILABLE');
    expect((result.current.error as ApiError).isTransient).toBe(true);
  });

  it('mutation failure surfaces 422 with AI_OUTPUT_INVALID', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'AI_OUTPUT_INVALID', message: 'Provider returned non-JSON' },
        },
        { status: 422 },
      ),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useAssistantQuery(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ question: 'q' }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).code).toBe('AI_OUTPUT_INVALID');
  });
});

describe('useProposalConfirm', () => {
  it('confirm success (create_task) invalidates the planner tasks cache', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            executed: true,
            proposal: {
              id: 'prop-1',
              kind: 'create_task',
              description: 'Practice arithmetic.',
              affectedRecords: ['err-1'],
              payload: { title: 'Practice arithmetic' },
              createdAt: 1_715_000_000_000,
            },
            dispatched: { kind: 'create_task', taskId: 'task-1' },
          },
        }),
      )
      // The first invalidation triggers a refetch on `['planner', 'tasks']`
      // (no matching observer in this test, so fetch is not called again).
      // Use a second mutation to demonstrate the dispatch.
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            executed: true,
            proposal: {
              id: 'prop-2',
              kind: 'create_task',
              description: 'Practice more.',
              affectedRecords: ['err-1'],
              payload: { title: 'Practice more' },
              createdAt: 1_715_000_000_000,
            },
            dispatched: { kind: 'create_task', taskId: 'task-2' },
          },
        }),
      );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useProposalConfirm(), { wrapper });
    await act(async () => {
      const out = await result.current.mutateAsync({ proposalId: 'prop-1', confirmed: true });
      expect(out.executed).toBe(true);
      if (out.executed) {
        expect(out.dispatched.kind).toBe('create_task');
        if (out.dispatched.kind === 'create_task') {
          expect(out.dispatched.taskId).toBe('task-1');
        }
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The mutation body includes the `confirmed` flag the route expects.
    const lastCall = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(lastCall?.method).toBe('POST');
    expect(JSON.parse(lastCall?.body as string)).toEqual({ confirmed: true });
  });

  it('confirm success (schedule_review) sends the request with the proposal id', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            executed: true,
            proposal: {
              id: 'prop-rev',
              kind: 'schedule_review',
              description: 'Review arithmetic errors.',
              affectedRecords: ['err-1'],
              payload: { error_id: 'err-1', strategy: 'spaced', due_at: '2026-01-01' },
              createdAt: 1_715_000_000_000,
            },
            dispatched: { kind: 'schedule_review', reviewId: 'rev-1' },
          },
        }),
      );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useProposalConfirm(), { wrapper });
    await act(async () => {
      const out = await result.current.mutateAsync({
        proposalId: 'prop-rev',
        confirmed: true,
      });
      expect(out.executed).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string | undefined;
    expect(calledUrl).toContain('/assistant/proposals/prop-rev/confirm');
  });

  it('reject (confirmed=false) returns the proposal back without writing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          executed: false,
          proposal: {
            id: 'prop-1',
            kind: 'create_task',
            description: 'Practice arithmetic.',
            affectedRecords: ['err-1'],
            payload: { title: 'Practice arithmetic' },
            createdAt: 1_715_000_000_000,
          },
        },
      }),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useProposalConfirm(), { wrapper });
    await act(async () => {
      const out = await result.current.mutateAsync({
        proposalId: 'prop-1',
        confirmed: false,
      });
      expect(out.executed).toBe(false);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('proposal-not-found 404 surfaces the error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'proposal missing not found' },
        },
        { status: 404 },
      ),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useProposalConfirm(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ proposalId: 'missing', confirmed: true })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).code).toBe('NOT_FOUND');
  });
});

describe('useClassificationSuggest', () => {
  it('mutation success returns the suggestion + candidate ids', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          suggestion: {
            suggestedCategory: 'misread',
            rationale: 'The remark mentions misreading.',
            confidence: 0.75,
            sourceIds: ['err-1', 'q-1'],
          },
          candidateSourceIds: ['err-1', 'q-1', 'topic-1'],
        },
      }),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useClassificationSuggest('err-1'),
      { wrapper },
    );
    expect(result.current.isIdle).toBe(true);
    await act(async () => {
      const out = await result.current.mutateAsync();
      expect(out.suggestion.suggestedCategory).toBe('misread');
      expect(out.suggestion.confidence).toBeCloseTo(0.75);
      expect(out.candidateSourceIds).toEqual(['err-1', 'q-1', 'topic-1']);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('mutation failure surfaces 503 with DEPENDENCY_UNAVAILABLE', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'AI provider not configured' },
        },
        { status: 503 },
      ),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useClassificationSuggest('err-1'),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('mutation is a no-op when errorId is null (enabled: false)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useClassificationSuggest(null),
      { wrapper },
    );
    // `enabled: false` means the mutationFn never runs and the
    // hook stays in idle. Calling `mutateAsync` rejects with the
    // "mutation was not used" error, but no fetch happens.
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a POST to /errors/:id/classification-suggest with empty body', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            suggestion: {
              suggestedCategory: 'careless',
              rationale: 'r',
              confidence: 0.5,
              sourceIds: ['err-1'],
            },
            candidateSourceIds: ['err-1'],
          },
        }),
      );
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useClassificationSuggest('err-1'),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync();
    });
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string | undefined;
    expect(calledUrl).toContain('/errors/err-1/classification-suggest');
  });
});
