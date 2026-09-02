/**
 * KRODEX API — /analytics route tests.
 *
 * Per PHASE3_PLAN.md §7 + PHASE4_PLAN.md §12, the analytics
 * endpoints are:
 *   GET /analytics/dimensions
 *   GET /analytics/evidence
 *   GET /analytics/dashboards/overview
 *   GET /analytics/dashboards/dimension/:key
 *   GET /analytics/dashboards/dimension/:key/explain
 *   POST /analytics/admin/recompute
 *
 * These tests build a minimal Fastify instance, install the
 * route registration, and bypass the real auth preHandler by
 * installing a fake one that:
 *   1. Mints a fake `req.auth` with a known userId.
 *   2. Sets `req.supabaseUser` to a fake-supabase client seeded
 *      with the table contents the test cares about.
 *
 * This is a route-level test of the wiring (path → handler →
 * service → response envelope). The service-level tests
 * (analytics-dimensions/freshness/dashboards/dimension-dashboard
 * /dimension-explain/admin-recompute) cover the business logic
 * in isolation. Live-DB SQL queries are not exercised here —
 * the fake supabase stubs them.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerAnalyticsRoutes } from '../analytics';
import type { ApiEnv } from '../../config/env';

const SUB = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

let app: FastifyInstance;
let perRequestClient: SupabaseClient;
let env: ApiEnv;
let serviceClient: SupabaseClient;

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
    aiProvider: 'openai',
    aiApiKey: '',
    aiModelDefault: 'gpt-4o-mini',
    aiModelReasoning: 'gpt-4o',
    aiTimeoutMs: 20_000,
    aiMaxRetries: 2,
    storageBucketErrorCaptures: 'error-captures',
    storageBucketQuestionSnapshots: 'question-snapshots',
    storageSignedUrlTtlSeconds: 900,
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
  serviceClient = makeFakeSupabase();
  app = Fastify({ logger: false });
  installRequestDecorations(app, env);
  installErrorHandler(app);
  app.decorate('authPreHandler', async (req) => {
    // perRequestClient is rebound by `seedClient` below.
    req.auth = { userId: SUB, userEmail: 'test@example.com', jwt: 'fake' };
    req.supabaseUser = perRequestClient;
  });
  registerAnalyticsRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Default: empty fake supabase. Tests override via seedClient().
  perRequestClient = makeFakeSupabase();
  serviceClient = makeFakeSupabase();
});

function seedClient(tables: Record<string, Array<Record<string, unknown>>>) {
  perRequestClient = makeFakeSupabase({ tables });
}

describe('GET /analytics/dimensions', () => {
  it('returns the catalog envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/dimensions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBeTruthy();
    expect(body.data.krodexVersion).toBeTruthy();
    expect(body.data.dimensions).toHaveLength(13);
    expect(body.data.sourceTables).toContain('progress_evidence');
    expect(body.data.scheduleNote).toBeTruthy();
  });

  it('Phase 4: returns the per-dimension sourceClass map', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/dimensions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.schemaVersion).toBe('2.0.0');
    expect(body.data.sourceClass).toBeDefined();
    expect(body.data.sourceClass.tests_completed).toBe('A');
    expect(body.data.sourceClass.composite).toBe('C');
  });
});

describe('GET /analytics/evidence', () => {
  it('returns items + freshness envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/evidence' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.freshness).toBeDefined();
    expect(body.data.freshness).toHaveProperty('lastEventAt');
    expect(body.data.freshness).toHaveProperty('eventLagSeconds');
  });

  it('validates the dimension filter (rejects unknown dimension)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/evidence?dimension=not_a_real_one',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid dimension filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/evidence?dimension=syllabus_coverage',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
  });

  it('validates the since / until timestamps', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/evidence?since=not-a-timestamp',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('exposes the freshness block with non-null lag when events exist', async () => {
    seedClient({
      event_outbox: [
        {
          user_id: SUB,
          event_type: 'attempt.submitted',
          aggregate_id: 'a1',
          occurred_at: '2026-09-02T11:00:00Z',
        },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/analytics/evidence' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.freshness.lastEventAt).toBe('2026-09-02T11:00:00Z');
    expect(typeof body.data.freshness.eventLagSeconds).toBe('number');
  });
});

describe('GET /analytics/dashboards/overview', () => {
  it('returns the three-number envelope with zeros for a fresh user', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/dashboards/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.testsThisWeek).toBe(0);
    expect(body.data.activeErrors).toBe(0);
    expect(body.data.dueReviews).toBe(0);
    expect(body.data.metrics).toBeDefined();
    expect(body.data.metrics.dimensions.test_completion).toBeDefined();
    expect(body.data.metrics.dimensions.error_capture).toBeDefined();
    expect(body.data.metrics.dimensions.review_completion).toBeDefined();
    expect(body.data.metrics.dimensions.correction_rate).toBeDefined();
    expect(body.data.metrics.dimensions.reopen_rate).toBeDefined();
    expect(body.data.metrics.dimensions.time_to_correction).toBeDefined();
    expect(body.data.metrics.composite).toBeDefined();
    expect(body.data.computedAt).toBeTruthy();
  });

  it('returns nonzero counts when the seeded tables have data', async () => {
    seedClient({
      event_outbox: [
        { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: '2026-09-02T11:00:00Z' },
      ],
      error_entries: [
        { user_id: SUB, status: 'active' },
        { user_id: SUB, status: 'active' },
      ],
      review_schedules: [
        { user_id: SUB, state: 'due', due_at: '2026-09-01T00:00:00Z' },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/analytics/dashboards/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.testsThisWeek).toBe(1);
    expect(body.data.activeErrors).toBe(2);
    expect(body.data.dueReviews).toBe(1);
  });
});

describe('GET /analytics/dashboards/dimension/:key', () => {
  it('returns the deep-dive envelope for a valid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/dashboards/dimension/test_completion',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.key).toBe('test_completion');
    expect(body.data.window.label).toBe('7 days');
    expect(body.data.metric).toBeDefined();
    expect(body.data.metric).toHaveProperty('value');
    expect(body.data.metric).toHaveProperty('numerator');
    expect(body.data.metric).toHaveProperty('denominator');
    expect(body.data.metric).toHaveProperty('sampleSize');
    expect(body.data.metric).toHaveProperty('suppressed');
    expect(Array.isArray(body.data.series)).toBe(true);
    expect(body.data.trend).toMatch(/^(improving|declining|flat|insufficient_data)$/);
    expect(body.data.evidenceThreshold).toMatch(/^(limited|moderate|strong)$/);
    expect(body.data.drillDown.test_completion).toBeDefined();
    expect(body.data.explanation).toBeDefined();
    expect(body.data.explanation.templateVersion).toBeTruthy();
    expect(body.data.compositeContribution).toBeDefined();
    expect(body.data.compositeContribution.weight).toBeCloseTo(1 / 6);
  });

  it('rejects an unknown dimension key with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/dashboards/dimension/not_a_real_key',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /analytics/dashboards/dimension/:key/explain', () => {
  it('returns the explain block for a valid key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/dashboards/dimension/test_completion/explain',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.key).toBe('test_completion');
    expect(body.data.explanation).toBeDefined();
    expect(body.data.explanation.templateId).toBe('test_completion');
    expect(body.data.explanation.templateVersion).toBe('1.0.0');
  });
});

describe('POST /analytics/admin/recompute', () => {
  it('503s when service role is not configured', async () => {
    // Build a separate app where the service role is missing.
    const noServiceEnv = { ...env, hasServiceRole: false };
    const noServiceApp = Fastify({ logger: false });
    installRequestDecorations(noServiceApp, noServiceEnv);
    installErrorHandler(noServiceApp);
    noServiceApp.decorate('authPreHandler', async () => {
      // never called — admin route does not use it
    });
    registerAnalyticsRoutes(noServiceApp);
    await noServiceApp.ready();
    const res = await noServiceApp.inject({
      method: 'POST',
      url: '/analytics/admin/recompute',
      payload: { user_id: SUB },
    });
    expect(res.statusCode).toBe(503);
    await noServiceApp.close();
  });

  it('rejects a body without user_id (batch path is owned by the scheduled job)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analytics/admin/recompute',
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns rowsRecomputed for a per-user recompute', async () => {
    // Build a separate app whose service client is a fresh fake
    // with a stubbed `recompute_analytics_rollup` RPC. The
    // service client is cached by URL+key inside supabase.ts;
    // using a unique key forces a fresh client.
    const { __resetSupabaseClientsForTests } = await import('../../db/supabase');
    __resetSupabaseClientsForTests();
    const uniqueKey = `service-test-${Math.random()}`;
    process.env.SUPABASE_URL = 'http://example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = uniqueKey;
    const { getServiceClient } = await import('../../db/supabase');
    const freshClient = getServiceClient({
      ...env,
      supabaseUrl: 'http://example.test',
      supabaseServiceRoleKey: uniqueKey,
    });
    const rpcStub = (
      name: string,
    ): Promise<{ data: number; error: null } | { data: null; error: { message: string; code: string } }> => {
      if (name === 'recompute_analytics_rollup') {
        return Promise.resolve({ data: 7, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc', code: 'XX000' } });
    };
    (freshClient as unknown as { rpc: typeof rpcStub }).rpc = rpcStub;

    const recomputeApp = Fastify({ logger: false });
    installRequestDecorations(recomputeApp, env);
    installErrorHandler(recomputeApp);
    recomputeApp.decorate('authPreHandler', async () => {
      // never called — admin route does not use it
    });
    registerAnalyticsRoutes(recomputeApp);
    await recomputeApp.ready();

    const res = await recomputeApp.inject({
      method: 'POST',
      url: '/analytics/admin/recompute',
      payload: { user_id: SUB },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(body.data.rowsRecomputed).toBe(7);
    expect(body.data.userId).toBe(SUB);
    await recomputeApp.close();
  });
});

describe('cross-tenant isolation', () => {
  it('only sees the authenticated user\'s data on the overview endpoint', async () => {
    seedClient({
      event_outbox: [
        // Two users, only one matches the auth principal.
        { user_id: SUB, event_type: 'attempt.submitted', aggregate_id: 'a1', occurred_at: '2026-09-02T11:00:00Z' },
        { user_id: OTHER_USER, event_type: 'attempt.submitted', aggregate_id: 'a2', occurred_at: '2026-09-02T11:01:00Z' },
        { user_id: OTHER_USER, event_type: 'attempt.submitted', aggregate_id: 'a3', occurred_at: '2026-09-02T11:02:00Z' },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/analytics/dashboards/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The fake-supabase client does not enforce RLS by default; the
    // service-side filters by user_id explicitly, so the test asserts
    // the explicit filter works, not the absence of RLS.
    expect(body.data.testsThisWeek).toBe(1);
  });
});

