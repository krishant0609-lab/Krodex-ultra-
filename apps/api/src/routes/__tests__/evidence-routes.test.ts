/**
 * KRODEX API — /evidence and /errors/:id/lifecycle route tests (Phase 9).
 *
 * Verifies the wiring only: path → handler → service → envelope.
 * Service-level behaviour is covered by:
 *   - services/__tests__/error-evidence-service.test.ts
 *   - services/__tests__/error-lifecycle-service.test.ts
 *   - services/__tests__/evidence-asset-service.test.ts
 *   - services/__tests__/capture-orchestrator.test.ts
 *
 * The fake supabase stubs every table. We seed the minimum row
 * set to exercise the success and the "no snapshot" branches.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { installRequestDecorations } from '../../server-decorations';
import { installErrorHandler } from '../../errors/error-handler';
import { registerEvidenceRoutes } from '../evidence';
import type { ApiEnv } from '../../config/env';

const SUB = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ERROR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
  registerEvidenceRoutes(app);
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

describe('GET /evidence/:id', () => {
  it('returns evidence + null snapshot when no asset is available', async () => {
    seedClient({
      error_evidence: [
        {
          id: EVIDENCE_ID,
          user_id: SUB,
          attempt_id: null,
          error_entry_id: ERROR_ID,
          classification_status: 'pending',
          classification_source: 'ai',
          student_answer: 'B',
          expected_answer: 'C',
          question_snapshot_url: null,
          metadata: {},
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
      evidence_assets: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/evidence/${EVIDENCE_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.evidence.id).toBe(EVIDENCE_ID);
    expect(body.data.evidence.student_answer).toBe('B');
    expect(body.data.snapshot).toBeNull();
  });

  it('returns a fresh signed URL when an available asset exists', async () => {
    seedClient({
      error_evidence: [
        {
          id: EVIDENCE_ID,
          user_id: SUB,
          attempt_id: null,
          error_entry_id: ERROR_ID,
          classification_status: 'suggested',
          classification_source: 'ai',
          student_answer: 'B',
          expected_answer: 'C',
          question_snapshot_url: 'ref-to-asset',
          metadata: {},
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
      evidence_assets: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          evidence_id: EVIDENCE_ID,
          storage_bucket: 'error-evidence',
          storage_key: `${SUB}/${EVIDENCE_ID}/asset-1.png`,
          mime_type: 'image/png',
          byte_size: 1024,
          sha256: 'deadbeef',
          status: 'available',
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
    });
    // Pre-seed the fake storage with a byte so createSignedUrl can sign.
    (perRequestClient as unknown as {
      __storage: (b: string) => Map<string, Uint8Array>;
    }).__storage('error-evidence').set(
      `${SUB}/${EVIDENCE_ID}/asset-1.png`,
      new Uint8Array([1, 2, 3]),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/evidence/${EVIDENCE_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.snapshot).toBeTruthy();
    expect(body.data.snapshot.mimeType).toBe('image/png');
    expect(body.data.snapshot.byteSize).toBe(1024);
    expect(typeof body.data.snapshot.url).toBe('string');
    expect(body.data.snapshot.url).toContain('error-evidence');
    expect(typeof body.data.snapshot.expiresAt).toBe('string');
  });

  it('returns 404 when the evidence row is not found', async () => {
    seedClient({ error_evidence: [], evidence_assets: [] });
    const res = await app.inject({
      method: 'GET',
      url: `/evidence/${EVIDENCE_ID}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when the evidence row belongs to a different user', async () => {
    seedClient({
      error_evidence: [
        {
          id: EVIDENCE_ID,
          user_id: OTHER_USER,
          attempt_id: null,
          error_entry_id: null,
          classification_status: 'pending',
          classification_source: 'ai',
          student_answer: 'B',
          expected_answer: 'C',
          question_snapshot_url: null,
          metadata: {},
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
      evidence_assets: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/evidence/${EVIDENCE_ID}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns null snapshot when the only asset is soft-deleted', async () => {
    seedClient({
      error_evidence: [
        {
          id: EVIDENCE_ID,
          user_id: SUB,
          attempt_id: null,
          error_entry_id: ERROR_ID,
          classification_status: 'pending',
          classification_source: 'ai',
          student_answer: 'B',
          expected_answer: 'C',
          question_snapshot_url: null,
          metadata: {},
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
      evidence_assets: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          evidence_id: EVIDENCE_ID,
          storage_bucket: 'error-evidence',
          storage_key: `${SUB}/${EVIDENCE_ID}/asset-1.png`,
          mime_type: 'image/png',
          byte_size: 1024,
          sha256: 'deadbeef',
          status: 'deleted',
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/evidence/${EVIDENCE_ID}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.snapshot).toBeNull();
  });
});

describe('GET /errors/:id/lifecycle', () => {
  it('returns the immutable history rows, newest first', async () => {
    seedClient({
      error_entries: [
        {
          id: ERROR_ID,
          user_id: SUB,
          question_id: 'q1',
          status: 'resolved',
          mistake_type: 'concept',
          remark: null,
          source_attempt_id: null,
          first_seen_at: '2026-09-01T00:00:00Z',
          last_seen_at: '2026-09-01T00:00:00Z',
          resolved_at: '2026-09-02T00:00:00Z',
          recurrence_count: 0,
          metadata: {},
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-02T00:00:00Z',
        },
      ],
      error_lifecycle_events: [
        {
          id: 'l1',
          error_entry_id: ERROR_ID,
          from_status: 'active',
          to_status: 'in_review',
          trigger: 'student_review',
          reason: 'started review',
          review_id: null,
          created_at: '2026-09-01T10:00:00Z',
        },
        {
          id: 'l2',
          error_entry_id: ERROR_ID,
          from_status: 'in_review',
          to_status: 'resolved',
          trigger: 'student_review',
          reason: 'got it right',
          review_id: null,
          created_at: '2026-09-02T10:00:00Z',
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/errors/${ERROR_ID}/lifecycle`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('l2');
    expect(body.data[1].id).toBe('l1');
  });

  it('returns an empty array when there are no history rows', async () => {
    seedClient({
      error_entries: [
        {
          id: ERROR_ID,
          user_id: SUB,
          question_id: 'q1',
          status: 'active',
          mistake_type: null,
          remark: null,
          source_attempt_id: null,
          first_seen_at: '2026-09-01T00:00:00Z',
          last_seen_at: '2026-09-01T00:00:00Z',
          resolved_at: null,
          recurrence_count: 0,
          metadata: {},
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
      error_lifecycle_events: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/errors/${ERROR_ID}/lifecycle`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('returns 403 when the parent error belongs to a different user', async () => {
    seedClient({
      error_entries: [
        {
          id: ERROR_ID,
          user_id: OTHER_USER,
          question_id: 'q1',
          status: 'active',
          mistake_type: null,
          remark: null,
          source_attempt_id: null,
          first_seen_at: '2026-09-01T00:00:00Z',
          last_seen_at: '2026-09-01T00:00:00Z',
          resolved_at: null,
          recurrence_count: 0,
          metadata: {},
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
      error_lifecycle_events: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/errors/${ERROR_ID}/lifecycle`,
    });
    expect(res.statusCode).toBe(403);
  });
});
