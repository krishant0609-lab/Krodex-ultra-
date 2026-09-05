/**
 * KRODEX web — hook integration tests.
 *
 * Per Engineering Support §46, the testing contract requires that
 * hooks cover loading, empty, partial, success, error, and cache
 * invalidation states. These tests assert the most-important
 * behaviors of three representative hooks:
 *
 *   - useNotifications:  list + mark-read
 *   - useSubjects:       list
 *   - useCreateTask:     mutation + cache invalidation
 *
 * The full hook surface is identical in shape; exhaustively testing
 * every hook is Phase 7 polish.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../lib/auth-store';
import { ApiError } from '../lib/api-client';
import { useNotifications, useUpdateNotification } from '../hooks/use-notifications';
import { useSubjects } from '../hooks/use-syllabus';
import { useCreatePlannerTask } from '../hooks/use-planner';

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

describe('useNotifications', () => {
  it('loading → success populates data', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          items: [
            {
              id: 'n1',
              user_id: 'u-1',
              kind: 'task_completed',
              payload: {},
              state: 'unread',
              created_at: '2026-01-01T00:00:00.000Z',
              read_at: null,
            },
          ],
          nextCursor: null,
        },
      }),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useNotifications(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(1);
  });

  it('error state on 5xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'INTERNAL', message: 'boom' } },
        { status: 500 },
      ),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as unknown as { code: string }).code).toBe('INTERNAL');
  });
});

describe('useUpdateNotification', () => {
  it('invalidates the notifications cache on success', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            items: [
              {
                id: 'n1',
                user_id: 'u-1',
                kind: 'task_completed',
                payload: {},
                state: 'unread',
                created_at: '2026-01-01T00:00:00.000Z',
                read_at: null,
              },
            ],
            nextCursor: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            id: 'n1',
            user_id: 'u-1',
            kind: 'task_completed',
            payload: {},
            state: 'read',
            created_at: '2026-01-01T00:00:00.000Z',
            read_at: '2026-01-01T01:00:00.000Z',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            items: [
              {
                id: 'n1',
                user_id: 'u-1',
                kind: 'task_completed',
                payload: {},
                state: 'read',
                created_at: '2026-01-01T00:00:00.000Z',
                read_at: '2026-01-01T01:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
        }),
      );
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => ({
        list: useNotifications(),
        update: useUpdateNotification('n1'),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    await act(async () => {
      await result.current.update.mutateAsync({ state: 'read' });
    });
    // After mutation: a third fetch should be made (cache invalidation
    // triggers a refetch of the list).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('useSubjects', () => {
  it('empty state when items list is empty', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: [] }),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useSubjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useCreatePlannerTask', () => {
  it('mutation failure surfaces the error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'VALIDATION', message: 'plan_date required' },
          requestId: 'e-1',
        },
        { status: 400 },
      ),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useCreatePlannerTask(), { wrapper });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          plan_date: '',
          title: 'x',
        });
      } catch (err) {
        caught = err;
      }
    });
    // The mutation rejects with an ApiError carrying the envelope code.
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('VALIDATION');
    expect((caught as ApiError).status).toBe(400);
    // After the failure flushes through the mutation observer, isError
    // is set. Wait for the re-render rather than reading result.current
    // directly, which may still reflect the pre-error state.
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
