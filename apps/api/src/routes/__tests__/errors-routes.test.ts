/**
 * KRODEX API — PATCH /errors/:id route tests.
 *
 * Verifies the contract that status changes are routed through
 * the lifecycle service:
 *
 *   - `status: 'resolved'` -> the legacy `resolveError` service
 *     (sets the row, emits `error.resolved`).
 *   - any other status -> `transitionStatus` (state machine +
 *     `error_lifecycle_events` row + `error.lifecycle.*` event).
 *   - non-status fields -> the legacy `updateErrorEntry` path
 *     (which already emits `error.classified` correctly).
 *
 * Before the fix, the route passed `status` straight through to
 * `updateErrorEntry`, which (a) silently accepted illegal state
 * transitions and (b) emitted no event — so "Mark resolved" and
 * "Reopen" clicks in the UI updated the row but never triggered a
 * notification or a lifecycle history row.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerErrorRoutes } from '../errors';
import type { ApiEnv } from '../../config/env';

const SUB = '11111111-1111-4111-8111-111111111111';
const ERR_ID = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';

const OUTBOX_UNIQUE = [
  ['event_id', 'handler_name'],
  ['aggregate_id', 'event_type', 'aggregate_version', 'account_id'],
] as const;

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
  registerErrorRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  perRequestClient = makeFakeSupabase();
});

function seedActive() {
  perRequestClient = makeFakeSupabase({
    tables: {
      event_outbox: [],
      error_entries: [
        { id: ERR_ID, user_id: SUB, status: 'active', mistake_type: null },
      ],
      error_lifecycle_events: [],
    },
    uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
  });
}

function seedResolved() {
  perRequestClient = makeFakeSupabase({
    tables: {
      event_outbox: [],
      error_entries: [
        { id: ERR_ID, user_id: SUB, status: 'resolved', mistake_type: null },
      ],
      error_lifecycle_events: [],
    },
    uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
  });
}

function outboxRows(): Array<Record<string, unknown>> {
  return (perRequestClient as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('event_outbox');
}

function lifecycleRows(): Array<Record<string, unknown>> {
  return (perRequestClient as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('error_lifecycle_events');
}

describe('PATCH /errors/:id — status routing', () => {
  it('status=resolved from active flips status and emits error.resolved', async () => {
    seedActive();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { status: 'resolved' },
    });
    expect(res.statusCode).toBe(200);
    const outbox = outboxRows();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.event_type).toBe('error.resolved');
    expect(outbox[0]!.payload).toMatchObject({
      error_id: ERR_ID,
      trigger: 'manual',
    });
  });

  it('status=reopened from resolved emits error.lifecycle.reopened + audit row', async () => {
    seedResolved();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { status: 'reopened' },
    });
    expect(res.statusCode).toBe(200);
    const outbox = outboxRows();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.event_type).toBe('error.lifecycle.reopened');
    const audit = lifecycleRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]!).toMatchObject({
      error_entry_id: ERR_ID,
      from_status: 'resolved',
      to_status: 'reopened',
      trigger: 'manual',
    });
  });

  it('status=active from resolved is illegal (409 InvalidStateError)', async () => {
    // The state machine disallows `resolved -> active` (the only
    // valid out-edge from `resolved` is `reopened`). The route
    // must surface this as a 409 (InvalidStateError), not silently
    // accept it.
    seedResolved();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { status: 'active' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('status=in_review from active emits error.lifecycle.in_review + audit row', async () => {
    seedActive();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { status: 'in_review' },
    });
    expect(res.statusCode).toBe(200);
    expect(outboxRows()[0]!.event_type).toBe('error.lifecycle.in_review');
    expect(lifecycleRows()).toHaveLength(1);
  });

  it('status=archived from active emits error.lifecycle.archived + audit row', async () => {
    seedActive();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { status: 'archived' },
    });
    expect(res.statusCode).toBe(200);
    expect(outboxRows()[0]!.event_type).toBe('error.lifecycle.archived');
    expect(lifecycleRows()).toHaveLength(1);
  });

  it('mistake_type-only update still emits error.classified (regression check)', async () => {
    seedActive();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { mistake_type: 'concept' },
    });
    expect(res.statusCode).toBe(200);
    const outbox = outboxRows();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.event_type).toBe('error.classified');
  });

  it('combined status + mistake_type routes both correctly', async () => {
    // A single PATCH that flips status AND sets a mistake_type
    // should: (a) write the lifecycle event, (b) write the
    // classification event, (c) persist both changes.
    seedActive();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { status: 'in_review', mistake_type: 'concept' },
    });
    expect(res.statusCode).toBe(200);
    const outbox = outboxRows();
    const eventTypes = outbox.map((e) => e.event_type).sort();
    expect(eventTypes).toEqual(['error.classified', 'error.lifecycle.in_review']);
  });

  it('returns 400 for an unknown status value (schema validation)', async () => {
    seedActive();
    const res = await app.inject({
      method: 'PATCH',
      url: `/errors/${ERR_ID}`,
      payload: { status: 'not-a-real-status' },
    });
    expect(res.statusCode).toBe(400);
  });
});
