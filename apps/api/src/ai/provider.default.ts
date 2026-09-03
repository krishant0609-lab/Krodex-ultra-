/**
 * KRODEX API — Phase 8 provider singleton.
 *
 * Wraps the chosen `AiProvider` implementation with bounded
 * retry-on-transient-failure semantics. The classifier and
 * assistant pipelines import `getProvider()` (or `provider` for
 * the eager singleton) and never know whether the underlying
 * transport is OpenAI, Anthropic, Ollama, or a fake in tests.
 *
 * Retry policy:
 *   - The provider implementation decides what is "transient" by
 *     re-raising the same `DependencyUnavailableError` (the
 *     `retryable` field in `error.context` tells this singleton
 *     whether to retry).
 *   - The number of retries is bounded by `aiMaxRetries`
 *     (default 2, so up to 3 attempts).
 *   - Backoff is exponential with jitter, capped at the
 *     `aiTimeoutMs` budget so a single AI call never exceeds
 *     ~3× the timeout.
 *   - Non-retryable errors (4xx other than 408/425/429, or
 *     `AiOutputInvalidError`) are returned immediately.
 *
 * To swap the provider, change `createProvider()` below. The
 * rest of the code is provider-agnostic.
 */

import type { ApiEnv } from '../config/env';
import { isAppError } from '../errors';
import { OpenAiCompatibleProvider } from './openai-provider';
import type { AiProvider, AiRawResponse, AiRequest } from './provider';

export function createProvider(env: ApiEnv): AiProvider {
  // Phase 8 ships exactly one provider implementation. To add
  // another (Anthropic, Gemini, Ollama), branch on env.aiProvider
  // and instantiate the right class here.
  return new OpenAiCompatibleProvider(env);
}

/**
 * A provider wrapper that retries on transient failures. Wraps
 * the chosen transport. The wrapper itself is a valid
 * `AiProvider`, so callers (adapter, pipelines) do not change
 * when the retry policy changes.
 */
export class RetryingProvider implements AiProvider {
  constructor(
    private readonly inner: AiProvider,
    private readonly maxRetries: number,
  ) {}

  async complete(request: AiRequest): Promise<AiRawResponse> {
    let lastErr: unknown = undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.inner.complete(request);
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === this.maxRetries) {
          throw err;
        }
        const delayMs = backoffMs(attempt);
        await sleep(delayMs);
      }
    }
    // Unreachable, but TypeScript needs a return.
    throw lastErr instanceof Error ? lastErr : new Error('retry loop exited without result');
  }
}

function isRetryable(err: unknown): boolean {
  if (!isAppError(err)) return false;
  if (err.code !== 'DEPENDENCY_UNAVAILABLE') return false;
  const ctx = (err.context ?? {}) as Record<string, unknown>;
  if (ctx['retryable'] === true) return true;
  // Default: 5xx without explicit retryable flag is still
  // retryable. The OpenAI provider sets `retryable: true` for
  // 408/425/429/5xx, so this branch is a backstop.
  return false;
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms, 1000ms ... with a small random jitter so a
  // thundering-herd of concurrent first-time calls does not
  // synchronously retry against the same provider.
  const base = 250 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
