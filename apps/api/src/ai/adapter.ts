/**
 * KRODEX API — Phase 8 provider adapter.
 *
 * Sits between the provider transport (./openai-provider.ts) and
 * the AI pipelines (./classifier.ts, ./assistant.ts). Its job is
 * to:
 *   1. Build the message list (system prompt + user payload) the
 *      model will see.
 *   2. Call the provider with a model id + temperature + the
 *      optional JSON-mode flag.
 *   3. Parse the raw response text as JSON.
 *   4. Validate the parsed object against a Zod schema supplied
 *      by the caller. Any validation failure is mapped to
 *      `AiOutputInvalidError`.
 *   5. Return the validated object plus the raw usage block for
 *      observability.
 *
 * Per Implementation Plan §334–342 the adapter is the only place
 * that calls the provider directly. The pipelines (classifier,
 * assistant) only see the parsed+validated object.
 *
 * The adapter does not retry. Retries are the provider
 * singleton's responsibility (one level up — see
 * ./provider.default.ts). Keeping the adapter single-shot makes
 * the unit tests trivial.
 */

import type { z } from 'zod';
import { AiOutputInvalidError } from '../errors';
import type { AiMessage, AiProvider, AiRawResponse, AiRequest } from './provider';

export interface AdapterCallInput<TSchema extends z.ZodTypeAny> {
  /** Caller-supplied messages. The adapter prepends the system prompt if absent. */
  messages: readonly AiMessage[];
  /** Zod schema the parsed response must validate against. */
  responseSchema: TSchema;
  /** Model id to send to the provider. */
  model: string;
  /** Temperature in [0, 1]. Default 0.2 — the assistant is a factual tool, not a writer. */
  temperature?: number;
  /**
   * When true, the adapter asks the provider for JSON-mode output.
   * The caller MUST be sure the model supports it (every
   * OpenAI-compatible model in Phase 8 does, by policy).
   */
  jsonMode?: boolean;
  /** Optional hard response token cap. */
  maxOutputTokens?: number;
}

export interface AdapterCallResult<T> {
  /** The Zod-validated response. */
  data: T;
  /** The raw provider response, for logging. */
  raw: AiRawResponse;
}

const DEFAULT_TEMPERATURE = 0.2;

/**
 * Extract the first JSON object from a model response. The
 * model occasionally wraps its JSON in a fence (```json ... ```)
 * or prefixes it with prose ("Here is the JSON: ..."). The
 * adapter tolerates both by locating the first '{' and the
 * matching '}' and parsing the slice.
 */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Fast path: pure JSON.
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return JSON.parse(trimmed);
  }
  // Fenced JSON block.
  const fence = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/u);
  if (fence && fence[1]) {
    return JSON.parse(fence[1]);
  }
  // First '{' to last '}'.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) {
    throw new SyntaxError('no JSON object found in response');
  }
  return JSON.parse(trimmed.slice(first, last + 1));
}

export async function callProvider<TSchema extends z.ZodTypeAny>(
  provider: AiProvider,
  input: AdapterCallInput<TSchema>,
): Promise<AdapterCallResult<z.infer<TSchema>>> {
  const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
  if (temperature < 0 || temperature > 1) {
    throw new Error(`adapter temperature out of range: ${temperature}`);
  }
  const request: AiRequest = {
    model: input.model,
    messages: input.messages,
    temperature,
    jsonMode: input.jsonMode ?? true,
  };
  if (typeof input.maxOutputTokens === 'number' && input.maxOutputTokens > 0) {
    request.maxOutputTokens = input.maxOutputTokens;
  }
  const raw: AiRawResponse = await provider.complete(request);

  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw.content);
  } catch (err) {
    throw new AiOutputInvalidError('AI provider response was not valid JSON', {
      cause: err,
      context: {
        model: raw.model,
        // Surface the first 200 chars so ops can diagnose without
        // dumping a full response into logs.
        preview: raw.content.slice(0, 200),
        previewLength: raw.content.length,
      },
    });
  }

  const validated = input.responseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AiOutputInvalidError('AI provider response failed schema validation', {
      context: {
        model: raw.model,
        issues: validated.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
        // Surface the first 200 chars of the parsed value so ops
        // can see what shape the model actually returned.
        preview: JSON.stringify(parsed).slice(0, 200),
      },
    });
  }
  return { data: validated.data, raw };
}
