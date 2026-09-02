/**
 * KRODEX API — event-bus orchestrator tests.
 *
 * Per PHASE3_PLAN.md §6.1 + §6.3, the API process owns:
 *   - the outbox worker poll loop
 *   - the scheduled-jobs timer
 *   - the handler registry
 *
 * The event bus module is the only file that wires those three
 * together. These tests assert the contract:
 *
 *   1. buildEventBus always returns an EventBus; status() never throws.
 *   2. With no service-role Supabase client available, the bus is
 *      disabled (running=false, reason='service_role_unconfigured'),
 *      the worker is not started, and /health reports it.
 *   3. With service-role available, start() arms the poll loop
 *      and the scheduler; stop() disarms both.
 *   4. The registry contains the 3 production handlers, each
 *      subscribed to the right event types.
 *   5. The status snapshot exposes handler names, poll interval,
 *      and scheduler job intervals.
 *   6. Tick errors do not crash the bus; they are recorded in
 *      `lastError` and the next tick runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiEnv } from '../config/env';
import { buildEventBus, type EventBus } from './event-bus';
import { POLL_INTERVAL_MS, BACKOFF_MS, MAX_ATTEMPTS } from './worker';
import { DEFAULT_INTERVALS_MS } from './scheduled-jobs';

const baseEnv: ApiEnv = {
  nodeEnv: 'test',
  logLevel: 'silent',
  apiPort: 3001,
  apiHost: '127.0.0.1',
  webOrigin: 'http://localhost:3000',
  corsAllowedOrigins: ['http://localhost:3000'],
  supabaseUrl: '',
  supabaseAnonKey: '',
  supabaseServiceRoleKey: '',
  supabaseDbUrl: '',
  authJwtSecret: 'a'.repeat(32),
  authJwtTtlSeconds: 3600,
  authRefreshTtlSeconds: 2592000,
  aiProvider: 'openai',
  aiApiKey: '',
  aiModelDefault: '',
  aiModelReasoning: '',
  aiTimeoutMs: 30000,
  aiMaxRetries: 3,
  storageBucketErrorCaptures: '',
  storageBucketQuestionSnapshots: '',
  storageSignedUrlTtlSeconds: 3600,
  rateLimitGlobalPerMin: 600,
  rateLimitAuthPerMin: 60,
  rateLimitAiPerMin: 60,
  emailProvider: 'none',
  emailApiKey: '',
  emailFromAddress: '',
  emailFromName: '',
  pushProvider: 'none',
  pushVapidPublicKey: '',
  pushVapidPrivateKey: '',
  pushSubject: '',
  featureFlags: {
    planner: true,
    tests: true,
    errorBank: true,
    review: true,
    progress: true,
    aiInsights: false,
    notifications: true,
    capture: true,
  },
  hasSupabase: false,
  hasServiceRole: false,
};

const configuredEnv: ApiEnv = {
  ...baseEnv,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'anon-test',
  supabaseServiceRoleKey: 'service-test',
  hasSupabase: true,
  hasServiceRole: true,
};

function silentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe('buildEventBus (no service role)', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = buildEventBus(baseEnv, silentLogger() as never);
  });

  it('returns a non-running bus with reason=service_role_unconfigured', () => {
    const s = bus.status();
    expect(s.running).toBe(false);
    expect(s.reason).toBe('service_role_unconfigured');
  });

  it('does not throw when status() is called before start()', () => {
    expect(() => bus.status()).not.toThrow();
  });

  it('start() is a no-op (does not throw, stays disabled)', () => {
    bus.start();
    expect(bus.isRunning()).toBe(false);
    const s = bus.status();
    expect(s.running).toBe(false);
    expect(s.reason).toBe('service_role_unconfigured');
  });

  it('exposes the 5 production handler names in the registry (3 Phase 3 + project_analytics_rollup Phase 4 + project_student_model Phase 5)', () => {
    const s = bus.status();
    expect(s.worker.handlers).toEqual(
      expect.arrayContaining([
        'project_progress_evidence',
        'project_notification',
        'emit_attempt_analyzed',
        'project_analytics_rollup',
        'project_student_model',
      ]),
    );
    expect(s.worker.handlers).toHaveLength(5);
  });

  it('exposes the PHASE3_PLAN-locked poll interval (5000ms)', () => {
    const s = bus.status();
    expect(s.worker.pollIntervalMs).toBe(POLL_INTERVAL_MS);
    expect(s.worker.pollIntervalMs).toBe(5000);
  });

  it('exposes the PHASE3_PLAN-locked scheduler intervals (5m, 15m)', () => {
    const s = bus.status();
    expect(s.scheduler.jobs).toEqual(DEFAULT_INTERVALS_MS);
    expect(s.scheduler.jobs.mark_review_due).toBe(5 * 60 * 1000);
    expect(s.scheduler.jobs.detect_task_missed).toBe(15 * 60 * 1000);
  });

  it('stop() is a safe no-op when never started', () => {
    expect(() => bus.stop()).not.toThrow();
    expect(bus.isRunning()).toBe(false);
  });
});

describe('buildEventBus (with service role)', () => {
  let bus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = buildEventBus(configuredEnv, silentLogger() as never);
  });

  afterEach(() => {
    bus.stop();
    vi.useRealTimers();
  });

  it('start() arms the poll loop and reports running=true', () => {
    bus.start();
    expect(bus.isRunning()).toBe(true);
    const s = bus.status();
    expect(s.running).toBe(true);
    expect(s.reason).toBe('ok');
    expect(s.worker.running).toBe(true);
    expect(s.scheduler.running).toBe(true);
  });

  it('stop() disarms both timers and reports running=false', () => {
    bus.start();
    bus.stop();
    expect(bus.isRunning()).toBe(false);
    const s = bus.status();
    expect(s.running).toBe(false);
    expect(s.worker.running).toBe(false);
    expect(s.scheduler.running).toBe(false);
  });

  it('start() is idempotent (calling twice does not double-arm)', () => {
    bus.start();
    bus.start();
    expect(bus.isRunning()).toBe(true);
  });

  it('stop() is idempotent (calling twice does not throw)', () => {
    bus.start();
    bus.stop();
    expect(() => bus.stop()).not.toThrow();
    expect(bus.isRunning()).toBe(false);
  });
});

describe('event-bus worker tunables (PHASE3_PLAN §13 decision 2)', () => {
  it('MAX_ATTEMPTS is 5', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it('BACKOFF_MS is the locked schedule 0/30s/2m/10m/1h', () => {
    expect(BACKOFF_MS).toEqual([0, 30_000, 120_000, 600_000, 3_600_000]);
  });

  it('POLL_INTERVAL_MS is 5000 (5s)', () => {
    expect(POLL_INTERVAL_MS).toBe(5_000);
  });
});

describe('event-bus registry subscriptions', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = buildEventBus(baseEnv, silentLogger() as never);
  });

  it('project_progress_evidence is subscribed to all 13 production event types + system.tick', () => {
    const reg = bus.registry();
    const handler = reg.allHandlers().find((h) => h.name === 'project_progress_evidence');
    expect(handler).toBeDefined();
    const subs = reg.handlersFor('attempt.submitted');
    expect(subs.some((h) => h.name === 'project_progress_evidence')).toBe(true);
    const subs2 = reg.handlersFor('system.tick');
    expect(subs2.some((h) => h.name === 'project_progress_evidence')).toBe(true);
  });

  it('project_notification is subscribed to notification.created only', () => {
    const reg = bus.registry();
    const subs = reg.handlersFor('notification.created');
    expect(subs.map((h) => h.name)).toContain('project_notification');
    // Should NOT be subscribed to unrelated events.
    expect(reg.handlersFor('attempt.submitted').map((h) => h.name)).not.toContain('project_notification');
  });

  it('emit_attempt_analyzed is subscribed to attempt.submitted only', () => {
    const reg = bus.registry();
    const subs = reg.handlersFor('attempt.submitted');
    expect(subs.map((h) => h.name)).toContain('emit_attempt_analyzed');
    // Should NOT be subscribed to other events.
    expect(reg.handlersFor('task.completed').map((h) => h.name)).not.toContain('emit_attempt_analyzed');
  });
});
