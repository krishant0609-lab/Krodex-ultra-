/**
 * KRODEX API — Phase 8 AI Zod schemas.
 *
 * The wire-level validation surface for every AI input/output. The
 * Zod schemas here are the contract the provider adapter, the
 * proposer, the assistant service, and the route handlers all
 * validate against. Provider output is parsed through these
 * schemas before the assistant service touches it.
 *
 * Conventions:
 *   - All string lengths are hard caps (the model can never
 *     exceed them; we cap the answer at 2000, rationale at 500,
 *     excerpt at 200, sourceIds at 20, etc.).
 *   - `confidence` is 0..1.
 *   - `suggestedCategory` is the `MistakeType` enum.
 *   - Proposal kinds are exactly the two Phase 8 supports.
 *
 * Every schema has an inferred `T` type so route handlers don't
 * re-declare them.
 */

import { z } from 'zod';

/**
 * The MistakeType values the AI may suggest. The classification
 * schema validates against this set; any model output with a
 * category outside it is rejected as `AI_OUTPUT_INVALID`.
 */
export const MistakeTypeSchema = z.enum([
  'concept',
  'calculation',
  'misread',
  'time_pressure',
  'careless',
  'method',
  'unknown',
]);
export type MistakeTypeT = z.infer<typeof MistakeTypeSchema>;

/**
 * The kind of evidence the assistant may cite in its answer.
 * Server-side only — the client never sends this.
 */
export const AssistantEvidenceKindSchema = z.enum([
  'error',
  'review',
  'attempt',
  'topic',
]);
export type AssistantEvidenceKindT = z.infer<typeof AssistantEvidenceKindSchema>;

/**
 * A single piece of evidence the AI grounded its answer in.
 * The retrieval layer is responsible for verifying the id exists
 * and the excerpt is server-rendered.
 */
export const AssistantEvidenceSchema = z.object({
  kind: AssistantEvidenceKindSchema,
  id: z.string().min(1).max(64),
  excerpt: z.string().min(1).max(200),
});
export type AssistantEvidenceT = z.infer<typeof AssistantEvidenceSchema>;

/**
 * A classification suggestion. The model is required to ground
 * the suggestion in at least one source id (the error itself or
 * a linked question); empty `sourceIds` is rejected.
 */
export const ClassificationSuggestionSchema = z.object({
  suggestedCategory: MistakeTypeSchema,
  rationale: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  sourceIds: z.array(z.string().min(1).max(64)).min(1).max(20),
});
export type ClassificationSuggestionT = z.infer<typeof ClassificationSuggestionSchema>;

/**
 * The two proposal kinds Phase 8 supports. Adding a third is a
 * Phase 8.X decision; for now this union is the entire surface.
 */
export const ProposalKindSchema = z.enum(['create_task', 'schedule_review']);
export type ProposalKindT = z.infer<typeof ProposalKindSchema>;

/**
 * The assistant proposal the student must confirm. The `payload`
 * shape is intentionally `z.record(z.unknown())` here because
 * each proposal kind has its own typed payload validated at the
 * domain service boundary (PlannerTaskInsert, ReviewScheduleInsert).
 * The proposer is responsible for building the right payload; the
 * model is not allowed to invent unknown keys.
 */
export const AssistantProposalSchema = z.object({
  id: z.string().min(1).max(64),
  kind: ProposalKindSchema,
  description: z.string().min(1).max(280),
  affectedRecords: z.array(z.string().min(1).max(64)).max(20),
  payload: z.record(z.unknown()),
  createdAt: z.number().int().positive(),
});
export type AssistantProposalT = z.infer<typeof AssistantProposalSchema>;

/**
 * The full assistant response. The `proposal` field is optional:
 * the model may answer a question without proposing a mutation.
 */
export const AssistantResponseSchema = z.object({
  answer: z.string().min(1).max(2000),
  sources: z.array(AssistantEvidenceSchema).max(20),
  proposal: AssistantProposalSchema.optional(),
});
export type AssistantResponseT = z.infer<typeof AssistantResponseSchema>;

/**
 * The response of `/errors/:id/classification-suggest`. The route
 * returns this object; the AI service produces the inner
 * `ClassificationSuggestion` after grounding in error evidence.
 *
 * The `candidateSourceIds` field is the list of evidence ids the
 * model was *allowed* to cite (the error itself, the linked
 * question, the topic, and the student's recent resolved errors
 * for that topic). The client UI uses this to verify every id
 * inside `suggestion.sourceIds` is a real, owned record — it is
 * the "no hallucinated evidence" guard surfaced to the user.
 */
export const ClassificationSuggestionResponseSchema = z.object({
  suggestion: ClassificationSuggestionSchema,
  candidateSourceIds: z.array(z.string().min(1).max(64)).min(1),
});
export type ClassificationSuggestionResponseT = z.infer<typeof ClassificationSuggestionResponseSchema>;

/**
 * The body of a student question submitted to `/assistant/queries`.
 * The question is required; the optional `context` is a free-form
 * string the student may use to disambiguate (e.g. "this is about
 * the JEE 2024 attempt"). The server does not interpret it.
 */
export const AssistantQueryBodySchema = z.object({
  question: z.string().min(1).max(2000),
  context: z.string().max(2000).optional(),
});
export type AssistantQueryBodyT = z.infer<typeof AssistantQueryBodySchema>;

/**
 * The body of a proposal confirmation. The student must send
 * `confirmed: true` to execute; `false` cleanly rejects without
 * running the domain service.
 */
export const ProposalConfirmBodySchema = z.object({
  confirmed: z.boolean(),
});
export type ProposalConfirmBodyT = z.infer<typeof ProposalConfirmBodySchema>;
