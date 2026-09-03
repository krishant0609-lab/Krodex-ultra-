/**
 * KRODEX API — Phase 8 assistant orchestrator tests.
 *
 * The orchestrator is the seam between the HTTP layer and the
 * AI pipelines. These tests pin:
 *   - Happy path: evidence → provider → suggestion with
 *     candidate source ids surfaced to the client.
 *   - Auth contract: when the user has no API key configured,
 *     the service throws `DependencyUnavailableError` so the
 *     route renders the "AI unavailable" fallback.
 *   - Failure contract: provider-side errors translate to
 *     `DependencyUnavailableError` (not `AiOutputInvalidError`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { DependencyUnavailableError, NotFoundError } from '../../errors';
import type {
  AiProvider,
  AiRawResponse,
  AiRequest,
} from '../../ai/provider';
import {
  AssistantService,
  createAssistantService,
} from '../assistant-service';
import type { ApiEnv } from '../../config/env';
import {
  _resetProposalStoreForTests,
} from '../../ai/proposer';

const USER = 'user-A';

function ok(content: string): AiRawResponse {
  return { content, model: 'fake' };
}

function makeProvider(
  produce: (req: AiRequest) => AiRawResponse,
): AiProvider {
  return {
    async complete(req: AiRequest): Promise<AiRawResponse> {
      return produce(req);
    },
  };
}

function makeEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    aiProvider: 'openai',
    aiApiKey: 'test-key',
    aiModelDefault: 'fake-default',
    aiModelReasoning: 'fake-reasoning',
    ...overrides,
  } as unknown as ApiEnv;
}

function seedErrorTables(): ReturnType<typeof makeFakeSupabase> {
  return makeFakeSupabase({
    defaultUserId: USER,
    tables: {
      error_entries: [
        {
          id: 'err-1',
          user_id: USER,
          question_id: 'q-1',
          status: 'open',
          mistake_type: null,
          remark: 'I misread the question.',
          source_attempt_id: null,
          first_seen_at: '2025-01-01T00:00:00.000Z',
          last_seen_at: '2025-01-02T00:00:00.000Z',
          resolved_at: null,
          recurrence_count: 0,
          metadata: {},
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-02T00:00:00.000Z',
        },
      ],
      questions: [
        {
          id: 'q-1',
          subject_id: 's-1',
          topic_id: 'topic-1',
          sub_topic_id: null,
          question_type: 'single_choice',
          difficulty: 'medium',
          prompt: 'A short question.',
          explanation: null,
          source: null,
          source_year: null,
          marks_correct: 4,
          marks_incorrect: -1,
          metadata: {},
          is_active: true,
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ],
      topics: [
        {
          id: 'topic-1',
          subject_id: 's-1',
          parent_topic_id: null,
          code: 'T1',
          name: 'Arithmetic',
          display_order: 1,
          syllabus_scope: null,
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ],
    },
  });
}

let capturedRequests: AiRequest[] = [];
beforeEach(() => {
  capturedRequests = [];
  _resetProposalStoreForTests();
});

afterEach(() => {
  _resetProposalStoreForTests();
});

describe('AssistantService.classifyError', () => {
  it('returns the suggestion + candidate source ids on a valid provider response', async () => {
    const provider = makeProvider((req) => {
      capturedRequests.push(req);
      return ok(
        JSON.stringify({
          suggestedCategory: 'misread',
          rationale: 'The remark mentions misreading.',
          confidence: 0.75,
          sourceIds: ['err-1', 'q-1'],
        }),
      );
    });
    const svc = createAssistantService(makeEnv(), provider);
    const out = await svc.classifyError(seedErrorTables(), USER, 'err-1');
    expect(out.suggestion.suggestedCategory).toBe('misread');
    expect(out.suggestion.confidence).toBeCloseTo(0.75);
    expect(out.suggestion.sourceIds).toEqual(['err-1', 'q-1']);
    // The candidate id list must include the error id, the
    // linked question id, and the topic id. Recent resolved
    // errors are empty in this fixture.
    expect(out.candidateSourceIds).toEqual(
      expect.arrayContaining(['err-1', 'q-1', 'topic-1']),
    );
    // The model is `modelDefault`, not `modelReasoning` —
    // classification is a small, single-shot JSON call.
    expect(capturedRequests[0]?.model).toBe('fake-default');
  });

  it('throws DependencyUnavailableError when the env has no AI_API_KEY', async () => {
    const provider = makeProvider(() => ok('{}'));
    const svc = createAssistantService(
      makeEnv({ aiApiKey: '' }),
      provider,
    );
    await expect(svc.classifyError(seedErrorTables(), USER, 'err-1')).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it('translates provider-side errors into DependencyUnavailableError', async () => {
    const provider = makeProvider(() => {
      // Simulate a provider that fails the Zod parse by
      // returning a JSON string that fails schema validation.
      return ok(
        JSON.stringify({
          suggestedCategory: 'made_up_category',
          rationale: 'Not in the enum.',
          confidence: 0.5,
          sourceIds: ['err-1'],
        }),
      );
    });
    const svc = createAssistantService(makeEnv(), provider);
    await expect(svc.classifyError(seedErrorTables(), USER, 'err-1')).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it('throws when the error does not exist (orchestrator surfaces the not-found error)', async () => {
    const provider = makeProvider(() => ok('{}'));
    const svc = createAssistantService(makeEnv(), provider);
    const empty = makeFakeSupabase({ defaultUserId: USER });
    await expect(svc.classifyError(empty, USER, 'missing')).rejects.toThrow(/not found/i);
  });

  it('throws when the error is owned by another student', async () => {
    const provider = makeProvider(() => ok('{}'));
    const svc = createAssistantService(makeEnv(), provider);
    const otherOwner = makeFakeSupabase({
      defaultUserId: 'someone-else',
      tables: {
        error_entries: [
          {
            id: 'err-1',
            user_id: 'someone-else',
            question_id: null,
            status: 'open',
            mistake_type: null,
            remark: null,
            source_attempt_id: null,
            first_seen_at: '2025-01-01T00:00:00.000Z',
            last_seen_at: '2025-01-01T00:00:00.000Z',
            resolved_at: null,
            recurrence_count: 0,
            metadata: {},
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    await expect(svc.classifyError(otherOwner, USER, 'err-1')).rejects.toThrow();
  });
});

describe('createAssistantService', () => {
  it('uses env.aiModelDefault and env.aiModelReasoning from the frozen env', async () => {
    const provider = makeProvider((req) => {
      capturedRequests.push(req);
      return ok(
        JSON.stringify({
          suggestedCategory: 'careless',
          rationale: 'x',
          confidence: 0.5,
          sourceIds: ['err-1'],
        }),
      );
    });
    const env = makeEnv({
      aiModelDefault: 'mini',
      aiModelReasoning: 'pro',
    });
    const svc = createAssistantService(env, provider);
    await svc.classifyError(seedErrorTables(), USER, 'err-1');
    expect(capturedRequests[0]?.model).toBe('mini');
  });

  it('exposes the same public surface as the direct constructor', () => {
    const provider = makeProvider(() => ok('{}'));
    const fromFactory = createAssistantService(makeEnv(), provider);
    const fromCtor = new AssistantService({
      provider,
      env: makeEnv(),
      modelDefault: 'a',
      modelReasoning: 'b',
    });
    expect(typeof fromFactory.classifyError).toBe('function');
    expect(typeof fromCtor.classifyError).toBe('function');
  });
});

describe('AssistantService.answerQuery', () => {
  function seedAssistantTables(): ReturnType<typeof makeFakeSupabase> {
    return makeFakeSupabase({
      defaultUserId: USER,
      tables: {
        error_entries: [
          {
            id: 'err-1',
            user_id: USER,
            question_id: 'q-1',
            status: 'open',
            mistake_type: null,
            remark: 'I misread the question.',
            source_attempt_id: null,
            first_seen_at: '2025-01-01T00:00:00.000Z',
            last_seen_at: '2025-01-02T00:00:00.000Z',
            resolved_at: null,
            recurrence_count: 0,
            metadata: {},
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-02T00:00:00.000Z',
          },
        ],
        review_schedules: [
          {
            id: 'rev-1',
            error_id: 'err-1',
            user_id: USER,
            state: 'due',
            outcome: null,
          },
        ],
        topics: [
          {
            id: 'topic-1',
            subject_id: 's-1',
            parent_topic_id: null,
            code: 'T1',
            name: 'Arithmetic',
            display_order: 1,
            syllabus_scope: null,
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    });
  }

  it('returns the assistant response + candidate source ids on a valid provider call', async () => {
    const provider = makeProvider((req) => {
      capturedRequests.push(req);
      return ok(
        JSON.stringify({
          answer: 'You have one open error on Arithmetic.',
          sources: [
            { kind: 'error', id: 'err-1', excerpt: 'I misread the question.' },
            { kind: 'topic', id: 'topic-1', excerpt: 'name: Arithmetic' },
          ],
        }),
      );
    });
    const svc = createAssistantService(makeEnv(), provider);
    const out = await svc.answerQuery(
      seedAssistantTables(),
      USER,
      { question: 'how am I doing on arithmetic?' },
    );
    expect(out.response.answer).toMatch(/Arithmetic/);
    expect(out.response.sources.map((s) => s.id).sort()).toEqual([
      'err-1',
      'topic-1',
    ]);
    expect(out.candidateSourceIds).toEqual(
      expect.arrayContaining(['err-1', 'rev-1', 'topic-1']),
    );
    // /assistant/queries uses the reasoning model, not the
    // default model — multi-step reasoning.
    expect(capturedRequests[0]?.model).toBe('fake-reasoning');
  });

  it('uses the modelReasoning model id (not modelDefault)', async () => {
    const provider = makeProvider((req) => {
      capturedRequests.push(req);
      return ok(
        JSON.stringify({
          answer: 'ok',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'x' }],
        }),
      );
    });
    const env = makeEnv({
      aiModelDefault: 'mini',
      aiModelReasoning: 'pro',
    });
    const svc = createAssistantService(env, provider);
    await svc.answerQuery(seedAssistantTables(), USER, { question: 'q' });
    expect(capturedRequests[0]?.model).toBe('pro');
  });

  it('throws DependencyUnavailableError when the env has no AI_API_KEY', async () => {
    const provider = makeProvider(() => ok('{}'));
    const svc = createAssistantService(
      makeEnv({ aiApiKey: '' }),
      provider,
    );
    await expect(
      svc.answerQuery(seedAssistantTables(), USER, { question: 'q' }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('translates provider errors into DependencyUnavailableError', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          // Hallucinated category: not in the enum. The
          // pipeline rejects with AiOutputInvalidError which
          // the orchestrator translates to
          // DependencyUnavailableError.
          answer: 'A'.repeat(2001),
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'x' }],
        }),
      ),
    );
    const svc = createAssistantService(makeEnv(), provider);
    await expect(
      svc.answerQuery(seedAssistantTables(), USER, { question: 'q' }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('stores a proposal in the in-process TTL map and returns the server id', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'You should practice arithmetic.',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'I misread the question.' }],
          proposal: {
            id: 'model-supplied-id-DISCARDED',
            kind: 'create_task',
            description: 'Practice arithmetic.',
            affectedRecords: ['err-1'],
            payload: { title: 'Practice arithmetic' },
            createdAt: 1715000000000,
          },
        }),
      ),
    );
    const svc = createAssistantService(makeEnv(), provider);
    const out = await svc.answerQuery(seedAssistantTables(), USER, {
      question: 'what should I do next?',
    });
    expect(out.response.proposal).toBeDefined();
    // The server MUST overwrite the model-supplied id and
    // createdAt — we never trust the model with those.
    expect(out.response.proposal?.id).not.toBe('model-supplied-id-DISCARDED');
    expect(out.response.proposal?.id.length).toBeGreaterThan(0);
    expect(out.response.proposal?.createdAt).toBeGreaterThan(0);
  });
});

describe('AssistantService.confirmProposal', () => {
  function seedAssistantTables(): ReturnType<typeof makeFakeSupabase> {
    return makeFakeSupabase({
      defaultUserId: USER,
      tables: {
        error_entries: [
          {
            id: 'err-1',
            user_id: USER,
            question_id: 'q-1',
            status: 'open',
            mistake_type: null,
            remark: 'I misread the question.',
            source_attempt_id: null,
            first_seen_at: '2025-01-01T00:00:00.000Z',
            last_seen_at: '2025-01-02T00:00:00.000Z',
            resolved_at: null,
            recurrence_count: 0,
            metadata: {},
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-02T00:00:00.000Z',
          },
        ],
      },
    });
  }

  it('throws NotFoundError when the proposal does not exist', async () => {
    const provider = makeProvider(() => ok('{}'));
    const svc = createAssistantService(makeEnv(), provider);
    await expect(
      svc.confirmProposal(USER, { proposalId: 'missing', confirmed: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the proposal + executed: false when the student rejects', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'You should practice arithmetic.',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'x' }],
          proposal: {
            id: 'to-be-discarded',
            kind: 'create_task',
            description: 'Practice arithmetic.',
            affectedRecords: ['err-1'],
            payload: { title: 'Practice arithmetic' },
            createdAt: 1715000000000,
          },
        }),
      ),
    );
    const svc = createAssistantService(makeEnv(), provider);
    const out = await svc.answerQuery(seedAssistantTables(), USER, {
      question: 'what should I do next?',
    });
    const proposalId = out.response.proposal!.id;
    const confirmed = await svc.confirmProposal(USER, {
      proposalId,
      confirmed: false,
    });
    expect(confirmed.executed).toBe(false);
    expect(confirmed.proposal.id).toBe(proposalId);
    // A second confirm must now 404 — the rejection removed
    // the entry from the TTL map.
    await expect(
      svc.confirmProposal(USER, { proposalId, confirmed: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the proposal + executed: true when the student confirms', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'You should practice arithmetic.',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'x' }],
          proposal: {
            id: 'to-be-discarded',
            kind: 'create_task',
            description: 'Practice arithmetic.',
            affectedRecords: ['err-1'],
            payload: { title: 'Practice arithmetic' },
            createdAt: 1715000000000,
          },
        }),
      ),
    );
    const svc = createAssistantService(makeEnv(), provider);
    const out = await svc.answerQuery(seedAssistantTables(), USER, {
      question: 'what should I do next?',
    });
    const proposalId = out.response.proposal!.id;
    const confirmed = await svc.confirmProposal(USER, {
      proposalId,
      confirmed: true,
    });
    expect(confirmed.executed).toBe(true);
    expect(confirmed.proposal.id).toBe(proposalId);
    expect(confirmed.proposal.kind).toBe('create_task');
  });
});
