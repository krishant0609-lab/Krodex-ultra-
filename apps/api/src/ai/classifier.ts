/**
 * KRODEX API — Phase 8 error-classification pipeline.
 *
 * `suggestClassification` is the AI-side of
 * `POST /errors/:id/classification-suggest`. The orchestrator
 * (in `services/assistant-service.ts`) calls this with the
 * evidence already assembled; this module's only job is to:
 *
 *   1. Build the system + user message list.
 *   2. Call the provider through `callProvider` so the response
 *      is Zod-validated as `ClassificationSuggestion`.
 *   3. Reject any suggestion whose `sourceIds` include an id not
 *      present in the supplied evidence — a guard against the
 *      model hallucinating a citation.
 *
 * The classifier never mutates state. The student is the only
 * entity that can write to `error_entries.mistake_type`; this
 * function returns a non-binding suggestion and the route
 * returns it to the caller verbatim.
 *
 * Per Implementation Plan §334–342 and Phase 8 Plan §8:
 *   - The prompt contains only the student-owned evidence.
 *   - `MistakeType` is the only category enum the model may
 *     return; the Zod schema enforces that.
 *   - Confidence is bounded 0.0–1.0 and surfaced to the client
 *     so the UI can render it as "85% confident".
 */

import { z } from 'zod';
import { AiOutputInvalidError, DependencyUnavailableError } from '../errors';
import type { AiProvider } from './provider';
import { callProvider } from './adapter';
import {
  ClassificationSuggestionSchema,
  type ClassificationSuggestionT,
  MistakeTypeSchema,
} from './schemas';
import type { ClassificationEvidence } from './evidence';
import { renderClassificationEvidenceForPrompt } from './evidence';

const SYSTEM_PROMPT = [
  'You are the KRODEX error-classification assistant.',
  'Your job: given a student\'s error record, related question, and recent',
  'history, suggest a single mistake_type from the allowed enum.',
  '',
  'Allowed mistake_type values:',
  ...MistakeTypeSchema.options.map((v) => `- ${v}`),
  '',
  'Rules:',
  '- Return ONE suggestedCategory from the allowed enum. No other strings.',
  '- `rationale` must be at most 500 chars and reference the evidence above.',
  '- `confidence` is a number in [0, 1] — be honest. If unsure, return 0.4 or lower.',
  '- `sourceIds` must contain ONLY ids you actually saw in the evidence above.',
  '  If you cannot tie a claim to a real id, drop the claim. Never invent ids.',
  '- Return strict JSON. No prose outside the JSON object.',
].join('\n');

/**
 * Returns a Zod-validated classification suggestion, or throws
 * `AiOutputInvalidError` / `DependencyUnavailableError` from the
 * adapter layer.
 *
 * @param provider  The configured `AiProvider` (already wrapped in
 *                  `RetryingProvider` by the singleton in
 *                  `provider.default.ts`).
 * @param model     The model id the assistant should call.
 *                  Typically `aiModelDefault` for a small, fast
 *                  classification, or `aiModelReasoning` for the
 *                  harder cases. The orchestrator picks.
 * @param evidence  The evidence bundle, already filtered to the
 *                  student's own records.
 */
export async function suggestClassification(
  provider: AiProvider,
  model: string,
  evidence: ClassificationEvidence,
): Promise<ClassificationSuggestionT> {
  const userPrompt = renderClassificationEvidenceForPrompt(evidence);
  const result = await callProvider(provider, {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseSchema: ClassificationSuggestionSchema,
    temperature: 0.2,
    jsonMode: true,
  });
  const suggestion = result.data;
  assertCitationOwnership(suggestion, evidence);
  return suggestion;
}

/**
 * Ensure every `sourceId` the model cited is one of the ids the
 * orchestrator actually passed in. This is the "no hallucinated
 * evidence" guard from Phase 8 Plan §8.
 *
 * The set of permissible ids is intentionally limited:
 *   - the error id itself
 *   - the linked question id (if any)
 *   - the topic id (if any)
 *   - up to 5 recent resolved error ids from the student's own history
 */
function assertCitationOwnership(
  suggestion: ClassificationSuggestionT,
  evidence: ClassificationEvidence,
): void {
  const allowed = new Set<string>([evidence.error.id]);
  if (evidence.question) allowed.add(evidence.question.id);
  if (evidence.topic) allowed.add(evidence.topic.id);
  for (const r of evidence.recentByTopic) allowed.add(r.id);
  for (const id of suggestion.sourceIds) {
    if (!allowed.has(id)) {
      throw new AiOutputInvalidError(
        'classification suggestion cited an unknown source id',
        {
          context: {
            unknownId: id,
            allowedIds: Array.from(allowed),
          },
        },
      );
    }
  }
}

/**
 * Re-export the response schema so callers can derive a TypeScript
 * type without an extra import.
 */
export { ClassificationSuggestionSchema };
export type { ClassificationSuggestionT };

/**
 * Helper guard for the orchestrator: re-throw a dependency
 * unavailable error as-is (so the route returns 503), but
 * translate an `AiOutputInvalidError` from the hallucination check
 * into a `DependencyUnavailableError` so the caller can render a
 * clean "AI unavailable" fallback instead of leaking model
 * internals. (We keep the original error in the cause chain for
 * ops.)
 */
export function normalizeClassifierError(err: unknown): never {
  if (err instanceof DependencyUnavailableError) throw err;
  if (err instanceof AiOutputInvalidError) {
    throw new DependencyUnavailableError('AI classification unavailable', {
      cause: err,
      context: { source: 'classifier' },
    });
  }
  throw err;
}

/**
 * Defensive validator for callers that hand-roll a parsed object
 * (e.g. tests). Re-exported so the unit tests do not need to
 * import the adapter.
 */
export const ClassificationSuggestionZod = ClassificationSuggestionSchema.extend({});
export type ClassificationSuggestionZodT = z.infer<typeof ClassificationSuggestionSchema>;
