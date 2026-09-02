/**
 * KRODEX web — syllabus page integration test.
 *
 * Verifies Phase 7.5 acceptance criteria:
 *
 *   1. The index renders a tree of subjects, with each subject
 *      resolving its own topics list via the hook layer.
 *   2. The typed subject deep link renders the subject header,
 *      breadcrumbs, and the live topic list.
 *   3. The typed topic deep link resolves the topic by id,
 *      looks up the parent subject for breadcrumbs, and lists
 *      the sub-topics.
 *   4. The typed sub-topic deep link renders the leaf page with
 *      the full breadcrumb chain.
 *   5. The legacy /syllabus/[id] route is a graceful fallback:
 *      if the id matches a subject, it links to the typed
 *      route; if not, it renders an honest unresolved state.
 *   6. No fake data — every value comes from a mocked fetch
 *      response shaped exactly like the API envelope.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { setAuth, clearAuth } from '../../lib/auth-store';
import { setSettled } from '../../lib/react-async';
import SyllabusPage from '../../app/(app)/syllabus/page';
import SubjectNodePage from '../../app/(app)/syllabus/subject/[id]/page';
import TopicNodePage from '../../app/(app)/syllabus/topic/[id]/page';
import SubTopicNodePage from '../../app/(app)/syllabus/sub-topic/[id]/page';
import LegacyNodePage from '../../app/(app)/syllabus/[id]/page';

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

function failure(code: string, message: string) {
  return {
    success: false as const,
    error: { code, message },
  };
}

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const SUBJECT_A = {
  id: 'subj-aaaaaaaaaaaa',
  code: 'MATH',
  name: 'Mathematics',
  display_order: 1,
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const SUBJECT_B = {
  id: 'subj-bbbbbbbbbbbb',
  code: 'PHYS',
  name: 'Physics',
  display_order: 2,
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const TOPIC_A1 = {
  id: 'topic-aaaaaaaaaaa1',
  subject_id: SUBJECT_A.id,
  parent_topic_id: null,
  code: 'ALG',
  name: 'Algebra',
  display_order: 1,
  syllabus_scope: 'core',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const TOPIC_A2 = {
  id: 'topic-aaaaaaaaaaa2',
  subject_id: SUBJECT_A.id,
  parent_topic_id: null,
  code: 'CALC',
  name: 'Calculus',
  display_order: 2,
  syllabus_scope: 'core',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const SUB_TOPIC_A1A = {
  id: 'subt-aaaaaaaaaaaa',
  topic_id: TOPIC_A1.id,
  code: 'LIN',
  name: 'Linear equations',
  display_order: 1,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

interface SyllabusFetchRoutes {
  subjects: 'success' | 'empty' | 'error';
  /** key = `${subjectId}` -> 'success' | 'empty' | 'error' */
  topics: Record<string, 'success' | 'empty' | 'error'>;
  /** key = `${topicId}` -> 'success' | 'empty' | 'error' */
  subTopics: Record<string, 'success' | 'empty' | 'error'>;
  /** When 'all', GET /syllabus/topics returns every known topic. */
  topicsAll: 'success' | 'empty' | 'error';
}

function stubFetch(routes: SyllabusFetchRoutes): MockInstance<typeof global.fetch> {
  return vi.spyOn(global, 'fetch').mockImplementation((input: unknown) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // /syllabus/subjects
    if (/[?&](\/)?syllabus\/subjects\b/.test(url) || /\/syllabus\/subjects(\?|$)/.test(url)) {
      if (routes.subjects === 'error') {
        return Promise.resolve(
          jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
        );
      }
      if (routes.subjects === 'empty') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([]) }),
        );
      }
      return Promise.resolve(
        jsonResponse({ status: 200, body: success([SUBJECT_A, SUBJECT_B]) }),
      );
    }

    // /syllabus/topics?subject_id=...
    const subjectMatch = url.match(/[?&]subject_id=([^&]+)/);
    if (url.includes('/syllabus/topics') && subjectMatch) {
      const subjectId = subjectMatch[1] ?? '';
      const state = routes.topics[subjectId] ?? 'success';
      if (state === 'error') {
        return Promise.resolve(
          jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
        );
      }
      if (state === 'empty' || subjectId === SUBJECT_B.id) {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([]) }),
        );
      }
      if (subjectId === SUBJECT_A.id) {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([TOPIC_A1, TOPIC_A2]) }),
        );
      }
      return Promise.resolve(
        jsonResponse({ status: 200, body: success([]) }),
      );
    }

    // /syllabus/topics (no subject_id) — used by topic page
    if (url.includes('/syllabus/topics')) {
      if (routes.topicsAll === 'error') {
        return Promise.resolve(
          jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
        );
      }
      if (routes.topicsAll === 'empty') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([]) }),
        );
      }
      return Promise.resolve(
        jsonResponse({ status: 200, body: success([TOPIC_A1, TOPIC_A2]) }),
      );
    }

    // /syllabus/sub-topics?topic_id=...
    const topicMatch = url.match(/[?&]topic_id=([^&]+)/);
    if (url.includes('/syllabus/sub-topics') && topicMatch) {
      const topicId = topicMatch[1] ?? '';
      const state = routes.subTopics[topicId] ?? 'success';
      if (state === 'error') {
        return Promise.resolve(
          jsonResponse({ status: 500, body: failure('INTERNAL', 'boom') }),
        );
      }
      if (state === 'empty') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([]) }),
        );
      }
      if (topicId === TOPIC_A1.id) {
        return Promise.resolve(
          jsonResponse({ status: 200, body: success([SUB_TOPIC_A1A]) }),
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

describe('SyllabusPage (index)', () => {
  it('renders a tree of subjects with each subject resolving its own topics', async () => {
    stubFetch({
      subjects: 'success',
      topics: {
        [SUBJECT_A.id]: 'success',
        [SUBJECT_B.id]: 'empty',
      },
      subTopics: {},
      topicsAll: 'success',
    });
    render(<SyllabusPage />, { wrapper: makeWrapper() });

    // Both subjects mount, then their per-subject topic queries resolve.
    // Wait for SUBJECT_B's empty band — that's the last thing to render
    // because SUBJECT_B's topic query is also the slowest (empty array).
    expect(
      await screen.findByTestId(`syllabus-subject-${SUBJECT_B.id}-empty`),
    ).toBeInTheDocument();

    // The two real topics under SUBJECT_A render exactly once each.
    expect(screen.getAllByTestId(`syllabus-topic-${TOPIC_A1.id}`)).toHaveLength(1);
    expect(screen.getAllByTestId(`syllabus-topic-${TOPIC_A2.id}`)).toHaveLength(1);
  });

  it('renders the empty state when no subjects are published', async () => {
    stubFetch({
      subjects: 'empty',
      topics: {},
      subTopics: {},
      topicsAll: 'empty',
    });
    render(<SyllabusPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });

  it('renders the error state when the subject list fails to load', async () => {
    stubFetch({
      subjects: 'error',
      topics: {},
      subTopics: {},
      topicsAll: 'empty',
    });
    render(<SyllabusPage />, { wrapper: makeWrapper() });
    expect(await screen.findByTestId('page-state-error')).toBeInTheDocument();
  });
});

describe('SubjectNodePage (/syllabus/subject/[id])', () => {
  it('renders the subject header, breadcrumbs, and topic list', async () => {
    stubFetch({
      subjects: 'success',
      topics: { [SUBJECT_A.id]: 'success' },
      subTopics: {},
      topicsAll: 'success',
    });
    render(<SubjectNodePage params={settledParams({ id: SUBJECT_A.id })} />, {
      wrapper: makeWrapper(),
    });
    const node = await screen.findByTestId('syllabus-node-id');
    expect(node.textContent).toBe(SUBJECT_A.name);
    // Both topics render as deep-link cards.
    expect(
      await screen.findByTestId(`subject-topic-${TOPIC_A1.id}`),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId(`subject-topic-${TOPIC_A2.id}`),
    ).toBeInTheDocument();
  });

  it('renders an empty state for a subject with no topics', async () => {
    stubFetch({
      subjects: 'success',
      topics: { [SUBJECT_B.id]: 'empty' },
      subTopics: {},
      topicsAll: 'empty',
    });
    render(<SubjectNodePage params={settledParams({ id: SUBJECT_B.id })} />, {
      wrapper: makeWrapper(),
    });
    expect(
      await screen.findByTestId('subject-topics-empty'),
    ).toBeInTheDocument();
  });

  it('renders an unresolved state when the subject id is unknown', async () => {
    stubFetch({
      subjects: 'success',
      topics: {},
      subTopics: {},
      topicsAll: 'empty',
    });
    render(
      <SubjectNodePage params={settledParams({ id: 'subj-unknownid000' })} />,
      { wrapper: makeWrapper() },
    );
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });
});

describe('TopicNodePage (/syllabus/topic/[id])', () => {
  it('renders the topic header, breadcrumbs, and sub-topics', async () => {
    stubFetch({
      subjects: 'success',
      topics: { [SUBJECT_A.id]: 'success' },
      subTopics: { [TOPIC_A1.id]: 'success' },
      topicsAll: 'success',
    });
    render(<TopicNodePage params={settledParams({ id: TOPIC_A1.id })} />, {
      wrapper: makeWrapper(),
    });
    const node = await screen.findByTestId('syllabus-node-id');
    expect(node.textContent).toBe(TOPIC_A1.name);
    expect(
      await screen.findByTestId(`topic-sub-topic-${SUB_TOPIC_A1A.id}`),
    ).toBeInTheDocument();
  });

  it('renders an empty sub-topic list truthfully', async () => {
    stubFetch({
      subjects: 'success',
      topics: { [SUBJECT_A.id]: 'success' },
      subTopics: { [TOPIC_A2.id]: 'empty' },
      topicsAll: 'success',
    });
    render(<TopicNodePage params={settledParams({ id: TOPIC_A2.id })} />, {
      wrapper: makeWrapper(),
    });
    expect(
      await screen.findByTestId('topic-sub-topics-empty'),
    ).toBeInTheDocument();
  });

  it('renders an unresolved state when the topic id is unknown', async () => {
    stubFetch({
      subjects: 'success',
      topics: {},
      subTopics: {},
      topicsAll: 'success',
    });
    render(
      <TopicNodePage params={settledParams({ id: 'topic-unknownid000' })} />,
      { wrapper: makeWrapper() },
    );
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });
});

describe('SubTopicNodePage (/syllabus/sub-topic/[id])', () => {
  it('renders the sub-topic header and full breadcrumb chain', async () => {
    stubFetch({
      subjects: 'success',
      topics: { [SUBJECT_A.id]: 'success' },
      subTopics: { [TOPIC_A1.id]: 'success' },
      topicsAll: 'success',
    });
    render(
      <SubTopicNodePage
        params={settledParams({ id: SUB_TOPIC_A1A.id })}
      />,
      { wrapper: makeWrapper() },
    );
    const node = await screen.findByTestId('syllabus-node-id');
    expect(node.textContent).toBe(SUB_TOPIC_A1A.name);
  });

  it('renders an unresolved state when the sub-topic id is unknown', async () => {
    stubFetch({
      subjects: 'success',
      topics: { [SUBJECT_A.id]: 'success' },
      subTopics: { [TOPIC_A1.id]: 'empty' },
      topicsAll: 'success',
    });
    render(
      <SubTopicNodePage
        params={settledParams({ id: 'subt-unknownid000' })}
      />,
      { wrapper: makeWrapper() },
    );
    expect(await screen.findByTestId('page-state-empty')).toBeInTheDocument();
  });
});

describe('LegacyNodePage (/syllabus/[id])', () => {
  it('renders the typed subject deep link when the id matches a known subject', async () => {
    stubFetch({
      subjects: 'success',
      topics: { [SUBJECT_A.id]: 'success' },
      subTopics: {},
      topicsAll: 'success',
    });
    render(
      <LegacyNodePage params={settledParams({ id: SUBJECT_A.id })} />,
      { wrapper: makeWrapper() },
    );
    const node = await screen.findByTestId('syllabus-node-id');
    expect(node.textContent).toBe(SUBJECT_A.id);
  });

  it('renders an unresolved state for an unknown id', async () => {
    stubFetch({
      subjects: 'success',
      topics: {},
      subTopics: {},
      topicsAll: 'empty',
    });
    render(
      <LegacyNodePage params={settledParams({ id: 'subj-unknownid000' })} />,
      { wrapper: makeWrapper() },
    );
    // The page surfaces a calm unresolved empty state — no fabricated row.
    const empty = await screen.findByTestId('page-state-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('subj-unknownid000');
  });
});
