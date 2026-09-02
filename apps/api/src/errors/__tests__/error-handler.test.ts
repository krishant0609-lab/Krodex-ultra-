/**
 * KRODEX API — error handler tests.
 *
 * The handler converts an Error into the documented `ApiEnvelope`.
 * We hit the handler with a real Fastify instance and assert the
 * envelope and status for each error class.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { installErrorHandler } from '../error-handler';
import { AppError, ValidationError, NotFoundError, ForbiddenError } from '../app-error';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  installErrorHandler(app);
  // Three routes, each throwing a different error class.
  app.get('/throw/app', async () => {
    throw new AppError('INTERNAL', 'boom');
  });
  app.get('/throw/validation', async () => {
    throw new ValidationError('bad', { fields: [{ path: 'a', message: 'no' }] });
  });
  app.get('/throw/zod', async () => {
    throw new ZodError([{ path: ['b'], message: 'nope', code: 'custom' } as never]);
  });
  app.get('/throw/notfound', async () => {
    throw new NotFoundError('gone');
  });
  app.get('/throw/forbidden', async () => {
    throw new ForbiddenError('nope');
  });
  app.get('/throw/fastify4xx', async () => {
    // A FastifyError-shaped object: statusCode 400 means the handler
    // should map it to a KRODEX 4xx code (VALIDATION_ERROR here).
    const e = new Error('bad') as Error & { statusCode: number };
    e.statusCode = 400;
    throw e;
  });
  app.get('/throw/unknown', async () => {
    throw new Error('boom');
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const r = await app.inject({ method: 'GET', url: path });
  return { status: r.statusCode, body: r.json() };
}

describe('installErrorHandler', () => {
  it('maps an AppError to its code + httpStatus', async () => {
    const r = await get('/throw/app');
    expect(r.status).toBe(500);
    expect(r.body.success).toBe(false);
    expect(r.body.error.code).toBe('INTERNAL');
  });

  it('includes field details for ValidationError', async () => {
    const r = await get('/throw/validation');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.fields?.[0]?.path).toBe('a');
  });

  it('maps ZodError to VALIDATION_ERROR with field paths', async () => {
    const r = await get('/throw/zod');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.fields?.[0]?.path).toBe('b');
  });

  it('maps NotFoundError to 404', async () => {
    const r = await get('/throw/notfound');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('maps ForbiddenError to 403', async () => {
    const r = await get('/throw/forbidden');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('maps a Fastify 4xx to the closest KRODEX code', async () => {
    const r = await get('/throw/fastify4xx');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('hides the message of an unknown error', async () => {
    const r = await get('/throw/unknown');
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL');
    expect(r.body.error.message).toBe('internal error');
  });

  it('always includes requestId and timestamp', async () => {
    const r = await get('/throw/app');
    expect(typeof r.body.requestId).toBe('string');
    expect(typeof r.body.timestamp).toBe('string');
  });
});
