/**
 * KRODEX — cursor pagination types.
 *
 * Per TRD §5.5, list endpoints use opaque cursor pagination rather
 * than offset/limit. The cursor is a base64url-encoded JSON object
 * the client cannot construct; only the server can mint and decode.
 *
 * Cursors are intentionally opaque. Do not parse them on the client.
 */

export interface CursorPage<T> {
  items: readonly T[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
  /** Total is intentionally omitted (cheap queries only). */
}

export interface CursorPaginationInput {
  /** Opaque cursor returned by a previous call, or null/undefined for the first page. */
  cursor?: string | null;
  /** Page size, capped server-side. */
  limit?: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
