/**
 * KRODEX API — reusable zod primitives.
 *
 * Centralizes every constraint that shows up in more than one
 * schema: ids, timestamps, pagination, enum string-unions.
 *
 * All zod schemas in this module are READ-ONLY inputs (request
 * bodies, query strings, route params). They never describe
 * persisted data; that lives in packages/shared/src/db/types.ts.
 */

import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@krodex/shared';

/** UUID v4 (or any 8-4-4-4-12 hex). We do not enforce variant bits. */
export const Uuid = z
  .string()
  .uuid({ message: 'must be a uuid' })
  .describe('UUID v4 string');

/** Optional UUID that defaults to null/undefined. */
export const OptionalUuid = Uuid.nullable().optional();

/** ISO 8601 timestamp (e.g. 2026-09-01T12:34:56.000Z). */
export const IsoTimestamp = z
  .string()
  .datetime({ message: 'must be an ISO 8601 timestamp' })
  .describe('ISO 8601 timestamp');

/** Optional ISO 8601 timestamp. */
export const OptionalIsoTimestamp = IsoTimestamp.nullable().optional();

/** ISO 8601 date (YYYY-MM-DD). */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
  .describe('ISO 8601 date (YYYY-MM-DD)');

/** Non-empty trimmed string with a configurable max length. */
export function nonEmptyString(max: number, label = 'string'): z.ZodString {
  return z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(max, `${label} cannot exceed ${max} characters`);
}

/** Optional string that, when present, is trimmed and bounded. */
export function optionalString(max: number): z.ZodOptional<z.ZodString> {
  return z
    .string()
    .trim()
    .max(max, `string cannot exceed ${max} characters`)
    .optional();
}

/** Cursor pagination input. `cursor` is opaque; `limit` is bounded. */
export const CursorPagination = z.object({
  cursor: z.string().min(1).max(2048).nullable().optional(),
  // Note: not chained with `.optional()`. Zod's `.default()` only
  // fires when the input is `undefined`; adding `.optional()` to
  // the same chain makes the missing-key path also return
  // `undefined`, defeating the default. `limit` therefore is
  // always a number after parse.
  limit: z
    .number()
    .int()
    .min(1, 'limit must be >= 1')
    .max(MAX_PAGE_SIZE, `limit cannot exceed ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
});
export type CursorPaginationParsed = z.infer<typeof CursorPagination>;

/**
 * Decode an opaque cursor into the server-side shape. Cursors are
 * base64url-encoded JSON. We trust the schema, not the contents.
 */
export interface CursorPayload {
  /** Opaque server-defined offset, e.g. row id + sort key. */
  readonly after: string;
  /** Sort direction the client was browsing. */
  readonly dir?: 'asc' | 'desc';
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const pad = cursor.length % 4 === 0 ? '' : '='.repeat(4 - (cursor.length % 4));
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const raw = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.after !== 'string' || obj.after.length === 0) return null;
    if (obj.dir !== undefined && obj.dir !== 'asc' && obj.dir !== 'desc') return null;
    return { after: obj.after, ...(obj.dir ? { dir: obj.dir } : {}) };
  } catch {
    return null;
  }
}
