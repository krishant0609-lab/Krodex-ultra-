/**
 * KRODEX API — route-level integration tests.
 *
 * Boots the real Fastify app via buildServer() and uses
 * app.inject() to drive routes without a network. Covers:
 *
 *  - GET /health returns 200 with the documented envelope
 *    shape (status, service, version, phase, db, timestamp)
 *  - POST /auth/dev-token validates the body via zod, mints a
 *    JWT, and returns the documented envelope
 *  - Authenticated routes refuse requests when the preHandler
 *    is not satisfied (no bearer token) and return the KRODEX
 *    error envelope
 *
 * Live-DB paths (e.g. /users/me reading from public.users) are
 * gated by LIVE_DB=1 and skipped in the current Docker-less
 * environment. The unit tests + service tests already cover
 * those surfaces against the fake-supabase client.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server';
import { signDevJwt } from '../auth/dev-jwt';

let app: FastifyInstance | null = null;

beforeAll(async () => {
  // The default dev env has SUPABASE_URL empty; buildServer()
  // boots fine in LENIENT mode and the auth preHandler refuses
  // every request with 401. That is exactly what the tests below
  // assert.
  app = await buildServer();
});

afterEach(async () => {
  // We don't reset between tests because the app has no per-test
  // mutation that matters; this hook exists to make future
  // per-test reset easy to add.
});

afterAll(async () => {
  if (app) {
    await app.close();
    app = null;
  }
});

describe('GET /health', () => {
  it('returns the documented envelope (no auth required)', async () => {
    const res = await app!.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.service).toBe('krodex-api');
    expect(body.data.status).toBe('ok');
    expect(body.data.phase).toBe('4');
    expect(body.data.version).toBeTruthy();
    expect(body.data.timestamp).toBeTruthy();
    expect(body.data.db).toBeTruthy();
    expect(body.requestId).toBeTruthy();
  });

  it('reports the Phase 3+4 event_bus block (running=false when service role is unconfigured)', async () => {
    const res = await app!.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const bus = body.data.event_bus;
    expect(bus).toBeDefined();
    expect(bus.running).toBe(false);
    expect(bus.reason).toBe('service_role_unconfigured');
    expect(bus.worker.handlers).toEqual(
      expect.arrayContaining([
        'project_progress_evidence',
        'project_notification',
        'emit_attempt_analyzed',
        'project_analytics_rollup',
      ]),
    );
    expect(bus.worker.pollIntervalMs).toBe(5000);
    // Phase 4 added the `recompute_analytics_rollup` scheduled
    // job (D-9, 5-minute cadence, Class C — Approved Product
    // Policy). Phase 5 added the `recompute_student_model`
    // job on the same 5-minute cadence (per PHASE5_PLAN §5).
    expect(bus.scheduler.jobs).toEqual({
      mark_review_due: 5 * 60 * 1000,
      detect_task_missed: 15 * 60 * 1000,
      recompute_analytics_rollup: 5 * 60 * 1000,
      recompute_student_model: 5 * 60 * 1000,
    });
  });
});

describe('POST /auth/dev-token', () => {
  it('mints a token and returns the documented envelope', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/auth/dev-token',
      payload: { user_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.token).toBeTruthy();
    expect(body.data.expires_at).toBeTruthy();
    // The minted token must be a 3-part JWT.
    expect(body.data.token.split('.').length).toBe(3);
  });

  it('mints with an email and a custom ttl', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/auth/dev-token',
      payload: {
        user_id: '11111111-1111-4111-8111-111111111111',
        email: 'a@b.co',
        ttl_seconds: 60,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.token.split('.').length).toBe(3);
  });

  it('rejects an invalid user_id (zod failure -> VALIDATION_ERROR)', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/auth/dev-token',
      payload: { user_id: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects when body is missing', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/auth/dev-token',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('authenticated route guards', () => {
  it('GET /users/me without a bearer token returns 401', async () => {
    const res = await app!.inject({ method: 'GET', url: '/users/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /syllabus/subjects without a bearer token returns 401', async () => {
    const res = await app!.inject({ method: 'GET', url: '/syllabus/subjects' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('a tampered bearer token still fails the preHandler', async () => {
    // Mint a real token, then change the signature so verification fails.
    const env = app!.krodexEnv;
    const good = signDevJwt(env.authJwtSecret, '11111111-1111-4111-8111-111111111111');
    const parts = good.split('.');
    const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAA`;
    const res = await app!.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
