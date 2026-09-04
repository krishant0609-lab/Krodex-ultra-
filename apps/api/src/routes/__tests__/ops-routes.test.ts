/**
 * KRODEX API — /ops route tests.
 *
 * Phase 16 M8. Two mandatory tests:
 *   1. The service-role client (not the per-user one) is used
 *      for the event_log query. The route is NOT under
 *      `authPreHandler`; a request with NO `Authorization`
 *      header succeeds when the service role is configured,
 *      and the response is the standard KRODEX success
 *      envelope.
 *   2. The route is rejected (503 DependencyUnavailableError)
 *      when `env.hasServiceRole` is false. This guards against
 *      a misconfigured deploy.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerOpsRoutes } from '../ops';
import { getServiceClient } from '../../db/supabase';
import { getEventFailureReport } from '../../ops/event-failures';
import type { ApiEnv } from '../../config/env';

let app: FastifyInstance;
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
  // The ops route is NOT under authPreHandler. We deliberately
  // do NOT install the fake auth preHandler that other route
  // tests use.
  registerOpsRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /ops/event-failures — Phase 16 M8', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the success envelope without a user JWT (service-role path)', async () => {
    // Swap the real getServiceClient for a fake one. The fake
    // is seeded with one failed + one dead_letter + one
    // succeeded row for project_notification.
    const fakeService = makeFakeSupabase({
      tables: {
        event_log: [
          {
            handler_name: 'project_notification',
            status: 'failed',
            last_attempted_at: '2026-09-01T12:00:00.000Z',
          },
          {
            handler_name: 'project_notification',
            status: 'dead_letter',
            last_attempted_at: '2026-09-01T13:00:00.000Z',
          },
          {
            handler_name: 'project_notification',
            status: 'succeeded',
            last_attempted_at: '2026-09-01T14:00:00.000Z',
          },
        ],
      },
    });
    const supabaseModule = await import('../../db/supabase');
    const spy = vi
      .spyOn(supabaseModule, 'getServiceClient')
      .mockReturnValue(fakeService);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/ops/event-failures?since=2026-09-01T00:00:00.000Z&until=2026-09-02T00:00:00.000Z',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.requestId).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
      expect(body.data.since).toBe('2026-09-01T00:00:00.000Z');
      expect(body.data.until).toBe('2026-09-02T00:00:00.000Z');
      expect(body.data.status).toBe('all');
      expect(body.data.total).toBe(2);
      expect(body.data.buckets).toHaveLength(1);
      expect(body.data.buckets[0]).toEqual({
        handler_name: 'project_notification',
        failed: 1,
        dead_letter: 1,
        total: 2,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('returns 503 DependencyUnavailableError when env.hasServiceRole is false', async () => {
    // Spin up a second Fastify instance whose env has
    // hasServiceRole = false. The same registerOpsRoutes call
    // should reject with 503.
    const envNoService = { ...env, hasServiceRole: false } as ApiEnv;
    const app2 = Fastify({ logger: false });
    installRequestDecorations(app2, envNoService);
    installErrorHandler(app2);
    registerOpsRoutes(app2);
    await app2.ready();

    try {
      const res = await app2.inject({
        method: 'GET',
        url: '/ops/event-failures?since=2026-09-01T00:00:00.000Z&until=2026-09-02T00:00:00.000Z',
      });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(body.error.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      await app2.close();
    }
  });

  it('rejects with 400 when since >= until', async () => {
    // No need to seed a fake client; the validation should
    // trip before the service client is touched.
    const res = await app.inject({
      method: 'GET',
      url: '/ops/event-failures?since=2026-09-02T00:00:00.000Z&until=2026-09-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('getServiceClient', () => {
  it('returns a SupabaseClient when hasServiceRole is true', () => {
    const client = getServiceClient(env);
    const _: SupabaseClient = client;
    expect(_).toBeDefined();
  });
});

describe('getEventFailureReport (route wire-up cross-check)', () => {
  it('produces the same buckets the route would expose, given a seeded client', async () => {
    const seeded = makeFakeSupabase({
      tables: {
        event_log: [
          { handler_name: 'project_notification', status: 'failed', last_attempted_at: '2026-09-01T12:00:00.000Z' },
          { handler_name: 'project_notification', status: 'dead_letter', last_attempted_at: '2026-09-01T13:00:00.000Z' },
        ],
      },
    });
    const report = await getEventFailureReport(seeded, {
      since: '2026-09-01T00:00:00.000Z',
      until: '2026-09-02T00:00:00.000Z',
    });
    expect(report.total).toBe(2);
    expect(report.buckets[0]?.handler_name).toBe('project_notification');
    expect(report.buckets[0]?.failed).toBe(1);
    expect(report.buckets[0]?.dead_letter).toBe(1);
  });
});
