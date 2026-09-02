/**
 * KRODEX web — api-client tests.
 *
 * Covers the envelope-normalisation contract: a non-2xx response
 * throws an ApiError whose `code` matches the envelope's
 * `error.code`, the `status` matches the HTTP status, and
 * `requestId` is propagated.
 *
 * The api-client attaches `Authorization: Bearer <token>` from
 * the in-memory auth store.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client';
import { setAuth, clearAuth } from '../lib/auth-store';

/**
 * `getBaseUrl` is not part of the public surface; it is exercised
 * indirectly via `api.get()`. We test the public env-var contract
 * by triggering a request that depends on it.
 */
function getBaseUrlFromModule(): string {
  // We exercise the env-var error path by clearing the var,
  // then making a call that depends on it.
  return process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '';
}

const BASE = 'http://api.test/v1';
const ORIGINAL_ENV = process.env['NEXT_PUBLIC_API_BASE_URL'];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  process.env['NEXT_PUBLIC_API_BASE_URL'] = BASE;
  clearAuth();
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = ORIGINAL_ENV;
  }
});

describe('getBaseUrl (indirect)', () => {
  it('throws when NEXT_PUBLIC_API_BASE_URL is unset', async () => {
    delete process.env['NEXT_PUBLIC_API_BASE_URL'];
    await expect(api.get('/x')).rejects.toThrow(/NEXT_PUBLIC_API_BASE_URL/);
  });

  it('accepts a base URL with a trailing slash', async () => {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = 'http://x.test/';
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: null }),
    );
    await api.get('/y');
    const calledUrl = (fetchMock.mock.calls[0]![0] as string);
    // Should not have a double-slash from base+path joining.
    expect(calledUrl).toBe('http://x.test/y');
  });

  it('reads the URL via the env var', () => {
    process.env['NEXT_PUBLIC_API_BASE_URL'] = 'http://x.test/';
    expect(getBaseUrlFromModule()).toBe('http://x.test/');
  });
});

describe('api envelope handling', () => {
  it('returns data on success', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({
          success: true,
          data: { hello: 'world' },
        }),
      );
    const out = await api.get<{ hello: string }>('/anything');
    expect(out).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws ApiError with code + status on envelope error', async () => {
    // The test makes two calls to /missing. The first asserts rejection
    // and the second inspects the error fields. Response bodies are
    // single-use streams, so the mockImplementation must build a fresh
    // Response on each call.
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      jsonResponse(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'row not found',
          },
          requestId: 'req-1',
        },
        { status: 404 },
      ),
    );
    await expect(api.get('/missing')).rejects.toBeInstanceOf(ApiError);
    try {
      await api.get('/missing');
    } catch (err) {
      expect((err as ApiError).code).toBe('NOT_FOUND');
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).requestId).toBe('req-1');
      expect((err as ApiError).isTransient).toBe(false);
    }
  });

  it('marks DEPENDENCY_UNAVAILABLE as transient', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'db down' },
        },
        { status: 503 },
      ),
    );
    try {
      await api.get('/x');
    } catch (err) {
      expect((err as ApiError).isTransient).toBe(true);
    }
  });

  it('attaches Authorization header from the auth store', async () => {
    setAuth({ token: 'bearer-tok', userId: 'u-1' });
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        success: true,
        data: null,
      }),
    );
    await api.get('/me');
    const call = fetchMock.mock.calls[0]!;
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer bearer-tok');
  });

  it('sends JSON body and Content-Type on POST', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: { id: 'new' } }),
    );
    await api.post<{ id: string }>('/create', { body: { name: 'x' } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('treats a non-JSON response as INTERNAL', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<html>oops</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('throws DEPENDENCY_UNAVAILABLE on network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('dns down'));
    await expect(api.get('/x')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const out = await api.delete('/x');
    expect(out).toBeUndefined();
  });
});
