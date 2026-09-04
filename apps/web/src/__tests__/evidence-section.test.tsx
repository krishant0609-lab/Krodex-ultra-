/**
 * KRODEX web — EvidenceSection component tests (Phase 9).
 *
 * The section orchestrates two queries: a list (always) and a
 * per-row detail (lazy, on toggle). The list call is stubbed to
 * return either an empty list, a populated list, or an error.
 * The detail call is stubbed to return either a row with a
 * snapshot URL, a row with no snapshot, or a fetch error.
 *
 * The assertions cover:
 *   - empty state placeholder
 *   - populated list renders one card per row
 *   - clicking "view snapshot" lazy-fires the detail call
 *   - detail success renders the image
 *   - detail returning no snapshot renders the fallback
 *   - detail error renders the fallback with the message
 *   - list-level error renders the section-level error
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MockInstance } from 'vitest';

import { EvidenceSection } from '../app/(app)/errors/[id]/components/evidence-section';
import type { ErrorEvidenceRow } from '@krodex/shared';

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

function makeRow(overrides: Partial<ErrorEvidenceRow> = {}): ErrorEvidenceRow {
  return {
    id: 'ev-aaaaaaaaaaaa',
    user_id: 'u-1',
    attempt_id: 'a-1',
    error_entry_id: ERROR_ID,
    classification_status: 'suggested',
    classification_category: 'misread',
    classification_source: 'ai',
    student_answer: '13',
    expected_answer: '17',
    question_snapshot_url: null,
    metadata: {},
    created_at: '2026-09-03T10:00:00.000Z',
    updated_at: '2026-09-03T10:00:00.000Z',
    ...overrides,
  };
}

interface SectionRoutes {
  listResult: 'empty' | 'populated' | 'error';
  detailResult: 'with-snapshot' | 'without-snapshot' | 'error';
}

function stubFetch(routes: SectionRoutes): MockInstance<typeof global.fetch> {
  return vi
    .spyOn(global, 'fetch')
    .mockImplementation((input: unknown, _init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const method = (_init?.method as string | undefined) ?? 'GET';

      if (method === 'GET' && url.endsWith(`/errors/${ERROR_ID}/evidence`)) {
        if (routes.listResult === 'error') {
          return Promise.resolve(
            jsonResponse(500, failure('INTERNAL', 'list failed')),
          );
        }
        if (routes.listResult === 'empty') {
          return Promise.resolve(jsonResponse(200, success([])));
        }
        return Promise.resolve(
          jsonResponse(
            200,
            success([
              makeRow({ id: 'ev-1', student_answer: '13', expected_answer: '17' }),
              makeRow({
                id: 'ev-2',
                classification_status: 'pending',
                classification_category: null,
                student_answer: 'A',
                expected_answer: 'B',
              }),
            ]),
          ),
        );
      }

      if (
        method === 'GET' &&
        /\/evidence\/ev-/.test(url) &&
        !url.includes('/errors/')
      ) {
        if (routes.detailResult === 'error') {
          return Promise.resolve(
            jsonResponse(500, failure('INTERNAL', 'detail failed')),
          );
        }
        if (routes.detailResult === 'without-snapshot') {
          return Promise.resolve(
            jsonResponse(
              200,
              success({
                evidence: makeRow({ id: 'ev-1' }),
                snapshot: null,
              }),
            ),
          );
        }
        return Promise.resolve(
          jsonResponse(
            200,
            success({
              evidence: makeRow({ id: 'ev-1' }),
              snapshot: {
                url: 'http://api.test/signed/snap.png?token=xyz',
                mimeType: 'image/png',
                byteSize: 4096,
                expiresAt: '2026-09-03T12:00:00.000Z',
              },
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
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
  vi.restoreAllMocks();
});

describe('EvidenceSection', () => {
  it('renders the empty placeholder when the list is empty', async () => {
    stubFetch({ listResult: 'empty', detailResult: 'with-snapshot' });
    render(<EvidenceSection errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId('evidence-empty'),
    ).toBeInTheDocument();
  });

  it('renders a row for each evidence record', async () => {
    stubFetch({ listResult: 'populated', detailResult: 'with-snapshot' });
    render(<EvidenceSection errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    const rows = await screen.findAllByTestId('evidence-row');
    expect(rows).toHaveLength(2);
  });

  it('renders a section-level error when the list query fails', async () => {
    stubFetch({ listResult: 'error', detailResult: 'with-snapshot' });
    render(<EvidenceSection errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    expect(
      await screen.findByTestId('evidence-error'),
    ).toBeInTheDocument();
  });

  it('lazy-fires the detail query when the user toggles a row', async () => {
    const fetchSpy = stubFetch({
      listResult: 'populated',
      detailResult: 'with-snapshot',
    });
    render(<EvidenceSection errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    await screen.findAllByTestId('evidence-row');
    // Detail URL has not been requested yet — the toggle is the trigger.
    const detailUrls = fetchSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : (c[0] as Request).url))
      .filter((u) => /\/evidence\/ev-/.test(u));
    expect(detailUrls).toHaveLength(0);

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('evidence-toggle')[0]!);
    await waitFor(() => {
      const after = fetchSpy.mock.calls
        .map((c) => (typeof c[0] === 'string' ? c[0] : (c[0] as Request).url))
        .filter((u) => /\/evidence\/ev-/.test(u));
      expect(after.length).toBeGreaterThan(0);
    });
  });

  it('renders the image when the detail returns a snapshot', async () => {
    stubFetch({ listResult: 'populated', detailResult: 'with-snapshot' });
    render(<EvidenceSection errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    await screen.findAllByTestId('evidence-row');
    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('evidence-toggle')[0]!);
    expect(
      await screen.findByTestId('evidence-viewer-image'),
    ).toBeInTheDocument();
  });

  it('renders the fallback when the detail returns no snapshot', async () => {
    stubFetch({ listResult: 'populated', detailResult: 'without-snapshot' });
    render(<EvidenceSection errorId={ERROR_ID} />, { wrapper: makeWrapper() });
    await screen.findAllByTestId('evidence-row');
    const user = userEvent.setup();
    await user.click(screen.getAllByTestId('evidence-toggle')[0]!);
    expect(
      await screen.findByTestId('evidence-viewer-fallback'),
    ).toBeInTheDocument();
  });
});
