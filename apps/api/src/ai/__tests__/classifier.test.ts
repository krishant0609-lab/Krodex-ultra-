/**
 * KRODEX API — Phase 8 classification pipeline tests.
 *
 * These tests exercise the AI-side of the classification flow
 * (`ai/classifier.ts`) with a fake `AiProvider`. They pin:
 *   - The prompt contains the evidence and the allowed enum.
 *   - The provider's structured output is parsed + returned.
 *   - The hallucination guard rejects `sourceIds` not in
 *     the supplied evidence with `AiOutputInvalidError`.
 *   - `normalizeClassifierError` translates the AI error to a
 *     `DependencyUnavailableError` (so the route returns 503).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { AiOutputInvalidError, DependencyUnavailableError } from '../../errors';
import type {
  AiMessage,
  AiProvider,
  AiRawResponse,
  AiRequest,
} from '../provider';
import type { ClassificationEvidence } from '../evidence';
import {
  normalizeClassifierError,
  suggestClassification,
} from '../classifier';

function makeEvidence(): ClassificationEvidence {
  return {
    error: {
      id: 'err-1',
      user_id: 'u-1',
      question_id: 'q-1',
      status: 'active',
      mistake_type: null,
      remark: 'I misremembered the formula.',
      source_attempt_id: null,
      first_seen_at: '2025-01-01T00:00:00.000Z',
      last_seen_at: '2025-01-02T00:00:00.000Z',
      resolved_at: null,
      recurrence_count: 0,
      metadata: {},
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-02T00:00:00.000Z',
    },
    question: {
      id: 'q-1',
      subject_id: 's-1',
      topic_id: 'topic-1',
      sub_topic_id: null,
      question_type: 'single_mcq',
      difficulty: 'medium',
      prompt: 'What is 2 + 2?',
      explanation: null,
      source: null,
      source_year: null,
      marks_correct: '4',
      marks_incorrect: '-1',
      metadata: {},
      is_active: true,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
    },
    topic: {
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
    recentByTopic: [
      {
        id: 'err-prior',
        user_id: 'u-1',
        question_id: 'q-2',
        status: 'resolved',
        mistake_type: 'concept',
        remark: null,
        source_attempt_id: null,
        first_seen_at: '2024-12-01T00:00:00.000Z',
        last_seen_at: '2024-12-02T00:00:00.000Z',
        resolved_at: '2024-12-05T00:00:00.000Z',
        recurrence_count: 0,
        metadata: {},
        created_at: '2024-12-01T00:00:00.000Z',
        updated_at: '2024-12-05T00:00:00.000Z',
      },
    ],
    capturedAt: '2025-05-01T00:00:00.000Z',
  };
}

const ok = (content: string): AiRawResponse => ({ content, model: 'fake' });

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

beforeEach(() => {
  // No state to reset; the providers are fresh per-test.
});

describe('suggestClassification', () => {
  it('returns the parsed suggestion on a valid provider response', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          suggestedCategory: 'concept',
          rationale: 'The student explicitly noted forgetting the formula.',
          confidence: 0.82,
          sourceIds: ['err-1', 'q-1'],
        }),
      ),
    );
    const out = await suggestClassification(provider, 'fake-model', makeEvidence());
    expect(out.suggestedCategory).toBe('concept');
    expect(out.confidence).toBeCloseTo(0.82);
    expect(out.sourceIds).toEqual(['err-1', 'q-1']);
  });

  it('sends system + user messages with json mode on, model id, and temperature 0.2', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          suggestedCategory: 'careless',
          rationale: 'Likely a misread.',
          confidence: 0.6,
          sourceIds: ['err-1'],
        }),
      ),
    );
    await suggestClassification(provider, 'fake-model', makeEvidence());
    const call = provider.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('expected at least one call');
    const messages: readonly AiMessage[] = call.args.messages;
    expect(messages).toHaveLength(2);
    const system = messages[0];
    const user = messages[1];
    expect(system?.role).toBe('system');
    expect(user?.role).toBe('user');
    expect(system?.content).toContain('concept');
    expect(system?.content).toContain('calculation');
    expect(user?.content).toContain('# Error err-1');
    expect(call.args.temperature).toBeCloseTo(0.2);
    expect(call.args.jsonMode).toBe(true);
    expect(call.args.model).toBe('fake-model');
  });

  it('rejects a sourceId that was not in the supplied evidence (hallucination guard)', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          suggestedCategory: 'concept',
          rationale: 'Invented a citation.',
          confidence: 0.5,
          sourceIds: ['err-1', 'err-INVENTED'],
        }),
      ),
    );
    await expect(
      suggestClassification(provider, 'fake-model', makeEvidence()),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('rejects an empty sourceIds list (Zod min(1))', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          suggestedCategory: 'concept',
          rationale: 'No citations.',
          confidence: 0.5,
          sourceIds: [],
        }),
      ),
    );
    await expect(
      suggestClassification(provider, 'fake-model', makeEvidence()),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('rejects a category outside the MistakeType enum', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          suggestedCategory: 'made_up_category',
          rationale: 'Not in the enum.',
          confidence: 0.5,
          sourceIds: ['err-1'],
        }),
      ),
    );
    await expect(
      suggestClassification(provider, 'fake-model', makeEvidence()),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it('accepts recentByTopic ids as valid sourceIds', async () => {
    const provider = makeProvider(() =>
      ok(
        JSON.stringify({
          suggestedCategory: 'concept',
          rationale: 'Same pattern as the prior resolved error.',
          confidence: 0.7,
          sourceIds: ['err-1', 'err-prior'],
        }),
      ),
    );
    const out = await suggestClassification(provider, 'fake-model', makeEvidence());
    expect(out.sourceIds).toContain('err-prior');
  });
});

describe('normalizeClassifierError', () => {
  it('re-throws DependencyUnavailableError as-is', () => {
    const err = new DependencyUnavailableError('upstream down');
    expect(() => normalizeClassifierError(err)).toThrow(DependencyUnavailableError);
  });

  it('translates AiOutputInvalidError to DependencyUnavailableError', () => {
    try {
      normalizeClassifierError(new AiOutputInvalidError('bad shape'));
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DependencyUnavailableError);
      expect((err as Error).message).toContain('AI classification unavailable');
    }
  });

  it('re-throws any other error as-is', () => {
    const err = new Error('kaboom');
    expect(() => normalizeClassifierError(err)).toThrow(err);
  });
});
