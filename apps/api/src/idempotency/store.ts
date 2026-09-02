/**
 * KRODEX API — idempotency.
 *
 * Per TRD §5.7, mutating endpoints may be retried by the client
 * if it supplies an `Idempotency-Key` header. The server stores
 * (user_id, route, key) -> first response. A retry within the
 * 24h window returns the stored response with `idempotencyReplay: true`.
 *
 * A retry with the same key but a different request body is
 * rejected (the client must rotate the key).
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnv } from '../config/env';
import { ConflictError, IdempotencyKeyReusedError } from '../errors';
import { getServiceClient } from '../db/supabase';

export interface IdempotencyHit {
  status: number;
  body: unknown;
  replay: true;
}

export interface IdempotencyMiss {
  replay: false;
}

export type IdempotencyLookup = IdempotencyHit | IdempotencyMiss;

const HEADER_NAME = 'idempotency-key';

export const IDEMPOTENCY_HEADER = HEADER_NAME;

/** Canonical JSON for hashing. Stable key ordering. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
      .join(',') +
    '}'
  );
}

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

/** Read the Idempotency-Key header (case-insensitive). */
export function readIdempotencyKey(headers: Readonly<Record<string, unknown>>): string | null {
  const v = headers[HEADER_NAME] ?? headers[HEADER_NAME.toLowerCase()];
  if (typeof v === 'string' && v.length > 0 && v.length <= 200) return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export interface RecordResponseInput {
  userId: string;
  route: string;
  key: string;
  requestHash: string;
  status: number;
  body: unknown;
}

/**
 * Look up a stored response. Returns either a hit (replay) or a
 * miss. If the key is present but the request body hash does not
 * match, throws IdempotencyKeyReusedError.
 */
export async function lookupIdempotency(
  env: ApiEnv,
  userId: string,
  route: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyLookup> {
  const service = getServiceClient(env);
  const { data, error } = await service
    .from('idempotency_keys')
    .select('request_hash, response_status, response_body')
    .eq('user_id', userId)
    .eq('route', route)
    .eq('idempotency_key', key)
    .maybeSingle();
  if (error) {
    // Treat read errors as "miss" so the request continues; the
    // record step will fail later if needed.
    return { replay: false };
  }
  if (!data) return { replay: false };
  if (data.request_hash !== requestHash) {
    throw new IdempotencyKeyReusedError(
      'Idempotency-Key reused with a different request body',
      { context: { route } },
    );
  }
  return {
    status: data.response_status as number,
    body: data.response_body,
    replay: true,
  };
}

/** Persist a successful response. Caller must have completed the action. */
export async function recordIdempotency(
  env: ApiEnv,
  userId: string,
  route: string,
  key: string,
  requestHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  const service = getServiceClient(env);
  const { error } = await service.from('idempotency_keys').insert({
    user_id: userId,
    route,
    idempotency_key: key,
    request_hash: requestHash,
    response_status: status,
    response_body: body as Record<string, unknown>,
  });
  if (error) {
    // If the row already exists (race between two retries), the
    // second insert will fail with a unique violation. We treat
    // that as benign because the loser of the race will look up
    // and get the winner's stored response on the next call.
    if (!/duplicate key|unique constraint/i.test(error.message ?? '')) {
      throw new ConflictError('failed to record idempotency key', {
        context: { message: error.message },
      });
    }
  }
}

/**
 * Convenience for services: store under the service-role client
 * so it can survive RLS. The caller is responsible for hashing
 * the body and parsing the header.
 */
export interface IdempotencyContext {
  env: ApiEnv;
  userId: string;
  route: string;
  key: string;
  requestHash: string;
  service?: SupabaseClient;
}
