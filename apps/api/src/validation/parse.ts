/**
 * KRODEX API — Fastify-friendly parse helpers.
 *
 * `parseBody`, `parseQuery`, and `parseParams` wrap a zod schema
 * with the same error reporting: a `ValidationError` is thrown with
 * `fields: [{ path, message }, ...]`. The Fastify error handler
 * already turns `ZodError` into that exact envelope, but doing it
 * here keeps the shape stable when the route calls the helper
 * outside a normal request body (e.g. parsing query strings).
 *
 * Each helper returns the parsed value with full TS inference — the
 * route handler never re-asserts the type.
 */

import type { z, ZodTypeAny } from 'zod';
import { ZodError } from 'zod';
import { ValidationError } from '../errors';

export interface ParseResult<T> {
  ok: true;
  data: T;
}

function fromZodError<T>(err: ZodError, fallback: T): never {
  throw new ValidationError('request failed validation', {
    fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    context: { parsed: fallback as unknown as Record<string, unknown> },
  });
}

export function parseBody<S extends ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  try {
    return schema.parse(raw) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) fromZodError(err, raw);
    throw err;
  }
}

export function parseQuery<S extends ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  try {
    return schema.parse(raw ?? {}) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) fromZodError(err, raw);
    throw err;
  }
}

export function parseParams<S extends ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  try {
    return schema.parse(raw ?? {}) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) fromZodError(err, raw);
    throw err;
  }
}
