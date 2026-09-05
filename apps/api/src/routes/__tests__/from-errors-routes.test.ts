/**
 * KRODEX API — POST /tests/from-errors route tests (Phase 10).
 *
 * Verifies the route handler for the ErrorPoolTestGenerator:
 *
 *   - happy path: returns testId + questionCount + isNew
 *   - second call with the same ids returns the same testId
 *     and isNew=false (no duplicate tests)
 *   - 400 when the body is malformed
 *   - 404 when no questions are available for the pool
 *
 * Service-level behaviour (deterministic composition, dedup,
 * fallback to error_question_links) is covered by the dedicated
 * service tests.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerTestRoutes } from '../tests';
import type { ApiEnv } from '../../config/env';

const SUB = '11111111-1111-4111-8111-111111111111';
const E1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const E2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const Q1 = 'q1111111-1111-4111-8111-111111111111';
const Q2 = 'q2222222-2222-4222-8222-222222222222';

let app: FastifyInstance;
let perRequestClient: SupabaseClient;
let env: ApiEnv;

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
  registerTestRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  perRequestClient = makeFakeSupabase();
});

function seedClient(tables: Record<string, Array<Record<string, unknown>>>) {
  perRequestClient = makeFakeSupabase({ tables, defaultUserId: SUB });
}

function baseTables() {
  return {
    test_definitions: [],
    test_questions: [],
    error_entries: [
      { id: E1, user_id: SUB, question_id: Q1, status: 'active' },
      { id: E2, user_id: SUB, question_id: Q2, status: 'active' },
    ],
    error_question_links: [],
  };
}

describe('POST /tests/from-errors', () => {
  it('creates a new test from a set of error ids', async () => {
    seedClient(baseTables());
    const res = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: [E1, E2] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.testId).toBe('string');
    expect(body.data.questionCount).toBe(2);
    expect(body.data.isNew).toBe(true);
  });

  it('returns isNew=false on a second call with the same ids', async () => {
    seedClient(baseTables());
    const first = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: [E1, E2] },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: [E1, E2] },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const a = first.json().data;
    const b = second.json().data;
    expect(a.testId).toBe(b.testId);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
  });

  it('honours a permuted input (signature is order-independent)', async () => {
    seedClient(baseTables());
    const a = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: [E1, E2] },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: [E2, E1] },
    });
    expect(a.json().data.testId).toBe(b.json().data.testId);
    expect(b.json().data.isNew).toBe(false);
  });

  it('returns 400 for an empty errorIds array', async () => {
    seedClient(baseTables());
    const res = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for non-uuid error ids', async () => {
    seedClient(baseTables());
    const res = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: ['not-a-uuid'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the error has no question and no link', async () => {
    seedClient({
      test_definitions: [],
      test_questions: [],
      error_entries: [
        { id: E1, user_id: SUB, question_id: null, status: 'active' },
      ],
      error_question_links: [],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/tests/from-errors',
      payload: { errorIds: [E1] },
    });
    expect(res.statusCode).toBe(404);
  });
});
