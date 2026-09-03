/**
 * KRODEX API — Phase 8 adapter tests.
 *
 * `callProvider` is the single seam between the provider transport
 * and the AI pipelines (classifier, assistant). It is responsible
 * for:
 *   1. Building the `AiRequest` (clamping temperature, attaching
 *      `jsonMode` and `maxOutputTokens`).
 *   2. Calling `provider.complete(request)`.
 *   3. Extracting a JSON object from the response text (handles
 *      pure JSON, fenced ```json blocks, and "first '{' to last '}'"
 *      extraction).
 *   4. Validating the parsed object against the supplied Zod schema.
 *   5. Mapping any failure into `AiOutputInvalidError` so the
 *      pipeline never has to handle provider-specific shapes.
 *
 * These tests use a fake `AiProvider` (no real HTTP) and assert
 * the parsed+validated data, the raw response, and the error
 * envelopes.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiOutputInvalidError } from '../../errors';
import type { AiMessage, AiProvider, AiRawResponse, AiRequest } from '../provider';
import { callProvider } from '../adapter';

const messages: readonly AiMessage[] = [{ role: 'user', content: 'hi' }];

const ok = (content: string, model = 'gpt-4o-mini'): AiRawResponse => ({
  content,
  model,
});

function makeProvider(script: AiRawResponse | (() => Promise<AiRawResponse>)): {
  provider: AiProvider;
  calls: AiRequest[];
} {
  const calls: AiRequest[] = [];
  const provider: AiProvider = {
    async complete(req: AiRequest): Promise<AiRawResponse> {
      calls.push(req);
      return typeof script === 'function' ? script() : script;
    },
  };
  return { provider, calls };
}

const PingSchema = z.object({
  answer: z.string().min(1),
  n: z.number().int().nonnegative(),
});

describe('callProvider', () => {
  it('returns parsed + validated data and the raw response on success', async () => {
    const { provider, calls } = makeProvider(ok('{"answer":"hi","n":3}'));
    const result = await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
    });
    expect(result.data).toEqual({ answer: 'hi', n: 3 });
    expect(result.raw.content).toBe('{"answer":"hi","n":3}');
    expect(calls).toHaveLength(1);
  });

  it('defaults temperature to 0.2 and jsonMode to true', async () => {
    const { provider, calls } = makeProvider(ok('{"answer":"x","n":0}'));
    await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
    });
    expect(calls[0]?.temperature).toBe(0.2);
    expect(calls[0]?.jsonMode).toBe(true);
  });

  it('honors a caller-supplied temperature and clamps it in the request', async () => {
    const { provider, calls } = makeProvider(ok('{"answer":"x","n":0}'));
    await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      jsonMode: false,
    });
    expect(calls[0]?.temperature).toBe(0.7);
    expect(calls[0]?.jsonMode).toBe(false);
  });

  it('passes maxOutputTokens through to the provider when > 0', async () => {
    const { provider, calls } = makeProvider(ok('{"answer":"x","n":0}'));
    await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
      maxOutputTokens: 256,
    });
    expect(calls[0]?.maxOutputTokens).toBe(256);
  });

  it('omits maxOutputTokens when it is 0 or negative', async () => {
    const { provider, calls } = makeProvider(ok('{"answer":"x","n":0}'));
    await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
      maxOutputTokens: 0,
    });
    expect(calls[0]?.maxOutputTokens).toBeUndefined();
  });

  it('throws synchronously on a caller-supplied temperature outside [0, 1]', async () => {
    const { provider } = makeProvider(ok('{"answer":"x","n":0}'));
    await expect(
      callProvider(provider, {
        messages,
        responseSchema: PingSchema,
        model: 'gpt-4o-mini',
        temperature: 1.5,
      }),
    ).rejects.toThrow(/temperature out of range/);
  });

  it('extracts a JSON object wrapped in a ```json fence', async () => {
    const text = 'Sure, here it is:\n```json\n{"answer":"hi","n":1}\n```\nThanks!';
    const { provider } = makeProvider(ok(text));
    const result = await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
    });
    expect(result.data).toEqual({ answer: 'hi', n: 1 });
  });

  it('extracts a JSON object from prose via first-{ to last-} fallback', async () => {
    const text = 'Here you go: {"answer":"hi","n":2} – hope that helps.';
    const { provider } = makeProvider(ok(text));
    const result = await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
    });
    expect(result.data).toEqual({ answer: 'hi', n: 2 });
  });

  it('throws AiOutputInvalidError when the response is not JSON at all', async () => {
    const { provider } = makeProvider(ok('Sorry, I cannot help with that.'));
    const err = await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputInvalidError);
    expect(err.context).toMatchObject({
      preview: 'Sorry, I cannot help with that.'.slice(0, 200),
    });
  });

  it('throws AiOutputInvalidError when JSON parses but fails schema', async () => {
    const { provider } = makeProvider(ok('{"answer":"hi","n":"not-a-number"}'));
    const err = await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputInvalidError);
    const issues = (err.context as { issues: Array<{ path: string; message: string }> })
      .issues;
    expect(issues.some((i) => i.path === 'n')).toBe(true);
  });

  it('throws AiOutputInvalidError when JSON has a wrong shape (missing field)', async () => {
    const { provider } = makeProvider(ok('{"answer":"hi"}'));
    const err = await callProvider(provider, {
      messages,
      responseSchema: PingSchema,
      model: 'gpt-4o-mini',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputInvalidError);
  });

  it('previews only the first 200 chars of the bad value', async () => {
    const long = '{"answer":"' + 'x'.repeat(500) + '","n":0}';
    const { provider } = makeProvider(ok(long));
    const err = await callProvider(provider, {
      messages,
      // Require n: -1, but we send n: 0; a successful parse will still
      // fail schema validation, hitting the preview path.
      responseSchema: PingSchema.extend({ n: z.literal(-1) }),
      model: 'gpt-4o-mini',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputInvalidError);
    const preview = (err.context as { preview: string }).preview;
    expect(preview.length).toBeLessThanOrEqual(200);
  });
});
