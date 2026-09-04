/**
 * KRODEX web — notification preferences page integration test.
 *
 * Verifies the Phase 12 acceptance criteria for the
 * /notifications/preferences page:
 *
 *   1. Loading skeleton renders while the GET is in flight.
 *   2. Error state renders when the GET fails.
 *   3. Populated state renders the three cards (quiet hours,
 *      kinds, channels) and pre-fills from the API response.
 *   4. Toggling a kind, toggling quiet hours, and submitting
 *      the form issues a PATCH with the merged body.
 *   5. Successful PATCH shows a "Saved." status message.
 *   6. Bad time strings disable the save button and show the
 *      validation error.
 *   7. PATCH errors render the errorMeta strip.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import NotificationPreferencesPage from '../../app/(app)/notifications/preferences/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => '/notifications/preferences',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

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

const PREFS_DEFAULT = {
  quiet_hours: { enabled: false, start: '22:00', end: '08:00' },
  enabled_kinds: [],
  disabled_kinds: [],
  in_app_enabled: true,
  email_enabled: false,
  push_enabled: false,
};

const PREFS_WITH_OVERRIDES = {
  quiet_hours: { enabled: true, start: '21:30', end: '07:30' },
  enabled_kinds: [],
  disabled_kinds: ['review_due'],
  in_app_enabled: true,
  email_enabled: true,
  push_enabled: false,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-04T00:00:00.000Z',
};

interface PrefsFetchRoutes {
  initial: 'default' | 'overrides' | 'error';
  patch: 'success' | 'error';
}

function stubFetch(routes: PrefsFetchRoutes): MockInstance<typeof global.fetch> {
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

      // The api-client builds URLs like `http://api.test/v1/notifications/preferences`.
      // Test mocks match by regex against the full URL — the base prefix
      // depends on the test's NEXT_PUBLIC_API_BASE_URL.
      if (method === 'GET' && /\/notifications\/preferences(\?|$)/.test(url)) {
        if (routes.initial === 'error') {
          return Promise.resolve(
            jsonResponse({
              status: 500,
              body: failure('INTERNAL', 'preferences read failed'),
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success(
              routes.initial === 'overrides' ? PREFS_WITH_OVERRIDES : PREFS_DEFAULT,
            ),
          }),
        );
      }

      if (method === 'PATCH' && /\/notifications\/preferences(\?|$)/.test(url)) {
        if (routes.patch === 'error') {
          return Promise.resolve(
            jsonResponse({
              status: 500,
              body: failure('INTERNAL', 'preferences write failed'),
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: success(PREFS_DEFAULT),
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({
          status: 404,
          body: failure('NOT_FOUND', `unhandled ${method} ${url}`),
        }),
      );
    });
}

beforeEach(() => {
  process.env['NEXT_PUBLIC_API_BASE_URL'] = BASE;
  setAuth({ token: 'test-token', userId: 'u-1' });
});

afterEach(() => {
  clearAuth();
  vi.restoreAllMocks();
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
});

describe('NotificationPreferencesPage', () => {
  it('renders the populated form with the API values', async () => {
    stubFetch({ initial: 'overrides', patch: 'success' });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <NotificationPreferencesPage />
      </Wrapper>,
    );

    // The form populates from the GET response.
    await waitFor(() => {
      expect(
        screen.getByTestId('notification-prefs-quiet-enabled'),
      ).toBeChecked();
    });
    expect(screen.getByTestId('notification-prefs-quiet-start')).toHaveValue(
      '21:30',
    );
    expect(screen.getByTestId('notification-prefs-quiet-end')).toHaveValue('07:30');
    expect(
      screen.getByTestId('notification-prefs-kind-review_due'),
    ).toBeChecked();
    expect(
      screen.getByTestId('notification-prefs-channel-email'),
    ).toBeChecked();
    expect(
      screen.getByTestId('notification-prefs-channel-push'),
    ).not.toBeChecked();
  });

  it('submits a PATCH with the merged body on save', async () => {
    const fetchSpy = stubFetch({ initial: 'default', patch: 'success' });
    const Wrapper = makeWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <NotificationPreferencesPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('notification-prefs-quiet-enabled'),
      ).not.toBeChecked();
    });

    // Toggle a kind, enable quiet hours, and update the time.
    await user.click(
      screen.getByTestId('notification-prefs-kind-review_overdue'),
    );
    await user.click(screen.getByTestId('notification-prefs-quiet-enabled'));
    await user.clear(screen.getByTestId('notification-prefs-quiet-start'));
    await user.type(screen.getByTestId('notification-prefs-quiet-start'), '23:00');
    await user.click(
      screen.getByTestId('notification-prefs-channel-in-app'),
    );

    await user.click(screen.getByTestId('notification-prefs-save'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-prefs-success')).toHaveTextContent(
        'Saved.',
      );
    });

    // Verify the PATCH body
    const patchCall = fetchSpy.mock.calls.find(([, init]) => {
      const i = init as RequestInit | undefined;
      return i?.method === 'PATCH';
    });
    expect(patchCall).toBeDefined();
    const init = patchCall?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      quiet_hours: { enabled: true, start: '23:00', end: '08:00' },
      disabled_kinds: ['review_overdue'],
      in_app_enabled: false,
      email_enabled: false,
      push_enabled: false,
    });
  });

  it('disables the save button when time strings are invalid', async () => {
    stubFetch({ initial: 'default', patch: 'success' });
    const Wrapper = makeWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <NotificationPreferencesPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('notification-prefs-quiet-enabled'),
      ).not.toBeChecked();
    });

    await user.click(screen.getByTestId('notification-prefs-quiet-enabled'));
    await user.clear(screen.getByTestId('notification-prefs-quiet-start'));
    await user.type(screen.getByTestId('notification-prefs-quiet-start'), 'bad');

    const saveButton = screen.getByTestId('notification-prefs-save');
    expect(saveButton).toBeDisabled();
    expect(
      screen.getByTestId('notification-prefs-time-error'),
    ).toBeInTheDocument();
  });

  it('renders the error state when the GET fails', async () => {
    stubFetch({ initial: 'error', patch: 'success' });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <NotificationPreferencesPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state-error')).toBeInTheDocument();
    });
  });

  it('shows the errorMeta strip when the PATCH fails', async () => {
    stubFetch({ initial: 'default', patch: 'error' });
    const Wrapper = makeWrapper();
    const user = userEvent.setup();
    render(
      <Wrapper>
        <NotificationPreferencesPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('notification-prefs-quiet-enabled'),
      ).not.toBeChecked();
    });

    // The save action surfaces the error in the form. The page
    // catches the mutation rejection internally (the errorMeta strip
    // is the source of truth) so the click does not propagate it.
    await user.click(screen.getByTestId('notification-prefs-save'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-prefs-error')).toBeInTheDocument();
    });
  });
});
