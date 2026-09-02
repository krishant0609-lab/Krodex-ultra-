/**
 * KRODEX API — idempotency helper for routes.
 *
 * `withIdempotency` is a thin orchestrator that:
 *   1. Reads the Idempotency-Key header.
 *   2. Hashes the request body.
 *   3. If a stored response exists, returns it with
 *      `idempotencyReplay: true`.
 *   4. Otherwise runs the action, then records the response.
 *
 * The route handler builds the body once (zod-parsed) and passes
 * it in. The handler then writes the final response to Fastify
 * using `reply.code(status).send(envelope)` so the body we record
 * is the body we actually returned to the client.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from '../config/env';
import type { ApiEnvelope, ApiSuccessEnvelope } from '@krodex/shared';
import {
  hashRequest,
  lookupIdempotency,
  readIdempotencyKey,
  recordIdempotency,
} from './store';

export interface WithIdempotencyInput<TBody, TData> {
  env: ApiEnv;
  req: FastifyRequest;
  reply: FastifyReply;
  /** Parsed request body. */
  body: TBody;
  /** Stable route identifier. */
  route: string;
  /** The actual work. Returns the data for a 2xx response. */
  action: () => Promise<TData> | TData;
  /** Build the success envelope (so the route can shape `data`). */
  envelope: (data: TData, requestId: string, timestamp: string) => ApiSuccessEnvelope<TData>;
}

export interface WithIdempotencyResult {
  replay: boolean;
  status: number;
}

export async function withIdempotency<TBody, TData>(
  input: WithIdempotencyInput<TBody, TData>,
): Promise<WithIdempotencyResult> {
  const { env, req, reply, body, route, action, envelope } = input;
  const requestId = (req.id as string) ?? 'unknown';
  const key = readIdempotencyKey(req.headers as Record<string, unknown>);

  if (!key) {
    // No idempotency key — just run the action.
    const data = await action();
    const env200 = envelope(data, requestId, new Date().toISOString());
    reply.code(200).send(env200);
    return { replay: false, status: 200 };
  }

  const requestHash = hashRequest(body);
  const userId = req.auth?.userId;
  if (!userId) {
    // Auth preHandler did not run. Treat as 401.
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'authentication required' },
      requestId,
      timestamp: new Date().toISOString(),
    } satisfies ApiEnvelope<never>);
    return { replay: false, status: 401 };
  }

  const lookup = await lookupIdempotency(env, userId, route, key, requestHash);
  if (lookup.replay) {
    const env200 = lookup.body as ApiSuccessEnvelope<TData>;
    reply.code(lookup.status).send({ ...env200, idempotencyReplay: true });
    return { replay: true, status: lookup.status };
  }

  const data = await action();
  const env200 = envelope(data, requestId, new Date().toISOString());
  reply.code(200).send(env200);
  await recordIdempotency(env, userId, route, key, requestHash, 200, env200);
  return { replay: false, status: 200 };
}
