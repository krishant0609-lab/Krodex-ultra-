/**
 * KRODEX API — Phase 8 assistant Q&A pipeline tests.
 *
 * These tests exercise the AI-side of
 * `POST /assistant/queries` with a fake `AiProvider`. They
 * pin the four contracts that matter:
 *
 *   1. The prompt is system + user; the user payload includes
 *      the question, the detected intent, and a deterministic
 *      evidence listing.
 *   2. A valid `AssistantResponse` is parsed and returned.
 *   3. The hallucination guard rejects a `source.id` (or
 *      `proposal.affectedRecords[]` entry) that was not in the
 *      supplied evidence with `AiOutputInvalidError`.
 *   4. The system prompt forbids proposals on non-recommendation
 *      intents; the pipeline enforces it as a second layer so
 *      a model that ignores the prompt still cannot bypass the
 *      confirmation step.
 */

import { describe, expect, it } from 'vitest';
import { AiOutputInvalidError, DependencyUnavailableError } from '../../errors';
import type {
  AiMessage,
  AiProvider,
  AiRawResponse,
  AiRequest,
} from '../provider';
import type { AssistantEvidenceBundle } from '../evidence';
import type { RequestIntent } from '../intent';
import {
  answerAssistantQuery,
  normalizeAssistantError,
  renderAssistantEvidenceForPrompt,
} from '../assistant';

const ok = (content: string, model: string = 'fake-model'): AiRawResponse => ({
  content,
  model,
});

interface CapturedCall {
  args: AiRequest;
}

function makeProvider(
  produce: (req: AiRequest) => AiRawResponse,
): AiProvider & { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  return {
    calls,
    async complete(req: AiRequest): Promise<AiRawResponse> {
      calls.push({ args: req });
      return produce(req);
    },
  };
}

function makeBundle(overrides: Partial<AssistantEvidenceBundle> = {}): AssistantEvidenceBundle {
  return {
    errors: [
      {
        id: 'err-1',
        user_id: 'u-1',
        question_id: 'q-1',
        status: 'active',
        mistake_type: null,
        remark: 'I misread the question stem.',
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
    reviews: [
      {
        id: 'rev-1',
        error_id: 'err-1',
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
    capturedAt: '2025-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('answerAssistantQuery', () => {
  it('returns a parsed AssistantResponse on a valid provider response', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'You have an open error on Arithmetic.',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'I misread the question stem.' }],
        }),
      ),
    );
    const out = await answerAssistantQuery(
      provider,
      'fake-model',
      'how am I doing on arithmetic?',
      'other',
      makeBundle(),
    );
    expect(out.answer).toBe('You have an open error on Arithmetic.');
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]?.id).toBe('err-1');
    expect(out.proposal).toBeUndefined();
  });

  it('sends system + user messages with json mode, model id, and temperature 0.2', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'ok',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'I misread the question stem.' }],
        }),
      ),
    );
    await answerAssistantQuery(
      provider,
      'fake-model',
      'explain the error',
      'explanation',
      makeBundle(),
    );
    const call = provider.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('expected at least one call');
    const messages: readonly AiMessage[] = call.args.messages;
    expect(messages).toHaveLength(2);
    const system = messages[0];
    const user = messages[1];
    expect(system?.role).toBe('system');
    expect(user?.role).toBe('user');
    // System prompt mentions the grounded-only rule.
    expect(system?.content).toContain('Never invent');
    // User payload contains the question, intent, and the evidence block.
    expect(user?.content).toContain('# Question');
    expect(user?.content).toContain('explain the error');
    expect(user?.content).toContain('# Detected intent');
    expect(user?.content).toContain('explanation');
    expect(user?.content).toContain('# error err-1');
    expect(user?.content).toContain('# review rev-1');
    expect(user?.content).toContain('# topic topic-1');
    expect(call.args.temperature).toBeCloseTo(0.2);
    expect(call.args.jsonMode).toBe(true);
    expect(call.args.model).toBe('fake-model');
  });

  it('rejects a source id that was not in the supplied evidence (hallucination guard)', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'I will cite a phantom record.',
          sources: [
            { kind: 'error', id: 'err-1', excerpt: 'I misread the question stem.' },
            { kind: 'error', id: 'err-INVENTED', excerpt: 'Pretend this is real.' },
          ],
        }),
      ),
    );
    await expect(
      answerAssistantQuery(
        provider,
        'fake-model',
        'summarize my errors',
        'other',
        makeBundle(),
      ),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('accepts review and topic ids as valid sources', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'You have a due review on Arithmetic.',
          sources: [
            { kind: 'review', id: 'rev-1', excerpt: 'state: due' },
            { kind: 'topic', id: 'topic-1', excerpt: 'name: Arithmetic' },
          ],
        }),
      ),
    );
    const out = await answerAssistantQuery(
      provider,
      'fake-model',
      'what reviews are due?',
      'other',
      makeBundle(),
    );
    expect(out.sources.map((s) => s.id).sort()).toEqual(['rev-1', 'topic-1']);
  });

  it('rejects a source whose excerpt is longer than 200 characters', async () => {
    const longExcerpt = 'A'.repeat(201);
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'x',
          sources: [{ kind: 'error', id: 'err-1', excerpt: longExcerpt }],
        }),
      ),
    );
    await expect(
      answerAssistantQuery(provider, 'fake-model', 'q', 'other', makeBundle()),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('rejects a proposal returned for a non-recommendation intent (e.g. explanation)', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'here is a plan...',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'I misread the question stem.' }],
          proposal: {
            id: 'prop-1',
            kind: 'create_task',
            description: 'Do 20 more arithmetic problems.',
            affectedRecords: ['err-1'],
            payload: { title: 'Practice arithmetic' },
            createdAt: 1715000000000,
          },
        }),
      ),
    );
    await expect(
      answerAssistantQuery(
        provider,
        'fake-model',
        'explain the error',
        'explanation',
        makeBundle(),
      ),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('preserves a proposal when the intent is "recommendation"', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'I suggest creating a task to drill arithmetic.',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'I misread the question stem.' }],
          proposal: {
            id: 'prop-1',
            kind: 'create_task',
            description: 'Do 20 more arithmetic problems.',
            affectedRecords: ['err-1'],
            payload: { title: 'Practice arithmetic' },
            createdAt: 1715000000000,
          },
        }),
      ),
    );
    const out = await answerAssistantQuery(
      provider,
      'fake-model',
      'what should I do next?',
      'recommendation',
      makeBundle(),
    );
    expect(out.proposal).toBeDefined();
    expect(out.proposal?.kind).toBe('create_task');
  });

  it('rejects a proposal whose affectedRecord id is not in the evidence', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'create a task for a phantom error.',
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'I misread the question stem.' }],
          proposal: {
            id: 'prop-1',
            kind: 'create_task',
            description: 'bogus',
            affectedRecords: ['err-INVENTED'],
            payload: { title: 'Practice' },
            createdAt: 1715000000000,
          },
        }),
      ),
    );
    await expect(
      answerAssistantQuery(
        provider,
        'fake-model',
        'what should I do?',
        'recommendation',
        makeBundle(),
      ),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('rejects an answer that exceeds 2000 characters', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          answer: 'A'.repeat(2001),
          sources: [{ kind: 'error', id: 'err-1', excerpt: 'I misread the question stem.' }],
        }),
      ),
    );
    await expect(
      answerAssistantQuery(provider, 'fake-model', 'q', 'other', makeBundle()),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });
});

describe('renderAssistantEvidenceForPrompt', () => {
  it('lists every error, review, and topic the model is allowed to cite', () => {
    const text = renderAssistantEvidenceForPrompt(makeBundle());
    expect(text).toContain('# Evidence (student-owned)');
    expect(text).toContain('# error err-1');
    expect(text).toContain('# review rev-1');
    expect(text).toContain('# topic topic-1');
    expect(text).toContain('capturedAt: 2025-05-01T00:00:00.000Z');
  });

  it('renders an empty-bundle placeholder when the student has no records', () => {
    const empty: AssistantEvidenceBundle = {
      errors: [],
      reviews: [],
      topics: [],
      capturedAt: '2025-05-01T00:00:00.000Z',
    };
    const text = renderAssistantEvidenceForPrompt(empty);
    expect(text).toContain('(no records)');
  });

  it('truncates remarks to 200 characters and appends …', () => {
    const longRemark = 'A'.repeat(500);
    const text = renderAssistantEvidenceForPrompt(
      makeBundle({
        errors: [
          {
            id: 'err-1',
            user_id: 'u-1',
            question_id: null,
            status: 'active',
            mistake_type: null,
            remark: longRemark,
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
      }),
    );
    expect(text).toContain('A'.repeat(200) + '…');
    expect(text).not.toContain('A'.repeat(201));
  });
});

describe('normalizeAssistantError', () => {
  it('re-throws DependencyUnavailableError as-is', () => {
    const err = new DependencyUnavailableError('upstream down');
    expect(() => normalizeAssistantError(err)).toThrow(DependencyUnavailableError);
  });

  it('translates AiOutputInvalidError to DependencyUnavailableError', () => {
    try {
      normalizeAssistantError(new AiOutputInvalidError('bad shape'));
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DependencyUnavailableError);
      expect((err as Error).message).toContain('AI assistant unavailable');
    }
  });

  it('re-throws any other error as-is', () => {
    const err = new Error('kaboom');
    expect(() => normalizeAssistantError(err)).toThrow(err);
  });
});

// Type-only re-export for the request intent literal set; keeps
// the test file self-contained without re-importing from intent.ts.
const _intent: RequestIntent = 'recommendation';
void _intent;
