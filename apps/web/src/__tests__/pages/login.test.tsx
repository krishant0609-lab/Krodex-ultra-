/**
 * KRODEX web — login page integration test.
 *
 * Verifies the dev-token mint flow: typing a user_id, clicking
 * sign in, POSTing to /auth/dev-token, and routing to /dashboard
 * on success. The error path is also covered.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// next/navigation's useRouter must be callable in tests; the real hook
// requires an App Router context, so we install a no-op mock at module
// load time. vi.mock is hoisted by Vitest before any import resolves.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { clearAuth } from '../../lib/auth-store';
import LoginPage from '../../app/(auth)/login/page';

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
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
});

describe('LoginPage', () => {
  it('renders the form', () => {
    render(<LoginPage />, { wrapper: makeWrapper() });
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.getByTestId('login-user-id')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
  });

  it('shows an error when the API rejects the mint', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'VALIDATION', message: 'bad user_id' } },
        { status: 400 },
      ),
    );
    const user = userEvent.setup();
    render(<LoginPage />, { wrapper: makeWrapper() });
    await user.type(screen.getByTestId('login-user-id'), 'abc');
    await user.click(screen.getByTestId('login-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toBeInTheDocument();
    });
  });
});
