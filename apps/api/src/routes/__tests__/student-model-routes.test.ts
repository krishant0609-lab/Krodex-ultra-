/**
 * KRODEX API — /student-model route tests.
 *
 * Per PHASE5_PLAN.md §7 + §8, the student-model endpoints are:
 *   GET  /student-model                  — latest snapshot for the auth'd user
 *   POST /student-model/admin/recompute  — service-role recompute for one user
 *
 * These tests build a minimal Fastify instance, install the
 * route registration, and bypass the real auth preHandler by
 * installing a fake one that:
 *   1. Mints a fake `req.auth` with a known userId.
 *   2. Sets `req.supabaseUser` to a fake-supabase client seeded
 *      with the table contents the test cares about.
 *
 * This is a route-level test of the wiring (path → handler →
 * service → response envelope). The service-level tests in
 * `apps/api/src/student-model/__tests__/student-model-service.test.ts`
 * cover the business logic in isolation. Live-DB SQL queries
 * are not exercised here — the fake supabase stubs them.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerStudentModelRoutes } from '../student-model';
import type { ApiEnv } from '../../config/env';

const SUB = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

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
  app = Fastify({ logger: false });
  installRequestDecorations(app, env);
  installErrorHandler(app);
  app.decorate('authPreHandler', async (req) => {
    // perRequestClient is rebound by `seedClient` below.
    req.auth = { userId: SUB, userEmail: 'test@example.com', jwt: 'fake' };
    req.supabaseUser = perRequestClient;
  });
  registerStudentModelRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  perRequestClient = makeFakeSupabase();
});

function seedClient(tables: Record<string, Array<Record<string, unknown>>>) {
  perRequestClient = makeFakeSupabase({ tables });
}

const SEVEN_FEATURES = {
  consistency_score: {
    featureKey: 'consistency_score',
    score: 0.85,
    direction: 'stable',
    confidence: 'strong',
    sampleSize: 28,
    evidenceWindowDays: 28,
  },
  procrastination_score: {
    featureKey: 'procrastination_score',
    score: 0.15,
    direction: 'improving',
    confidence: 'strong',
    sampleSize: 24,
    evidenceWindowDays: 28,
  },
  recovery_score: {
    featureKey: 'recovery_score',
    score: 0.92,
    direction: 'stable',
    confidence: 'moderate',
    sampleSize: 12,
    evidenceWindowDays: 28,
  },
  error_recurrence_score: {
    featureKey: 'error_recurrence_score',
    score: 0.3,
    direction: 'declining',
    confidence: 'strong',
    sampleSize: 30,
    evidenceWindowDays: 28,
  },
  review_compliance_score: {
    featureKey: 'review_compliance_score',
    score: 0.78,
    direction: 'improving',
    confidence: 'moderate',
    sampleSize: 18,
    evidenceWindowDays: 28,
  },
  workload_pressure_score: {
    featureKey: 'workload_pressure_score',
    score: 0.55,
    direction: 'stable',
    confidence: 'moderate',
    sampleSize: 15,
    evidenceWindowDays: 28,
  },
  learning_trajectory: {
    featureKey: 'learning_trajectory',
    score: 0.75,
    direction: 'improving',
    confidence: 'moderate',
    sampleSize: 28,
    evidenceWindowDays: 28,
  },
};

describe('GET /student-model', () => {
  it('returns the snapshot envelope when a snapshot exists', async () => {
    seedClient({
      student_model_snapshots: [
        {
          user_id: SUB,
          features: SEVEN_FEATURES,
          confidence: 0.5,
          computed_at: '2026-09-02T11:00:00Z',
        },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/student-model' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.windowDays).toBe(28);
    expect(body.data.snapshot.userId).toBe(SUB);
    expect(body.data.snapshot.computedAt).toBe('2026-09-02T11:00:00Z');
    expect(body.data.snapshot.evidenceWindowDays).toBe(28);
    expect(body.data.snapshot.overallConfidence).toBe('moderate');
    expect(Object.keys(body.data.snapshot.features)).toHaveLength(7);
    expect(body.data.snapshot.features.consistency_score.score).toBe(0.85);
  });

  it('returns 404 when no snapshot exists yet for the user', async () => {
    const res = await app.inject({ method: 'GET', url: '/student-model' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('accepts a valid window_days query param and reflects it in the envelope', async () => {
    seedClient({
      student_model_snapshots: [
        {
          user_id: SUB,
          features: SEVEN_FEATURES,
          confidence: 0.5,
          computed_at: '2026-09-02T11:00:00Z',
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/student-model?window_days=14',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.windowDays).toBe(14);
  });

  it('rejects an out-of-range window_days with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/student-model?window_days=0',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-integer window_days with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/student-model?window_days=not-a-number',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /student-model/admin/recompute', () => {
  it('503s when the service role is not configured', async () => {
    const noServiceEnv = { ...env, hasServiceRole: false };
    const noServiceApp = Fastify({ logger: false });
    installRequestDecorations(noServiceApp, noServiceEnv);
    installErrorHandler(noServiceApp);
    noServiceApp.decorate('authPreHandler', async () => {
      // never called — admin route does not use it
    });
    registerStudentModelRoutes(noServiceApp);
    await noServiceApp.ready();
    const res = await noServiceApp.inject({
      method: 'POST',
      url: '/student-model/admin/recompute',
      payload: { user_id: SUB },
    });
    expect(res.statusCode).toBe(503);
    await noServiceApp.close();
  });

  it('rejects a body without user_id with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/student-model/admin/recompute',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed user_id with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/student-model/admin/recompute',
      payload: { user_id: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range window_days with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/student-model/admin/recompute',
      payload: { user_id: SUB, window_days: 200 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the recompute envelope for a valid per-user call', async () => {
    // The admin route calls getServiceClient(env), then runs the
    // orchestrator (which loads 4 evidence tables via .from().select()
    // ...), then calls client.rpc('recompute_student_model', ...).
    //
    // We swap the supabase module's getServiceClient for the
    // duration of this test with a fake-supabase instance that
    // already has the RPC stubbed. The orchestrator's reads
    // against empty tables return [] (sparse payload).
    const fakeService = makeFakeSupabase({
      rpcImpls: {
        recompute_student_model: () => ({ data: 7, error: null }),
      },
    });
    const supabaseModule = await import('../../db/supabase');
    const spy = vi
      .spyOn(supabaseModule, 'getServiceClient')
      .mockReturnValue(fakeService);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/student-model/admin/recompute',
        payload: { user_id: SUB },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.ok).toBe(true);
      expect(body.data.featuresWritten).toBe(7);
      expect(body.data.userId).toBe(SUB);
      expect(body.data.windowDays).toBe(28);
      expect(Object.keys(body.data.payload.features)).toHaveLength(7);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('cross-tenant isolation', () => {
  it('GET /student-model only returns the authenticated user\'s snapshot', async () => {
    seedClient({
      student_model_snapshots: [
        {
          user_id: SUB,
          features: SEVEN_FEATURES,
          confidence: 0.5,
          computed_at: '2026-09-02T11:00:00Z',
        },
        {
          user_id: OTHER_USER,
          features: SEVEN_FEATURES,
          confidence: 0.5,
          computed_at: '2026-09-02T11:00:00Z',
        },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/student-model' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.snapshot.userId).toBe(SUB);
  });
});
