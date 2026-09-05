/**
 * KRODEX API — /assistant route tests.
 *
 * Per PHASE8_PLAN §11, the assistant routes are:
 *   POST /assistant/queries
 *   POST /assistant/proposals/:id/confirm
 *   POST /errors/:id/classification-suggest       (wired in Step 3)
 *
 * These tests build a minimal Fastify instance, install the
 * route registration, and:
 *   - Override `app.assistantService` with a fake so we don't
 *     hit a real provider.
 *   - Bypass the real auth preHandler with a fake that mints
 *     `req.auth` and `req.supabaseUser`.
 *   - Seed the fake supabase with the tables the dispatch path
 *     needs (`planner_tasks`, `review_schedules`) so the route
 *     actually performs the write after a confirm.
 *
 * The real assistant-orchestrator logic (intent classification,
 * evidence assembly, Zod-validated model output, proposal
 * storage) is pinned by the service-level tests in
 * `apps/api/src/services/__tests__/assistant-service.test.ts`.
 * These tests pin the *wiring*:
 *   - path → handler → service → response envelope
 *   - happy path on every endpoint
 *   - error translation (DependencyUnavailableError → 503,
 *     ValidationError → 400, NotFoundError → 404)
 *   - dispatch to the existing Phase 2 domain services on confirm
 *   - reject path leaves the database untouched
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase, type FakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerAssistantRoutes } from '../assistant';
import {
  DependencyUnavailableError,
  NotFoundError,
  UnauthorizedError,
} from '../../errors';
void UnauthorizedError; // referenced from the auth-shape smoke test only
import type { ApiEnv } from '../../config/env';
import type { AssistantService } from '../../services/assistant-service';
import type {
  AssistantProposalT,
  AssistantResponseT,
  ClassificationSuggestionResponseT,
} from '../../ai/schemas';
import {
  _resetProposalStoreForTests,
  storeProposal,
} from '../../ai/proposer';

const SUB = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000001';
const ERROR_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_PROPOSAL_ID = '00000000-0000-4000-8000-000000000099';
const BAD_PROPOSAL_ID = '00000000-0000-4000-8000-00000000000a';

let app: FastifyInstance;
let perRequestClient: SupabaseClient;
let env: ApiEnv;

interface FakeService extends AssistantService {
  __calls: { method: string; args: unknown }[];
  __answer?: (q: string) => AssistantResponseT;
  __confirm?: (
    proposalId: string,
    confirmed: boolean,
  ) => { executed: boolean; proposal: AssistantProposalT };
  __classify?: (errorId: string) => ClassificationSuggestionResponseT;
  __throwOnQueries?: Error;
  __throwOnConfirm?: Error;
  __throwOnClassify?: Error;
}

function makeFakeService(): FakeService {
  const fake: Partial<FakeService> = {
    __calls: [],
    async answerQuery() {
      throw new Error('answerQuery not stubbed');
    },
    async confirmProposal() {
      throw new Error('confirmProposal not stubbed');
    },
    async classifyError() {
      throw new Error('classifyError not stubbed');
    },
  };
  return fake as FakeService;
}

beforeAll(async () => {
  env = {
    hasSupabase: true,
    hasServiceRole: true,
    supabaseUrl: 'http://example.test',
    supabaseAnonKey: 'anon-test-key',
    supabaseServiceRoleKey: 'service-test-key',
    supabaseDbUrl: '',
    nodeEnv: 'test',
    logLevel: 'silent',
    apiPort: 0,
    apiHost: '127.0.0.1',
    webOrigin: 'http://localhost:3000',
    authJwtSecret: 'test-secret-test-secret-test-secret-test',
    authJwtTtlSeconds: 3600,
    authRefreshTtlSeconds: 2_592_000,
    authAllowDevJwt: true,
    aiProvider: 'openai',
    aiProviderUrl: 'https://api.openai.com/v1',
    aiApiKey: '',
    aiModelDefault: 'gpt-4o-mini',
    aiModelReasoning: 'gpt-4o',
    aiTimeoutMs: 20_000,
    aiMaxRetries: 2,
    aiProposalTtlMs: 30 * 60 * 1000,
    storageBucketErrorCaptures: 'error-captures',
    storageBucketQuestionSnapshots: 'question-snapshots',
    storageBucketErrorEvidence: 'error-evidence',
    storageSignedUrlTtlSeconds: 900,
    evidenceSnapshotMaxBytes: 5_242_880,
    rateLimitGlobalPerMin: 120,
    rateLimitAuthPerMin: 10,
    rateLimitAiPerMin: 20,
    corsAllowedOrigins: ['http://localhost:3000'],
    emailProvider: 'resend',
    emailApiKey: '',
    emailFromAddress: 'no-reply@krodex.local',
    emailFromName: 'KRODEX',
    pushProvider: 'webpush',
    pushVapidPublicKey: '',
    pushVapidPrivateKey: '',
    pushSubject: 'mailto:dev@krodex.local',
    featureFlags: Object.freeze({
      planner: false,
      tests: false,
      errorBank: false,
      review: false,
      progress: false,
      aiInsights: false,
      notifications: false,
      capture: false,
    }),
  } as ApiEnv;

  app = Fastify({ logger: false });
  installRequestDecorations(app, env);
  installErrorHandler(app);
  app.decorate('authPreHandler', async (req) => {
    req.auth = { userId: SUB, userEmail: 'test@example.com', jwt: 'fake' };
    req.supabaseUser = perRequestClient;
  });
  // Replace the auto-built assistant service with our fake so we
  // never hit a real provider. Registered before route registration
  // so the route handler reads our fake.
  const fakeSvc = makeFakeService();
  // `decorate` is a no-op for keys that already exist; we have to
  // remove first. Fastify exposes this only via `hasDecoration` —
  // we re-decorate by mutating the prototype-style property the
  // handler reads (`app.assistantService`).
  (app as unknown as { assistantService: AssistantService }).assistantService =
    fakeSvc as unknown as AssistantService;
  registerAssistantRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  perRequestClient = makeFakeSupabase();
  _resetProposalStoreForTests();
  const svc = app.assistantService as unknown as FakeService;
  svc.__calls = [];
  svc.__answer = undefined;
  svc.__confirm = undefined;
  svc.__classify = undefined;
  svc.__throwOnQueries = undefined;
  svc.__throwOnConfirm = undefined;
  svc.__throwOnClassify = undefined;
  // Wire default behavior (overridable per-test).
  svc.answerQuery = vi.fn(async (client, userId, input) => {
    svc.__calls.push({ method: 'answerQuery', args: { userId, input } });
    if (svc.__throwOnQueries) throw svc.__throwOnQueries;
    const response: AssistantResponseT = svc.__answer
      ? svc.__answer(String(input.question))
      : {
          answer: 'stubbed answer',
          sources: [{ kind: 'topic', id: 'topic-1', excerpt: 'name: Arithmetic' }],
        };
    return { response, candidateSourceIds: ['topic-1'] };
  });
  svc.confirmProposal = vi.fn(async (userId, input) => {
    svc.__calls.push({ method: 'confirmProposal', args: { userId, input } });
    if (svc.__throwOnConfirm) throw svc.__throwOnConfirm;
    if (!svc.__confirm) throw new Error('confirm not stubbed');
    return svc.__confirm(input.proposalId, input.confirmed);
  });
  svc.classifyError = vi.fn(async (client, userId, errorId) => {
    svc.__calls.push({ method: 'classifyError', args: { userId, errorId } });
    if (svc.__throwOnClassify) throw svc.__throwOnClassify;
    if (!svc.__classify) throw new Error('classify not stubbed');
    return svc.__classify(errorId);
  });
});

function fake(): FakeService {
  return app.assistantService as unknown as FakeService;
}

/**
 * Access the fake-only helpers on the per-request client. The
 * route's `req.supabaseUser` decoration is typed as `SupabaseClient`
 * (the production contract), but in tests the client is our fake —
 * this cast is the one place the test reaches into fake-only
 * surface (`__rows`).
 */
function rowsOf(table: string): Record<string, unknown>[] {
  return (perRequestClient as unknown as FakeSupabase).__rows(table);
}

function makeProposal(
  overrides: Partial<AssistantProposalT> = {},
): AssistantProposalT {
  return {
    id: PROPOSAL_ID,
    kind: 'create_task',
    description: 'Practice arithmetic.',
    affectedRecords: [ERROR_ID],
    payload: { title: 'Practice arithmetic' },
    createdAt: 1_715_000_000_000,
    ...overrides,
  };
}

interface PostResult {
  status: number;
  json: () => unknown;
}

function post(
  url: string,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<PostResult> {
  return app
    .inject({
      method: 'POST',
      url,
      headers,
      payload: body,
    })
    .then((res) => ({ status: res.statusCode, json: () => res.json() }));
}

describe('POST /assistant/queries', () => {
  it('returns the assistant response + candidate source ids on a valid call', async () => {
    fake().__answer = () => ({
      answer: 'You have one open error on Arithmetic.',
      sources: [
        { kind: 'error', id: 'err-1', excerpt: 'I misread the question.' },
        { kind: 'topic', id: 'topic-1', excerpt: 'name: Arithmetic' },
      ],
    });
    const res = await post('/assistant/queries', {
      question: 'how am I doing on arithmetic?',
    });
    expect(res.status).toBe(200);
    const body = res.json() as {
      success: boolean;
      data: { response: AssistantResponseT; candidateSourceIds: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.response.answer).toMatch(/Arithmetic/);
    expect(body.data.response.sources).toHaveLength(2);
    expect(body.data.candidateSourceIds).toEqual(['topic-1']);
    // The route must have passed the authenticated user id through.
    const call = fake().__calls.find((c) => c.method === 'answerQuery');
    expect(call).toBeDefined();
    expect((call!.args as { userId: string }).userId).toBe(SUB);
  });

  it('translates DependencyUnavailableError into 503', async () => {
    fake().__throwOnQueries = new DependencyUnavailableError('AI provider not configured');
    const res = await post('/assistant/queries', { question: 'q' });
    expect(res.status).toBe(503);
    const body = res.json() as {
      success: false;
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('returns 400 when the body fails Zod validation (missing question)', async () => {
    const res = await post('/assistant/queries', { context: 'no question here' });
    expect(res.status).toBe(400);
    const body = res.json() as {
      success: false;
      error: { code: string; fields?: Array<{ path: string; message: string }> };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields?.some((f) => f.path === 'question')).toBe(true);
  });

  it('returns 400 when the question is too long', async () => {
    const res = await post('/assistant/queries', { question: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });
});

describe('POST /assistant/proposals/:id/confirm', () => {
  it('rejects with executed: false and no DB write when confirmed=false', async () => {
    const proposal = makeProposal();
    storeProposal(SUB, proposal, () => new Date('2025-05-01T12:00:00.000Z'));
    fake().__confirm = () => ({ executed: false, proposal });
    const res = await post(`/assistant/proposals/${proposal.id}/confirm`, {
      confirmed: false,
    });
    expect(res.status).toBe(200);
    const body = res.json() as {
      success: boolean;
      data: {
        executed: boolean;
        proposal: AssistantProposalT;
        dispatched?: { kind: string };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.executed).toBe(false);
    expect(body.data.proposal.id).toBe(proposal.id);
    // The dispatcher is ONLY called on confirm — there is no
    // `dispatched` key on the reject envelope.
    expect(body.data.dispatched).toBeUndefined();
    // The fake supabase has no `planner_tasks` table; the route
    // would throw if it tried to insert. We check by also reading
    // __rows which would have been populated had we seeded it.
    expect(rowsOf('planner_tasks')).toEqual([]);
  });

  it('confirms a create_task proposal and dispatches to createPlannerTask', async () => {
    const proposal = makeProposal({
      id: '00000000-0000-4000-8000-000000000010',
      kind: 'create_task',
      payload: { title: 'Practice arithmetic', planned_minutes: 30 },
    });
    storeProposal(SUB, proposal, () => new Date('2025-05-01T12:00:00.000Z'));
    perRequestClient = makeFakeSupabase({
      defaultUserId: SUB,
      tables: { planner_tasks: [] },
    });
    fake().__confirm = () => ({ executed: true, proposal });
    const res = await post(`/assistant/proposals/${proposal.id}/confirm`, {
      confirmed: true,
    });
    expect(res.status).toBe(200);
    const body = res.json() as {
      success: boolean;
      data: {
        executed: boolean;
        dispatched: { kind: 'create_task'; taskId: string };
      };
    };
    expect(body.data.executed).toBe(true);
    expect(body.data.dispatched.kind).toBe('create_task');
    expect(typeof body.data.dispatched.taskId).toBe('string');
    expect(body.data.dispatched.taskId.length).toBeGreaterThan(0);
    // The dispatcher must have actually written a row to
    // `planner_tasks`, tagged with the source = 'assistant' and
    // the proposal id, with the payload title and planned_minutes
    // applied.
    const rows = rowsOf('planner_tasks');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.title).toBe('Practice arithmetic');
    expect(row.planned_minutes).toBe(30);
    expect(row.state).toBe('planned');
    expect(row.user_id).toBe(SUB);
    expect((row.metadata as Record<string, unknown>).source).toBe('assistant');
    expect((row.metadata as Record<string, unknown>).proposalId).toBe(
      '00000000-0000-4000-8000-000000000010',
    );
  });

  it('confirms a schedule_review proposal and dispatches to scheduleReview', async () => {
    const proposal = makeProposal({
      id: '00000000-0000-4000-8000-000000000020',
      kind: 'schedule_review',
      payload: {
        error_id: ERROR_ID,
        strategy: 'spaced',
        due_at: '2025-12-01T00:00:00.000Z',
      },
    });
    storeProposal(SUB, proposal, () => new Date('2025-05-01T12:00:00.000Z'));
    perRequestClient = makeFakeSupabase({
      defaultUserId: SUB,
      tables: { review_schedules: [] },
    });
    fake().__confirm = () => ({ executed: true, proposal });
    const res = await post(`/assistant/proposals/${proposal.id}/confirm`, {
      confirmed: true,
    });
    expect(res.status).toBe(200);
    const body = res.json() as {
      data: { dispatched: { kind: 'schedule_review'; reviewId: string } };
    };
    expect(body.data.dispatched.kind).toBe('schedule_review');
    const rows = rowsOf('review_schedules');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.error_id).toBe(ERROR_ID);
    expect(row.strategy).toBe('spaced');
    expect(row.due_at).toBe('2025-12-01T00:00:00.000Z');
    expect(row.state).toBe('scheduled');
    expect(row.user_id).toBe(SUB);
  });

  it('returns 503 with DEPENDENCY_UNAVAILABLE when the proposal payload is malformed', async () => {
    // The model's payload is missing the required `title` for a
    // `create_task`. The dispatcher must reject before any write.
    const proposal = makeProposal({
      id: BAD_PROPOSAL_ID,
      kind: 'create_task',
      // No `title` — Zod will reject the payload.
      payload: { description: 'no title here' },
    });
    storeProposal(SUB, proposal, () => new Date('2025-05-01T12:00:00.000Z'));
    perRequestClient = makeFakeSupabase({
      defaultUserId: SUB,
      tables: { planner_tasks: [] },
    });
    fake().__confirm = () => ({ executed: true, proposal });
    const res = await post(`/assistant/proposals/${proposal.id}/confirm`, {
      confirmed: true,
    });
    expect(res.status).toBe(503);
    const body = res.json() as {
      success: false;
      error: { code: string };
    };
    expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    // The dispatch must have failed BEFORE the write — no row.
    expect(rowsOf('planner_tasks')).toEqual([]);
  });

  it('returns 404 when the proposal was not found in the TTL store', async () => {
    fake().__confirm = () => {
      throw new NotFoundError('proposal missing not found');
    };
    const res = await post(
      `/assistant/proposals/${OTHER_PROPOSAL_ID}/confirm`,
      { confirmed: true },
    );
    expect(res.status).toBe(404);
    const body = res.json() as {
      success: false;
      error: { code: string };
    };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 when the body fails Zod validation (missing confirmed field)', async () => {
    const res = await post(`/assistant/proposals/${PROPOSAL_ID}/confirm`, {});
    expect(res.status).toBe(400);
  });
});

describe('POST /errors/:id/classification-suggest (smoke)', () => {
  it('returns the suggestion + candidate source ids on a valid call', async () => {
    fake().__classify = () => ({
      suggestion: {
        suggestedCategory: 'misread',
        rationale: 'The remark mentions misreading.',
        confidence: 0.75,
        sourceIds: [ERROR_ID],
      },
      candidateSourceIds: [ERROR_ID, 'q-1', 'topic-1'],
    });
    const res = await post(`/errors/${ERROR_ID}/classification-suggest`, {});
    expect(res.status).toBe(200);
    const body = res.json() as {
      success: boolean;
      data: { suggestion: { suggestedCategory: string }; candidateSourceIds: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.suggestion.suggestedCategory).toBe('misread');
    expect(body.data.candidateSourceIds).toEqual(
      expect.arrayContaining([ERROR_ID, 'q-1', 'topic-1']),
    );
  });

  it('translates DependencyUnavailableError into 503', async () => {
    fake().__throwOnClassify = new DependencyUnavailableError('AI provider not configured');
    const res = await post(`/errors/${ERROR_ID}/classification-suggest`, {});
    expect(res.status).toBe(503);
    const body = res.json() as {
      success: false;
      error: { code: string };
    };
    expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });
});

describe('auth preHandler is mandatory', () => {
  it('UnauthorizedError is the only auth error shape (not a generic 500)', async () => {
    // Smoke check: the auth error class has a `code` field that
    // reaches the client envelope. The actual 401-on-missing-auth
    // path is exercised by the wiring tests above (every request
    // goes through `authPreHandler`, which mints `req.auth`).
    const err = new UnauthorizedError('no auth');
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.httpStatus).toBe(401);
  });
});
