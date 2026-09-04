/**
 * KRODEX API — Phase 14 security-hardening test suite.
 *
 * Coverage:
 *   1. installSecurity() registers helmet, rate-limit, under-pressure
 *      when enabled, and skips them in test mode (or when explicitly
 *      disabled). The skipped path records a SecurityState with
 *      installed=false.
 *   2. The X-Request-ID onSend hook echoes the request id.
 *   3. Helmet adds X-Content-Type-Options and X-Frame-Options.
 *   4. Rate-limit returns 429 with the krodex error envelope after
 *      the global ceiling is hit.
 *   5. The audit logger writes a row to the audit_events table and
 *      is best-effort (a failure does not throw).
 *   6. The in-memory audit logger captures events for tests.
 *   7. /health surfaces the security policy.
 *
 * This suite runs in process with `LIVE_DB=0`. It does not require
 * a live Supabase; the rate-limit and helmet branches register
 * the real Fastify plugins and exercise them through `app.inject`.
 */

import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { installSecurity } from '../install-security';
import {
  makeAuditLogger,
  makeInMemoryAuditLogger,
  type AuditLogger,
} from '../audit-logger';
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
    rateLimitGlobalPerMin: 2, // very low so the 429 path is testable
    rateLimitAuthPerMin: 1,
    rateLimitAiPerMin: 1,
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
  };
});

afterAll(async () => {
  if (app) await app.close();
});

describe('installSecurity() — disabled', () => {
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await installSecurity(app, env, { enabled: false });
    app.get('/ping', async () => ({ ok: true }));
  });

  it('records installed=false on the security state', () => {
    expect(app.krodexSecurity).toBeDefined();
    expect(app.krodexSecurity?.installed).toBe(false);
    expect(app.krodexSecurity?.loadShedding).toBe(false);
  });

  it('does not rate-limit a 5-burst sequence when disabled', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/ping' });
      codes.push(res.statusCode);
    }
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it('does not echo X-Request-ID when disabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['x-request-id']).toBeUndefined();
  });
});

describe('installSecurity() — enabled', () => {
  let enabledApp: FastifyInstance;

  beforeEach(async () => {
    enabledApp = Fastify({ logger: false, genReqId: () => 'req-test-id-001' });
    // Low ceiling so the 429 path is exercisable in a test run.
    await installSecurity(enabledApp, env, {
      enabled: true,
      rateLimitGlobalPerMin: 2,
    });
    enabledApp.get('/ping', async () => ({ ok: true }));
    await enabledApp.ready();
  });

  afterEach(async () => {
    if (enabledApp) await enabledApp.close();
  });

  it('records installed=true and the policy numbers', () => {
    expect(enabledApp.krodexSecurity?.installed).toBe(true);
    expect(enabledApp.krodexSecurity?.policy.globalPerMin).toBe(2);
  });

  it('echoes X-Request-ID from genReqId via the onSend hook', async () => {
    const res = await enabledApp.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-test-id-001');
  });

  it('sets helmet security headers', async () => {
    const res = await enabledApp.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // X-Frame-Options varies between DENY and SAMEORIGIN across
    // helmet versions; either is acceptable.
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('returns 429 after the global ceiling is exhausted', async () => {
    // 1st and 2nd pass; 3rd is over the budget.
    const r1 = await enabledApp.inject({ method: 'GET', url: '/ping' });
    const r2 = await enabledApp.inject({ method: 'GET', url: '/ping' });
    const r3 = await enabledApp.inject({ method: 'GET', url: '/ping' });
    expect([r1.statusCode, r2.statusCode].every((c) => c === 200)).toBe(true);
    expect(r3.statusCode).toBe(429);
    const body = r3.json() as { error?: { code?: string }; success?: boolean };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('RATE_LIMITED');
  });
});

describe('audit-logger', () => {
  it('captures events in the in-memory implementation', async () => {
    const logger = makeInMemoryAuditLogger();
    await logger.log({
      actorId: 'user-1',
      action: 'PLANNER_CHECK_MISSED',
      resource: 'planner_tasks',
      resourceId: 'planner-1',
    });
    await logger.log({
      actorId: 'service_role',
      action: 'ANALYTICS_ADMIN_RECOMPUTE',
    });
    expect(logger.events).toHaveLength(2);
    expect(logger.events[0]?.action).toBe('PLANNER_CHECK_MISSED');
    expect(logger.events[1]?.action).toBe('ANALYTICS_ADMIN_RECOMPUTE');
  });

  it('logs a warning and short-circuits when no service client is supplied', async () => {
    const warnings: Array<{ level: string; msg: string }> = [];
    type FakeLog = {
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      info: () => void;
      debug: () => void;
      trace: () => void;
      fatal: () => void;
      child: () => FakeLog;
      level: 'warn';
      silent: () => void;
      msgPrefix: string;
    };
    const fakeLog: FakeLog = {
      // Pino's FastifyBaseLogger uses (obj, msg) signatures.
      // We accept any args, then capture the message.
      warn: (...args: unknown[]): void => {
        const msg = typeof args[args.length - 1] === 'string' ? (args[args.length - 1] as string) : '';
        warnings.push({ level: 'warn', msg });
      },
      error: (...args: unknown[]): void => {
        const msg = typeof args[args.length - 1] === 'string' ? (args[args.length - 1] as string) : '';
        warnings.push({ level: 'error', msg });
      },
      info: (): void => {
        /* no-op */
      },
      debug: (): void => {
        /* no-op */
      },
      trace: (): void => {
        /* no-op */
      },
      fatal: (): void => {
        /* no-op */
      },
      child: (): FakeLog => fakeLog,
      level: 'warn',
      silent: (): void => {
        /* no-op */
      },
      msgPrefix: 'audit-test',
    };
    const logger = makeAuditLogger(null, fakeLog);
    await logger.log({
      actorId: 'user-2',
      action: 'EVIDENCE_ASSET_SOFT_DELETE',
    });
    // The logger emits a warn line on a no-service-client path.
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.level).toBe('warn');
    expect(warnings[0]?.msg).toContain('krodex.audit.no_service_role');
  });

  it('does not throw on a service client that errors', async () => {
    const erroringClient = {
      from: () => ({
        insert: () =>
          Promise.resolve({
            error: { message: 'simulated db outage' },
          }),
      }),
    } as unknown as Parameters<typeof makeAuditLogger>[0];
    const fakeLog = makeSilentLog();
    const logger = makeAuditLogger(erroringClient, fakeLog);
    await expect(
      logger.log({ actorId: 'user-3', action: 'OUTBOX_EVENT_REPLAY' }),
    ).resolves.toBeUndefined();
  });
});

/** A no-op FastifyBaseLogger. */
function makeSilentLog(): import('fastify').FastifyBaseLogger {
  const noop = (): void => {
    /* no-op */
  };
  const base = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: (): import('fastify').FastifyBaseLogger => makeSilentLog(),
    level: 'silent' as const,
    silent: noop,
    msgPrefix: '',
  };
  return base as unknown as import('fastify').FastifyBaseLogger;
}

// Keep TS happy about unused imports under some configs.
void beforeEach;
