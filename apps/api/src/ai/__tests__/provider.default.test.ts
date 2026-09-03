/**
 * KRODEX API — Phase 8 RetryingProvider tests.
 *
 * The retry policy (per `provider.default.ts`):
 *   - Up to `maxRetries` retries on a `DependencyUnavailableError`
 *     whose `context.retryable === true`.
 *   - No retry on `AiOutputInvalidError` or on any other error.
 *   - Backoff uses `250 * 2^attempt` ms + small jitter, but
 *     vitest fake timers are NOT used here — we assert on call
 *     counts, not real wall-clock sleeps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiOutputInvalidError,
  DependencyUnavailableError,
} from '../../errors';
import type {
  AiMessage,
  AiProvider,
  AiRawResponse,
  AiRequest,
} from '../provider';
import { RetryingProvider } from '../provider.default';

const messages: readonly AiMessage[] = [
  { role: 'system', content: 'you are a tool' },
  { role: 'user', content: 'hi' },
];
const request: AiRequest = {
  model: 'gpt-4o-mini',
  messages,
  temperature: 0.2,
};

function makeInner(
  responses: Array<() => Promise<AiRawResponse>>,
): AiProvider & { calls: number } {
  const fake = {
    calls: 0,
    async complete(): Promise<AiRawResponse> {
      fake.calls += 1;
      const next = responses.shift();
      if (!next) throw new Error('inner: no more scripted responses');
      return next();
    },
  };
  return fake;
}

const ok = (content: string): AiRawResponse => ({ content, model: 'gpt-4o-mini' });

beforeEach(() => {
  // Don't actually sleep — the test only cares about call counts.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: unknown,
    _ms?: number,
    ..._args: unknown[]
  ) => {
    if (typeof handler === 'function') {
      (handler as (...a: unknown[]) => void)();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RetryingProvider', () => {
  it('returns immediately on success without retrying', async () => {
    const inner = makeInner([async () => ok('hello')]);
    const provider = new RetryingProvider(inner, 2);
    const result = await provider.complete(request);
    expect(result.content).toBe('hello');
    expect(inner.calls).toBe(1);
  });

  it('retries on retryable DependencyUnavailableError and then succeeds', async () => {
    const retryable = new DependencyUnavailableError('boom', {
      context: { retryable: true },
    });
    const inner = makeInner([
      async () => {
        throw retryable;
      },
      async () => ok('ok'),
    ]);
    const provider = new RetryingProvider(inner, 2);
    const result = await provider.complete(request);
    expect(result.content).toBe('ok');
    expect(inner.calls).toBe(2);
  });

  it('retries up to maxRetries and then throws the last error', async () => {
    const retryable = new DependencyUnavailableError('still down', {
      context: { retryable: true },
    });
    const inner = makeInner([
      async () => {
        throw retryable;
      },
      async () => {
        throw retryable;
      },
      async () => {
        throw retryable;
      },
    ]);
    const provider = new RetryingProvider(inner, 2);
    await expect(provider.complete(request)).rejects.toBe(retryable);
    // 1 initial + 2 retries = 3 calls
    expect(inner.calls).toBe(3);
  });

  it('does NOT retry on non-retryable DependencyUnavailableError', async () => {
    const nonRetryable = new DependencyUnavailableError('bad request', {
      context: { retryable: false },
    });
    const inner = makeInner([
      async () => {
        throw nonRetryable;
      },
    ]);
    const provider = new RetryingProvider(inner, 2);
    await expect(provider.complete(request)).rejects.toBe(nonRetryable);
    expect(inner.calls).toBe(1);
  });

  it('does NOT retry on AiOutputInvalidError', async () => {
    const invalid = new AiOutputInvalidError('bad shape');
    const inner = makeInner([
      async () => {
        throw invalid;
      },
    ]);
    const provider = new RetryingProvider(inner, 2);
    await expect(provider.complete(request)).rejects.toBe(invalid);
    expect(inner.calls).toBe(1);
  });

  it('does NOT retry on a plain Error', async () => {
    const err = new Error('kaboom');
    const inner = makeInner([
      async () => {
        throw err;
      },
    ]);
    const provider = new RetryingProvider(inner, 2);
    await expect(provider.complete(request)).rejects.toBe(err);
    expect(inner.calls).toBe(1);
  });

  it('with maxRetries=0 never retries', async () => {
    const retryable = new DependencyUnavailableError('boom', {
      context: { retryable: true },
    });
    const inner = makeInner([
      async () => {
        throw retryable;
      },
    ]);
    const provider = new RetryingProvider(inner, 0);
    await expect(provider.complete(request)).rejects.toBe(retryable);
    expect(inner.calls).toBe(1);
  });
});
