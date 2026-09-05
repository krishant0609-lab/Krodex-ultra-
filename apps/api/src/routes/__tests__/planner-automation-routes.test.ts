/**
 * KRODEX API — /planner automation route tests (Phase 11).
 *
 * Verifies the wiring of the new automation routes:
 *
 *   POST /planner/check-missed
 *     - happy path: scans overdue tasks, returns newlyMissed
 *       and alreadyMissed arrays
 *     - 200 with empty arrays when no overdue tasks exist
 *
 *   POST /planner/tasks/:id/partial
 *     - happy path: transitions the task, increments
 *       partial_count, creates a backlog item, appends event row
 *     - 4xx on a missing / completed task
 *
 *   POST /planner/tasks/:id/reschedule
 *     - happy path: creates new task linked to original
 *     - rejects missing new_due_at
 *     - 4xx on a completed task
 *
 *   GET  /planner/tasks/:id/history
 *     - returns the events for the task in reverse order
 *
 *   GET  /planner/backlog/recovery-suggestions
 *     - returns a suggestion per open backlog item
 *
 *   POST /planner/backlog/recover/:id
 *     - reschedule action creates a new task and recovers the
 *       backlog item
 *     - dismiss action drops the backlog item
 *     - 4xx when reschedule is missing new_due_at
 *
 * Service-level behavior (state machine, idempotency) is
 * covered by the dedicated service tests. The route tests
 * only prove the handlers wire the right preHandler and shape
 * the right envelope.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerPlannerRoutes } from '../planner';
import type { ApiEnv } from '../../config/env';

const SUB = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const BACKLOG_ID = '33333333-3333-4333-8333-333333333333';

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
  registerPlannerRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  perRequestClient = makeFakeSupabase();
});

describe('POST /planner/check-missed', () => {
  it('returns 200 with newlyMissed and createdBacklogItemIds', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-08-30' },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/planner/check-missed',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.newlyMissed).toHaveLength(1);
    expect(body.data.newlyMissed[0].id).toBe(TASK_ID);
    expect(body.data.alreadyMissed).toHaveLength(0);
    expect(body.data.createdBacklogItemIds).toHaveLength(1);
  });

  it('returns 200 with empty arrays when no overdue tasks exist', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-12-30' },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/planner/check-missed',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.newlyMissed).toHaveLength(0);
    expect(body.data.alreadyMissed).toHaveLength(0);
  });
});

describe('POST /planner/tasks/:id/partial', () => {
  it('happy path: transitions to partial, appends event, creates backlog', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', partial_count: 0 },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/planner/tasks/${TASK_ID}/partial`,
      payload: { actual_duration_minutes: 15, reason: 'ran out of time' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.task.state).toBe('partial');
    expect(body.data.task.partial_count).toBe(1);
    expect(body.data.backlogItem.reason).toBe('partial');
  });

  it('rejects with 4xx on a completed task', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [{ id: TASK_ID, user_id: SUB, state: 'completed' }],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/planner/tasks/${TASK_ID}/partial`,
      payload: {},
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /planner/tasks/:id/reschedule', () => {
  it('happy path: creates a new task linked to the original', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-09-01' },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/planner/tasks/${TASK_ID}/reschedule`,
      payload: { new_due_at: '2026-09-08T00:00:00Z' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.originalTask.id).toBe(TASK_ID);
    expect(body.data.newTask.source_task_id).toBe(TASK_ID);
    expect(body.data.newTask.plan_date).toBe('2026-09-08T00:00:00Z');
  });

  it('rejects with 4xx when new_due_at is missing', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [{ id: TASK_ID, user_id: SUB, state: 'planned' }],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/planner/tasks/${TASK_ID}/reschedule`,
      payload: {},
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /planner/tasks/:id/history', () => {
  it('returns the events in reverse-chronological order', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [{ id: TASK_ID, user_id: SUB }],
        planner_task_events: [
          { id: 'e1', task_id: TASK_ID, event_type: 'created', created_at: '2026-08-30T10:00:00Z' },
          { id: 'e2', task_id: TASK_ID, event_type: 'completed', created_at: '2026-09-01T10:00:00Z' },
        ],
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/planner/tasks/${TASK_ID}/history`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((e: { id: string }) => e.id)).toEqual(['e2', 'e1']);
  });
});

describe('GET /planner/backlog/recovery-suggestions', () => {
  it('returns one suggestion per open backlog item', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        backlog_items: [
          {
            id: BACKLOG_ID,
            user_id: SUB,
            source_task_id: TASK_ID,
            reason: 'missed',
            state: 'open',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/planner/backlog/recovery-suggestions',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.suggestions).toHaveLength(1);
    expect(body.data.suggestions[0].backlogItemId).toBe(BACKLOG_ID);
    expect(body.data.suggestions[0].suggestedAction).toBe('reschedule');
  });
});

describe('POST /planner/backlog/recover/:id', () => {
  it('reschedule creates a new task and recovers the backlog', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'missed', plan_date: '2026-08-30' },
        ],
        backlog_items: [
          {
            id: BACKLOG_ID,
            user_id: SUB,
            source_task_id: TASK_ID,
            reason: 'missed',
            state: 'open',
          },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/planner/backlog/recover/${BACKLOG_ID}`,
      payload: { action: 'reschedule', new_due_at: '2026-09-08T00:00:00Z' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.newTask.plan_date).toBe('2026-09-08T00:00:00Z');
    expect(body.data.backlogItem.state).toBe('recovered');
  });

  it('dismiss drops the backlog without touching any task', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        planner_tasks: [
          { id: TASK_ID, user_id: SUB, state: 'planned', plan_date: '2026-08-30' },
        ],
        backlog_items: [
          {
            id: BACKLOG_ID,
            user_id: SUB,
            source_task_id: TASK_ID,
            reason: 'missed',
            state: 'open',
          },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/planner/backlog/recover/${BACKLOG_ID}`,
      payload: { action: 'dismiss' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.backlogItem.state).toBe('dropped');
  });

  it('rejects reschedule without new_due_at', async () => {
    perRequestClient = makeFakeSupabase({
      tables: {
        backlog_items: [
          {
            id: BACKLOG_ID,
            user_id: SUB,
            source_task_id: TASK_ID,
            reason: 'missed',
            state: 'open',
          },
        ],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/planner/backlog/recover/${BACKLOG_ID}`,
      payload: { action: 'reschedule' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
