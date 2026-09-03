/**
 * KRODEX API — Phase 8 OpenAI-compatible provider.
 *
 * The default `AiProvider` implementation. Speaks the
 * OpenAI chat-completion REST contract, which is also the de
 * facto industry standard (Together, Anyscale, OpenRouter, vLLM,
 * Ollama with the OpenAI compatibility shim, etc.). To switch
 * providers, the user sets `AI_PROVIDER_URL` to the new base URL
 * and the rest of the code is unchanged.
 *
 * Contract specifics:
 *   - Endpoint: `${AI_PROVIDER_URL}/chat/completions` (the
 *     `v1` prefix is the default base).
 *   - Auth: `Authorization: Bearer ${AI_API_KEY}`.
 *   - Body shape: `{ model, messages, temperature,
 *     max_tokens?, response_format?: { type: 'json_object' } }`.
 *   - Response shape: `{ choices: [{ message: { content } }],
 *     model, usage?: { prompt_tokens, completion_tokens } }`.
 *
 * Error mapping:
 *   - 401 / 403 / 404 / 422: `DependencyUnavailableError` (the
 *     assistant fallback is "AI unavailable" regardless of
 *     whether the cause is a misconfigured key or a model the
 *     provider does not know).
 *   - 408 / 425 / 429 / 5xx: `DependencyUnavailableError`
 *     (retryable; the singleton in `provider.default.ts`
 *     handles retries).
 *   - Body that does not match the expected shape:
 *     `AiOutputInvalidError`.
 *   - Transport failure (timeout, DNS, socket reset):
 *     `DependencyUnavailableError`.
 */

import type { ApiEnv } from '../config/env';
import { AiOutputInvalidError, DependencyUnavailableError } from '../errors';
import { RETRYABLE_HTTP_STATUSES, type AiMessage, type AiProvider, type AiRawResponse, type AiRequest } from './provider';

interface OpenAIRequestBody {
  model: string;
  messages: AiMessage[];
  temperature: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

interface OpenAIResponseBody {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly env: ApiEnv) {}

  async complete(request: AiRequest): Promise<AiRawResponse> {
    if (!this.env.aiApiKey) {
      // No key is configured. Treat this as "AI unavailable" rather
      // than a hard error so the assistant fallback surface (manual
      // classification form, deterministic next-step suggestions)
      // can render cleanly.
      throw new DependencyUnavailableError('AI provider not configured', {
        context: { provider: this.env.aiProvider, hasApiKey: false },
      });
    }
    if (request.temperature < 0 || request.temperature > 1) {
      // Defensive: the adapter never sends a temperature outside
      // [0, 1], but we double-check here so a misbehaving caller
      // does not silently get a different model behavior.
      throw new Error(`temperature out of range: ${request.temperature}`);
    }

    const body: OpenAIRequestBody = {
      model: request.model,
      messages: [...request.messages],
      temperature: request.temperature,
    };
    if (typeof request.maxOutputTokens === 'number' && request.maxOutputTokens > 0) {
      body.max_tokens = request.maxOutputTokens;
    }
    if (request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const url = joinUrl(this.env.aiProviderUrl, '/chat/completions');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.aiTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.aiApiKey}`,
          'User-Agent': 'krodex-api/phase8',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // Timeout, DNS, socket reset — all "AI unavailable".
      throw new DependencyUnavailableError('AI provider transport failure', {
        cause: err,
        context: {
          url: this.env.aiProviderUrl,
          model: request.model,
          timeoutMs: this.env.aiTimeoutMs,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // The provider returned a non-2xx. Body is informative for
      // ops but not for the client. We map both 4xx and 5xx to
      // DependencyUnavailableError; the route handler decides how
      // to render the fallback.
      let providerMessage: string | undefined;
      try {
        const errBody = (await response.json()) as { error?: { message?: string } };
        providerMessage = errBody?.error?.message;
      } catch {
        // Body was not JSON; fall through with no message.
      }
      const isRetryable = RETRYABLE_HTTP_STATUSES.has(response.status);
      throw new DependencyUnavailableError(
        `AI provider responded ${response.status}`,
        {
          context: {
            status: response.status,
            model: request.model,
            retryable: isRetryable,
            providerMessage: providerMessage ?? null,
          },
        },
      );
    }

    let parsed: OpenAIResponseBody;
    try {
      parsed = (await response.json()) as OpenAIResponseBody;
    } catch (err) {
      throw new AiOutputInvalidError('AI provider returned non-JSON body', {
        cause: err,
        context: { url: this.env.aiProviderUrl, model: request.model },
      });
    }
    const first = parsed.choices?.[0];
    const content = first?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new AiOutputInvalidError('AI provider response missing message.content', {
        context: { model: parsed.model ?? request.model, finishReason: first?.finish_reason ?? null },
      });
    }
    return {
      content,
      model: parsed.model ?? request.model,
      usage: parsed.usage
        ? {
            inputTokens: parsed.usage.prompt_tokens,
            outputTokens: parsed.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/u, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}
