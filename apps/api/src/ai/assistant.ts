/**
 * KRODEX API — Phase 8 assistant Q&A pipeline.
 *
 * `answerAssistantQuery` is the AI-side of
 * `POST /assistant/queries`. The orchestrator
 * (in `services/assistant-service.ts`) calls this with:
 *
 *   - the request intent (rule-based, see ./intent.ts)
 *   - the evidence bundle (server-side, student-owned)
 *   - the question text + optional context
 *
 * This module's only job is to:
 *
 *   1. Build the system + user message list. The system prompt
 *      encodes the four intents and the four refusal policies
 *      (e.g. "do not propose a mutation unless the student asked
 *      for one"). The user prompt is the question, optional
 *      context, and a compact evidence listing (id + kind + a
 *      200-char excerpt).
 *   2. Call the provider through `callProvider` so the response
 *      is Zod-validated as `AssistantResponse`.
 *   3. Reject any response whose `sources[].id` (or
 *      `proposal.affectedRecords[]`) is not present in the
 *      supplied evidence — a guard against the model citing
 *      records the orchestrator never showed it.
 *
 * The pipeline never mutates state. The student is the only
 * entity that can write to tasks, reviews, or classifications;
 * if the model returns a `proposal`, the route stores it in
 * the in-process TTL store and waits for the student to confirm
 * (see `./proposer.ts` — Step 5).
 *
 * Per Implementation Plan §334–342 and Phase 8 Plan §8:
 *   - The prompt contains only the student-owned evidence.
 *   - The model may only cite ids that appear in the evidence
 *     listing; hallucinated citations are rejected.
 *   - Proposals, when present, must match the documented kinds
 *     (`create_task` | `schedule_review`).
 *   - For non-recommendation intents the system prompt forbids
 *     proposals so the assistant never silently mutates state.
 */

import { AiOutputInvalidError, DependencyUnavailableError } from '../errors';
import type { AiProvider } from './provider';
import { callProvider } from './adapter';
import {
  AssistantResponseSchema,
  type AssistantResponseT,
} from './schemas';
import type { AssistantEvidenceBundle } from './evidence';
import type { RequestIntent } from './intent';

const MAX_EXCERPT = 200;

/**
 * The system prompt. It is intentionally short and behavioral:
 *
 *   - the model is told it is a *grounded* assistant, not a
 *     general LLM
 *   - it is told to refuse to invent evidence, scores, or
 *     "facts" that are not in the supplied evidence block
 *   - it is told to NEVER propose a mutation unless the intent
 *     is `recommendation`
 *   - it is told to emit strict JSON in the documented shape
 *
 * The exact value is part of the Phase 8 contract — tests pin
 * the substring that matters (the "do not invent" rule).
 */
const SYSTEM_PROMPT = [
  'You are the KRODEX study assistant.',
  'You answer questions ONLY using the evidence the orchestrator',
  'supplied below. If the evidence does not answer the question,',
  'say so plainly. Never invent error ids, review ids, attempt',
  'ids, topic ids, or any other record references.',
  '',
  'Rules:',
  '- Ground every claim in a source. Use `sources[]` to cite the',
  '  evidence ids you actually saw, with a 1-200 char excerpt of',
  '  what you saw there. The excerpt MUST come from the supplied',
  '  evidence — never paraphrase in a way that adds detail.',
  '- If the request intent is "recommendation", you MAY include a',
  '  `proposal` block suggesting one of the documented kinds',
  '  ("create_task" or "schedule_review"). Otherwise you MUST NOT',
  '  include a proposal. The student is the only entity that can',
  '  approve a mutation.',
  '- `answer` is at most 2000 chars and references the evidence.',
  '- Return strict JSON. No prose outside the JSON object.',
].join('\n');

/**
 * Render the evidence bundle as a compact, deterministic text
 * block. The block is the only place the model can pull a source
 * id from; the hallucination guard rejects any other id.
 *
 * The shape mirrors `renderClassificationEvidenceForPrompt` but
 * is intentionally simpler — the bundle is a sample, not the
 * single error, so we list one row per record.
 */
export function renderAssistantEvidenceForPrompt(bundle: AssistantEvidenceBundle): string {
  const lines: string[] = [];
  lines.push('# Evidence (student-owned)');
  lines.push(`- capturedAt: ${bundle.capturedAt}`);
  if (bundle.errors.length === 0 && bundle.reviews.length === 0 && bundle.topics.length === 0) {
    lines.push('- (no records)');
    return lines.join('\n');
  }
  for (const e of bundle.errors) {
    lines.push('');
    lines.push(`# error ${e.id}`);
    lines.push(`- status: ${e.status}`);
    lines.push(`- mistake_type: ${e.mistake_type ?? 'null'}`);
    if (e.remark) lines.push(`- remark: ${truncate(e.remark, MAX_EXCERPT)}`);
  }
  for (const r of bundle.reviews) {
    lines.push('');
    lines.push(`# review ${r.id}`);
    lines.push(`- error_id: ${r.error_id}`);
    lines.push(`- state: ${r.state}`);
    lines.push(`- outcome: ${r.outcome ?? 'null'}`);
  }
  for (const t of bundle.topics) {
    lines.push('');
    lines.push(`# topic ${t.id}`);
    lines.push(`- name: ${t.name}`);
    lines.push(`- code: ${t.code}`);
  }
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/**
 * Run a single assistant Q&A call. The orchestrator owns intent
 * classification and evidence assembly; this function takes the
 * resolved inputs and returns a Zod-validated
 * `AssistantResponseT` (optionally with a `proposal`).
 *
 * The same citation-ownership guard the classifier uses applies
 * here: every `source.id` (and every `proposal.affectedRecords[]`
 * entry when a proposal is present) must be one of the ids the
 * orchestrator supplied in the bundle. Otherwise the response is
 * rejected as `AiOutputInvalidError` (and the orchestrator maps
 * that to `DependencyUnavailableError`, so the route returns
 * 503 and the UI shows the deterministic fallback).
 */
export async function answerAssistantQuery(
  provider: AiProvider,
  model: string,
  question: string,
  intent: RequestIntent,
  bundle: AssistantEvidenceBundle,
): Promise<AssistantResponseT> {
  const evidenceBlock = renderAssistantEvidenceForPrompt(bundle);
  const userPrompt = [
    `# Question`,
    question.trim(),
    '',
    `# Detected intent`,
    intent,
    '',
    evidenceBlock,
  ].join('\n');

  const result = await callProvider(provider, {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseSchema: AssistantResponseSchema,
    temperature: 0.2,
    jsonMode: true,
  });
  const response = result.data;

  // The system prompt forbids proposals on non-recommendation
  // intents. We enforce it here as a second layer so a model that
  // ignores the prompt still cannot bypass the confirmation
  // step.
  if (response.proposal && intent !== 'recommendation') {
    throw new AiOutputInvalidError(
      'assistant returned a proposal for a non-recommendation intent',
      { context: { intent, proposalKind: response.proposal.kind } },
    );
  }

  assertCitationOwnershipForResponse(response, bundle);
  return response;
}

/**
 * The "no hallucinated evidence" guard. The set of permissible
 * ids is the union of:
 *   - every error id in the bundle
 *   - every review id in the bundle
 *   - every topic id in the bundle
 *
 * A source or affected-record id outside that set is treated as
 * a model failure (not a student error) and surfaced as 503.
 */
function assertCitationOwnershipForResponse(
  response: AssistantResponseT,
  bundle: AssistantEvidenceBundle,
): void {
  const allowed = new Set<string>();
  for (const e of bundle.errors) allowed.add(e.id);
  for (const r of bundle.reviews) allowed.add(r.id);
  for (const t of bundle.topics) allowed.add(t.id);

  for (const src of response.sources) {
    if (!allowed.has(src.id)) {
      throw new AiOutputInvalidError(
        'assistant response cited an unknown source id',
        {
          context: {
            kind: src.kind,
            unknownId: src.id,
            allowedKinds: ['error', 'review', 'topic'],
          },
        },
      );
    }
  }
  if (response.proposal) {
    for (const id of response.proposal.affectedRecords) {
      if (!allowed.has(id)) {
        throw new AiOutputInvalidError(
          'assistant proposal cited an unknown affected record id',
          {
            context: {
              proposalKind: response.proposal.kind,
              unknownId: id,
            },
          },
        );
      }
    }
  }
}

/**
 * Convenience re-exports for tests that need to assert on the
 * helper output without going through the pipeline.
 */
export { AssistantResponseSchema };
export type { AssistantResponseT };

/**
 * Normalize the assistant's pipeline errors to the two
 * domain-visible error classes. Mirrors
 * `normalizeClassifierError` so the route layer has a single
 * error-handling contract for both endpoints.
 */
export function normalizeAssistantError(err: unknown): never {
  if (err instanceof DependencyUnavailableError) throw err;
  if (err instanceof AiOutputInvalidError) {
    throw new DependencyUnavailableError('AI assistant unavailable', {
      cause: err,
      context: { source: 'assistant' },
    });
  }
  throw err;
}
