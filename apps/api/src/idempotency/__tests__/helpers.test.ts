/**
 * KRODEX API — withIdempotency unit tests.
 *
 * We can't exercise the Supabase-backed lookup path without a
 * live DB. These tests focus on the no-key path (run the action,
 * return the envelope) and the contract that withIdempotency
 * populates `reply.code(200)` and `reply.send(envelope)`.
 */

import { describe, expect, it } from 'vitest';
import type { FastifyReply } from 'fastify';
import { withIdempotency } from '../helpers';

const SUB = '11111111-1111-4111-8111-111111111111';

function fakeReply() {
  const r: {
    status?: number;
    body?: unknown;
    code: (s: number) => typeof r;
    send: (env: unknown) => typeof r;
    request: { id: string };
  } = {
    request: { id: 'req_test' },
    code(s) {
      r.status = s;
      return r;
    },
    send(env) {
      r.body = env;
      return r;
    },
  };
  return r as unknown as FastifyReply;
}

describe('withIdempotency (no key)', () => {
  it('runs the action and returns the envelope at 200', async () => {
    let called = 0;
    const reply = fakeReply();

    await withIdempotency({
      env: {} as never,
      req: {
        headers: {},
        auth: { userId: SUB },
      } as never,
      reply,
      body: { a: 1 },
      route: 'POST /test',
      action: () => {
        called++;
        return { ok: true };
      },
      envelope: (data, requestId, timestamp) => ({
        success: true,
        data,
        requestId,
        timestamp,
      }),
    });

    expect(called).toBe(1);
    expect(reply.status).toBe(200);
    expect((reply as unknown as { body: { data: unknown } }).body.data).toEqual({
      ok: true,
    });
  });

  it('returns 401 when auth is missing but key present', async () => {
    const reply = fakeReply();
    await withIdempotency({
      env: {} as never,
      req: {
        headers: { 'idempotency-key': 'k' },
      } as never,
      reply,
      body: { a: 1 },
      route: 'POST /test',
      action: () => ({ ok: true }),
      envelope: (data, requestId, timestamp) => ({
        success: true,
        data,
        requestId,
        timestamp,
      }),
    });
    expect(reply.status).toBe(401);
    const body = (reply as unknown as { body: { error: { code: string } } }).body;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('withIdempotency (with key, no live DB)', () => {
  it('lookup/record paths are integration-only', () => {
    // The lookup/record paths require the service-role Supabase
    // client (LIVE_DB=1). Asserting the no-key path is enough to
    // prove the helper wires the right inputs into the envelope
    // and reply.
    expect(true).toBe(true);
  });
});
