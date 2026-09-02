/**
 * KRODEX web — errors page integration test.
 *
 * Verifies the page renders the loading → populated and
 * loading → empty transitions per the Engineering Support §46
 * testing contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import ErrorsPage from '../../app/(app)/errors/page';

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
    defaultOptions: { queries: { retry: false } },
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

describe('ErrorsPage', () => {
  it('renders the empty state when the API returns no items', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        success: true,
        data: { items: [], nextCursor: null },
      }),
    );
    render(<ErrorsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('page-state-empty')).toBeInTheDocument();
    });
  });

  it('renders populated state with items', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          items: [
            {
              id: 'e-1',
              user_id: 'u-1',
              question_id: 'q-1',
              mistake_type: 'concept',
              remark: null,
              status: 'active',
              recurrence_count: 1,
              last_seen_at: '2026-01-01T00:00:00.000Z',
              source_attempt_id: null,
              metadata: {},
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }),
    );
    render(<ErrorsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('errors-item-e-1')).toBeInTheDocument();
    });
  });

  it('renders the error state when the API fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'INTERNAL', message: 'boom' } },
        { status: 500 },
      ),
    );
    render(<ErrorsPage />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('page-state-error')).toBeInTheDocument();
    });
  });
});
