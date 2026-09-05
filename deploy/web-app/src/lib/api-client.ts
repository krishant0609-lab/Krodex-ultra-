/**
 * KRODEX web — typed API client.
 *
 * Wraps `fetch` with:
 *  - the `Authorization: Bearer <token>` header from the in-memory auth store
 *  - the KRODEX envelope contract (`ApiSuccessEnvelope<T>` / `ApiErrorEnvelope`)
 *  - an `ApiError` class carrying `code: ApiErrorCode` for branchable UI
 *  - cursor-paginated `getPage()` for `CursorPage<T>` endpoints
 *  - explicit handling of 401 (caller should clear token + redirect)
 *  - explicit handling of 503/422 dependency-unavailable
 *
 * Why this layer exists:
 *  - Every page should treat the API as a typed function call, not a fetch
 *    that returns a `Response` blob.
 *  - Centralising envelope parsing guarantees the same shape across
 *    11 route modules and prevents accidental raw-response leaks.
 *  - The `code: ApiErrorCode` discriminator drives UI state machines
 *    (error vs partial vs empty) per Engineering Support §24.
 *
 * Class A: this is a deterministic derivation of the API contract
 * (Fastify envelope + Zod schemas) already established in Phase 1.
 */

import type {
  ApiEnvelope,
  ApiErrorCode,
  ApiErrorEnvelope,
  ApiSuccessEnvelope,
  CursorPage,
} from '@krodex/shared';

import { getToken } from './auth-store';

/** Base URL for the KRODEX API. Set per environment. */
function getBaseUrl(): string {
  const url = process.env['NEXT_PUBLIC_API_BASE_URL'];
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_API_BASE_URL is not set. Configure it in apps/web/.env.local.',
    );
  }
  return url.replace(/\/+$/, '');
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: ReadonlyArray<{ path: string; message: string }> | undefined;
  readonly context: Readonly<Record<string, unknown>> | undefined;
  readonly requestId: string | undefined;
  /** True for transient infra failures; UI may offer retry. */
  readonly isTransient: boolean;

  constructor(args: {
    code: ApiErrorCode;
    status: number;
    message: string;
    fields?: ApiErrorEnvelope['error']['fields'];
    context?: ApiErrorEnvelope['error']['context'];
    requestId?: string;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.code = args.code;
    this.status = args.status;
    this.fields = args.fields;
    this.context = args.context;
    this.requestId = args.requestId;
    this.isTransient =
      args.code === 'DEPENDENCY_UNAVAILABLE' || args.status >= 500;
  }
}

interface RequestOptions {
  /** Query params. Values are coerced to string. */
  query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  /** JSON body. */
  body?: unknown;
  /** Idempotency-Key header (mutations only). */
  idempotencyKey?: string;
  /** AbortSignal for fetch. */
  signal?: AbortSignal;
  /** Override the bearer token. Defaults to auth store. */
  token?: string | null;
}

function buildUrl(
  base: string,
  path: string,
  query: RequestOptions['query'],
): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const base = getBaseUrl();
  const url = buildUrl(base, path, options.query);
  const token = options.token !== undefined ? options.token : getToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
      signal: options.signal,
      // Always revalidate; TanStack Query handles caching.
      cache: 'no-store',
    });
  } catch (err) {
    // Network failure / DNS / abort.
    throw new ApiError({
      code: 'DEPENDENCY_UNAVAILABLE',
      status: 0,
      message: err instanceof Error ? err.message : 'Network error',
    });
  }

  // Fastify returns 204 for some endpoints; honor that.
  if (response.status === 204) {
    return undefined as T;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError({
      code: 'INTERNAL',
      status: response.status,
      message: 'Response was not valid JSON',
    });
  }

  if (!isEnvelope(parsed)) {
    throw new ApiError({
      code: 'INTERNAL',
      status: response.status,
      message: 'Response did not match the KRODEX envelope',
    });
  }

  if (!parsed.success) {
    throw new ApiError({
      code: parsed.error.code,
      status: response.status,
      message: parsed.error.message,
      fields: parsed.error.fields,
      context: parsed.error.context,
      requestId: parsed.requestId,
    });
  }

  return (parsed as ApiSuccessEnvelope<T>).data;
}

function isEnvelope(v: unknown): v is ApiEnvelope<unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj['success'] === 'boolean';
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions) =>
    request<T>('POST', path, options),
  put: <T>(path: string, options?: RequestOptions) =>
    request<T>('PUT', path, options),
  patch: <T>(path: string, options?: RequestOptions) =>
    request<T>('PATCH', path, options),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('DELETE', path, options),

  /** Cursor-paginated GET. Returns the full CursorPage<T>. */
  getPage: <T>(
    path: string,
    options?: Omit<RequestOptions, 'body'>,
  ): Promise<CursorPage<T>> => request<CursorPage<T>>('GET', path, options),
};
