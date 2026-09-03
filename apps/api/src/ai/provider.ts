/**
 * KRODEX API — Phase 8 provider abstraction.
 *
 * The single seam between the AI assistance layer and the actual
 * LLM provider. The interface is intentionally minimal: a
 * structured request goes in, a structured response comes out, and
 * the provider is responsible for serializing to and from the
 * underlying API (OpenAI-compatible REST today; Anthropic,
 * Gemini, or Ollama later — swap the implementation, not the
 * domain code).
 *
 * Per Implementation Plan §334–342 and TRD §21 (Assistant
 * Architecture):
 *   - The provider does not see the prompt directly. The adapter
 *     (./adapter.ts) assembles the message payload and validates
 *     the response against a Zod schema before the provider call
 *     returns. The provider is just a transport.
 *   - Provider errors are classified into one of:
 *       timeout / network failure / 5xx / 4xx
 *     and surface as `DependencyUnavailableError` (transient,
 *     503) or `AiOutputInvalidError` (response shape did not
 *     validate, 422). The assistant service decides how to
 *     present each.
 *   - No mutation ever originates here. The provider is read-only.
 *     Every write the AI triggers goes through the relevant
 *     domain service (PlannerTaskService, ReviewService) only
 *     after the student confirms a proposal.
 */

import type { z } from 'zod';

/**
 * A single role-tagged message in the conversation. The provider
 * is responsible for serializing these into whatever shape the
 * underlying API expects (chat-completion `messages`, Claude
 * `messages`, etc.).
 */
export type AiMessageRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

/**
 * The structured request the adapter hands the provider.
 *
 * `model` is the literal model id the provider should call. The
 * caller (assistant service) picks `aiModelDefault` for simple
 * Q&A, `aiModelReasoning` for the classification pipeline.
 *
 * `temperature` is clamped to [0, 1]. The provider must not
 * accept values outside this range — the assistant is a factual
 * grounding tool, not a creative writer.
 */
export interface AiRequest {
  model: string;
  messages: readonly AiMessage[];
  temperature: number;
  /**
   * Optional hard response token cap. The provider MUST cap the
   * response at this many tokens; if it cannot honor the cap
   * (e.g. the underlying API does not support it), it MUST
   * surface that as a `DependencyUnavailableError` rather than
   * silently returning a longer response.
   */
  maxOutputTokens?: number;
  /**
   * Optional JSON-mode hint. The adapter already validates the
   * response with Zod; this flag tells the provider to ask the
   * model for a JSON object in the response body so the adapter
   * can parse it without a separate extraction step.
   */
  jsonMode?: boolean;
}

/**
 * The raw provider response, before adapter validation. The
 * `AiContentBlock` is intentionally string-only at this layer —
 * the adapter splits it into a structured JSON object and
 * validates it.
 */
export interface AiRawResponse {
  /**
   * The model's textual completion. For a JSON-mode call this is
   * a JSON object serialized as text; the adapter parses it.
   */
  content: string;
  /** Echoed model id (used for observability + billing reconciliation). */
  model: string;
  /** Optional usage block; surfaced to logs but not to clients. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * A validated, parsed provider response. The adapter returns
 * this after Zod-parsing the raw response. The shape is whatever
 * the calling pipeline asked for — for the classification
 * pipeline it is `ClassificationSuggestionT`; for the assistant
 * pipeline it is `AssistantResponseT`.
 */
export type AiParsedResponse<T> = {
  schema: z.ZodType<T>;
  data: T;
};

/**
 * The provider interface. There is exactly one implementation in
 * Phase 8 (OpenAI-compatible REST) and a fake implementation in
 * tests. To switch providers, write a new implementation of this
 * interface and re-wire the singleton in `provider.default.ts`.
 *
 * The provider is the ONLY place that knows the URL and the
 * auth header. The rest of the AI code never touches them.
 */
export interface AiProvider {
  /**
   * Issue a single completion request. Implementations must:
   *   - Honor the timeout passed at construction time.
   *   - Surface transport errors (timeout, DNS, 5xx) as
   *     `DependencyUnavailableError`.
   *   - Surface 4xx errors (auth, quota, model not found) as
   *     `DependencyUnavailableError` too — the assistant
   *     fallback is the same either way, and the cause is
   *     recorded in `error.context` for ops.
   *   - Never throw raw `Error`; always go through an `AppError`
   *     subclass so the Fastify error handler can map it.
   */
  complete(request: AiRequest): Promise<AiRawResponse>;
}

/**
 * A single call to `complete` may legitimately be retried when
 * the failure is transient (timeout, 5xx, network reset). The
 * `aiMaxRetries` env var bounds the number of retries (default
 * 2, so 3 attempts in total). 4xx errors are NOT retried.
 */
export const RETRYABLE_HTTP_STATUSES = new Set<number>([408, 425, 429, 500, 502, 503, 504]);
