/**
 * KRODEX API — Phase 8 OpenAI-compatible provider tests.
 *
 * Covers the error-mapping contract documented in
 * `apps/api/src/ai/openai-provider.ts`:
 *   - missing API key → DependencyUnavailableError
 *   - transport failure (timeout, DNS, abort) → DependencyUnavailableError
 *   - 5xx → DependencyUnavailableError (retryable: true)
 *   - 408/425/429 → DependencyUnavailableError (retryable: true)
 *   - 401/403/404/422 → DependencyUnavailableError (retryable: false)
 *   - non-JSON body → AiOutputInvalidError
 *   - missing choices[0].message.content → AiOutputInvalidError
 *   - successful response shape → AiRawResponse
 *
 * The provider is constructed against a fake `ApiEnv`. `global.fetch`
 * is stubbed per test via vi.spyOn so no real network is required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiEnv } from '../../config/env';
import {
  AiOutputInvalidError,
  DependencyUnavailableError,
  isAppError,
} from '../../errors';
import { OpenAiCompatibleProvider } from '../openai-provider';

function makeEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  const base: ApiEnv = {
    nodeEnv: 'test',
    logLevel: 'silent',
    apiPort: 3001,
    apiHost: '127.0.0.1',
    webOrigin: 'http://localhost:3000',
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceRoleKey: '',
    supabaseDbUrl: '',
    hasSupabase: false,
    hasServiceRole: false,
    authJwtSecret: 'test',
    authJwtTtlSeconds: 3600,
    authRefreshTtlSeconds: 86400,
    authAllowDevJwt: true,
    aiProvider: 'openai',
    aiProviderUrl: 'https://api.openai.com/v1',
    aiApiKey: 'sk-test',
    aiModelDefault: 'gpt-4o-mini',
    aiModelReasoning: 'gpt-4o',
    aiTimeoutMs: 1_000,
    aiMaxRetries: 0,
    aiProposalTtlMs: 30 * 60 * 1000,
    storageBucketErrorCaptures: 'error-captures',
    storageBucketQuestionSnapshots: 'question-snapshots',
    storageBucketErrorEvidence: 'error-evidence',
    storageSignedUrlTtlSeconds: 900,
    evidenceSnapshotMaxBytes: 5_242_880,
    rateLimitGlobalPerMin: 120,
    rateLimitAuthPerMin: 10,
    rateLimitAiPerMin: 20,
    corsAllowedOrigins: ['http://localhost:3000'],
    emailProvider: 'resend',
    emailApiKey: '',
    emailFromAddress: 'no-reply@test.local',
    emailFromName: 'test',
    pushProvider: 'webpush',
    pushVapidPublicKey: '',
    pushVapidPrivateKey: '',
    pushSubject: 'mailto:test@test.local',
    featureFlags: {
      planner: true,
      tests: true,
      errorBank: true,
      review: true,
      progress: true,
      aiInsights: true,
      notifications: true,
      capture: true,
    },
  };
  return { ...base, ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const baseRequest = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user' as const, content: 'hi' }],
  temperature: 0.2,
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  fetchSpy.mockReset();
});

describe('OpenAiCompatibleProvider.complete', () => {
  it('returns DependencyUnavailableError when no API key configured', async () => {
    const provider = new OpenAiCompatibleProvider(makeEnv({ aiApiKey: '' }));
    await expect(provider.complete(baseRequest)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns DependencyUnavailableError on transport failure', async () => {
    fetchSpy.mockRejectedValue(new Error('socket reset'));
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const err = await provider.complete(baseRequest).catch((e) => e);
    expect(isAppError(err)).toBe(true);
    expect(err).toBeInstanceOf(DependencyUnavailableError);
    expect(err.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(err.context).toMatchObject({
      url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
  });

  it('returns DependencyUnavailableError (retryable) on 5xx', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: { message: 'boom' } }, 503));
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const err = await provider.complete(baseRequest).catch((e) => e);
    expect(err).toBeInstanceOf(DependencyUnavailableError);
    expect(err.context).toMatchObject({ status: 503, retryable: true });
  });

  it('returns DependencyUnavailableError (retryable) on 429', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: { message: 'quota' } }, 429));
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const err = await provider.complete(baseRequest).catch((e) => e);
    expect(err).toBeInstanceOf(DependencyUnavailableError);
    expect(err.context).toMatchObject({ status: 429, retryable: true });
  });

  it('returns DependencyUnavailableError (non-retryable) on 401', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: { message: 'auth' } }, 401));
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const err = await provider.complete(baseRequest).catch((e) => e);
    expect(err).toBeInstanceOf(DependencyUnavailableError);
    expect(err.context).toMatchObject({ status: 401, retryable: false });
  });

  it('returns DependencyUnavailableError (non-retryable) on 404', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: { message: 'no model' } }, 404));
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const err = await provider.complete(baseRequest).catch((e) => e);
    expect(err).toBeInstanceOf(DependencyUnavailableError);
    expect(err.context).toMatchObject({ status: 404, retryable: false });
  });

  it('returns AiOutputInvalidError on non-JSON 2xx body', async () => {
    fetchSpy.mockResolvedValue(new Response('not-json', { status: 200 }));
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const err = await provider.complete(baseRequest).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputInvalidError);
    expect(err.code).toBe('AI_OUTPUT_INVALID');
  });

  it('returns AiOutputInvalidError when content is missing', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ choices: [{ message: {}, finish_reason: 'length' }] }, 200),
    );
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const err = await provider.complete(baseRequest).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputInvalidError);
    expect(err.context).toMatchObject({ finishReason: 'length' });
  });

  it('returns parsed content + model + usage on success', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          model: 'gpt-4o-mini-2025-01',
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        },
        200,
      ),
    );
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const result = await provider.complete(baseRequest);
    expect(result.content).toBe('hello');
    expect(result.model).toBe('gpt-4o-mini-2025-01');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it('echoes the requested model when response omits one', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'x' } }] }, 200),
    );
    const provider = new OpenAiCompatibleProvider(makeEnv());
    const result = await provider.complete(baseRequest);
    expect(result.model).toBe(baseRequest.model);
  });

  it('sends Authorization: Bearer header and JSON-mode body', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'x' } }] }, 200),
    );
    const provider = new OpenAiCompatibleProvider(
      makeEnv({ aiApiKey: 'sk-xyz', aiProviderUrl: 'https://example.test/v1' }),
    );
    await provider.complete({ ...baseRequest, jsonMode: true });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-xyz');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect((init as RequestInit).signal).toBeDefined();
  });

  it('omits response_format when jsonMode is false', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'x' } }] }, 200),
    );
    const provider = new OpenAiCompatibleProvider(makeEnv());
    await provider.complete({ ...baseRequest, jsonMode: false });
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toBeUndefined();
  });

  it('passes max_tokens when maxOutputTokens is set', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'x' } }] }, 200),
    );
    const provider = new OpenAiCompatibleProvider(makeEnv());
    await provider.complete({ ...baseRequest, maxOutputTokens: 256 });
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.max_tokens).toBe(256);
  });

  it('rejects temperature out of [0, 1] before calling fetch', async () => {
    const provider = new OpenAiCompatibleProvider(makeEnv());
    await expect(
      provider.complete({ ...baseRequest, temperature: 1.5 }),
    ).rejects.toThrow(/temperature out of range/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
