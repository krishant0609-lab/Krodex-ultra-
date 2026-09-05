/**
 * KRODEX web — LifecycleHistory component tests (Phase 9).
 *
 * The component is a thin wrapper around the lifecycle query:
 *
 *   - loading state
 *   - error state
 *   - empty placeholder (the entry has no transitions yet)
 *   - populated list — each event shows the trigger label,
 *     the from→to transition, the timestamp, and the reason
 *     when present
 *
 * No interactions: the list is read-only by contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MockInstance } from 'vitest';
import type { ErrorLifecycleEventRow } from '@krodex/shared';

import { LifecycleHistory } from '../app/(app)/errors/[id]/components/lifecycle-history';

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

function makeEvent(
  overrides: Partial<ErrorLifecycleEventRow> = {},
): ErrorLifecycleEventRow {
  return {
    id: 'le-1',
    error_entry_id: ERROR_ID,
    from_status: 'active',
    to_status: 'in_review',
    trigger: 'student_review',
    reason: null,
    review_id: null,
    created_at: '2026-09-03T10:00:00.000Z',
    ...overrides,
  };
}

type ListResult = 'empty' | 'populated' | 'error';

function stubFetch(result: ListResult): MockInstance<typeof global.fetch> {
  return vi
    .spyOn(global, 'fetch')
    .mockImplementation((input: unknown, _init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.endsWith(`/errors/${ERROR_ID}/lifecycle`)) {
        if (result === 'error') {
          return Promise.resolve(
            jsonResponse(500, failure('INTERNAL', 'lifecycle failed')),
          );
        }
        if (result === 'empty') {
          return Promise.resolve(jsonResponse(200, success([])));
        }
        return Promise.resolve(
          jsonResponse(
            200,
            success([
              makeEvent({
                id: 'le-1',
                to_status: 'in_review',
                trigger: 'student_review',
                reason: 'Started review session',
                created_at: '2026-09-03T11:00:00.000Z',
              }),
              makeEvent({
                id: 'le-2',
                from_status: 'in_review',
                to_status: 'resolved',
                trigger: 'student_review',
                reason: null,
                created_at: '2026-09-03T12:00:00.000Z',
              }),
              makeEvent({
                id: 'le-3',
                from_status: null,
                to_status: 'active',
                trigger: 'system',
                reason: 'Entry created',
                created_at: '2026-09-03T10:00:00.000Z',
              }),
            ]),
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
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
  vi.restoreAllMocks();
});

describe('LifecycleHistory', () => {
  it('renders the empty placeholder when no events exist', async () => {
    stubFetch('empty');
    render(<LifecycleHistory errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId('lifecycle-empty'),
    ).toBeInTheDocument();
  });

  it('renders an error message when the lifecycle query fails', async () => {
    stubFetch('error');
    render(<LifecycleHistory errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId('lifecycle-error'),
    ).toBeInTheDocument();
  });

  it('renders one node per event and shows the reason when present', async () => {
    stubFetch('populated');
    render(<LifecycleHistory errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    const events = await screen.findAllByTestId('lifecycle-event');
    expect(events).toHaveLength(3);
    // Only the first event has a non-null reason.
    const reasons = screen.queryAllByTestId('lifecycle-event-reason');
    expect(reasons).toHaveLength(2);
  });

  it('handles a transition with no from_status (creation)', async () => {
    stubFetch('populated');
    render(<LifecycleHistory errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    await screen.findAllByTestId('lifecycle-event');
    // The third event has from_status=null; its transition label
    // is the "→ active" form rather than "x → active".
    expect(screen.getByText('→ active')).toBeInTheDocument();
    expect(screen.getByText('in review → resolved')).toBeInTheDocument();
  });
});
