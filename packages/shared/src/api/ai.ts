/**
 * KRODEX — Phase 8 AI assistant contracts.
 *
 * These types are the wire/contract surface for the non-authoritative
 * AI assistance layer. They are pure types (no runtime, no Zod
 * dependency) so both apps/api (provider adapter, Zod-validated
 * server-side) and apps/web (typed client) can reference them
 * without pulling in the validation library at the shared layer.
 *
 * Per Phase 8 plan §3 (Dependencies on Phase 0–7 Outputs) and
 * §8 (AI Behavior and Boundaries):
 *   - AI never writes to the database. Every mutation goes through
 *     the same domain services used by the normal UI, after
 *     explicit student confirmation or a previously enabled
 *     automation policy.
 *   - The AI may only suggest, propose, and answer — it is the
 *     student who accepts.
 *
 * The Zod schemas that validate these payloads at the API boundary
 * live in apps/api/src/ai/schemas.ts. The shared package exposes
 * only the types so apps/web can use them without a Zod runtime.
 */

import type { MistakeType } from '../db/enums';

/**
 * The kinds of evidence the assistant is allowed to cite in its
 * answer. The retrieval layer (apps/api/src/ai/assistant.ts) is
 * responsible for actually fetching each cited record before the
 * response is returned to the client.
 */
export type AssistantEvidenceKind = 'error' | 'review' | 'attempt' | 'topic';

/**
 * A single piece of evidence the AI grounded its answer in.
 *
 * `id` is the canonical id of the record (ErrorEntryRow.id,
 * ReviewScheduleRow.id, etc.). The retrieval layer resolves the
 * `excerpt` server-side; the model never invents excerpts.
 */
export interface AssistantEvidence {
  kind: AssistantEvidenceKind;
  id: string;
  /** Short, server-rendered excerpt. Capped at 200 chars server-side. */
  excerpt: string;
}

/**
 * The non-authoritative classification suggestion returned by
 * the AI for a single Error entry. The student must confirm or
 * override before the suggested category is persisted.
 *
 * `sourceIds` is the list of evidence ids the model used (questions
 * linked to the error, the error itself, the topic tree path). The
 * UI shows these so the student can audit the suggestion.
 */
export interface ClassificationSuggestion {
  /** Must be a valid MistakeType. Server-side Zod enforces. */
  suggestedCategory: MistakeType;
  /** Human-readable rationale. Capped at 500 chars server-side. */
  rationale: string;
  /** 0.0–1.0. Server-side Zod enforces. */
  confidence: number;
  /** Evidence ids used to produce the suggestion. */
  sourceIds: readonly string[];
}

/**
 * The kind of mutation a proposal can request. Phase 8 supports
 * only `create_task` and `schedule_review`. Adding more in a later
 * phase requires updating the Zod schema, the proposer routing
 * table, and the proposal UI.
 */
export type ProposalKind = 'create_task' | 'schedule_review';

/**
 * A mutation proposal the assistant generated in response to a
 * student question. The proposal is stored in an in-process
 * `Map<id, Proposal>` with a 30-minute TTL. The student must
 * explicitly confirm before the mutation runs.
 *
 * The `payload` is the exact shape the relevant domain service
 * accepts. The proposer is responsible for assembling it from the
 * grounded evidence; the model never invents ids.
 */
export interface AssistantProposal {
  /** Server-generated id; opaque to the client. */
  id: string;
  kind: ProposalKind;
  /** Short, student-facing description of what will happen. */
  description: string;
  /** Records the proposal will affect, surfaced to the student. */
  affectedRecords: readonly string[];
  /**
   * Service-ready payload, validated against the receiving domain
   * service's insert shape. For `create_task` this is the
   * PlannerTaskInsert shape; for `schedule_review` this is the
   * ReviewScheduleInsert shape.
   */
  payload: Readonly<Record<string, unknown>>;
  /**
   * Epoch milliseconds when the proposal was created. Used by the
   * proposer to enforce the 30-minute TTL.
   */
  createdAt: number;
}

/**
 * What the assistant returns to the client for an `/assistant/queries`
 * request. If the assistant decided to propose a mutation, `proposal`
 * is set; the client surfaces the proposal for explicit confirmation.
 */
export interface AssistantResponse {
  /** Plain-text answer, capped at 2000 chars server-side. */
  answer: string;
  /** Evidence the model grounded its answer in. */
  sources: readonly AssistantEvidence[];
  /** Optional mutation proposal awaiting confirmation. */
  proposal?: AssistantProposal;
}

/**
 * What the assistant returns for an `/errors/:id/classification-suggest`
 * request. The category is non-authoritative — the student must accept
 * or override it before it is written to the database.
 */
export interface ClassificationSuggestionResponse {
  suggestion: ClassificationSuggestion;
}

/**
 * The outcome of a proposal confirmation. The mutation either ran
 * via the relevant domain service (returning its result) or the
 * student rejected the proposal (no mutation).
 */
export interface ProposalConfirmationResult {
  executed: boolean;
  /**
   * Domain service result when `executed` is true. The shape is
   * the relevant Insert row (PlannerTaskRow, ReviewScheduleRow).
   */
  mutationResult?: Readonly<Record<string, unknown>>;
}
