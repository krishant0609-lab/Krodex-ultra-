/**
 * KRODEX web — typed AI client.
 *
 * Thin domain wrapper over `lib/api-client` for the three Phase 8
 * endpoints. Keeps the path strings + return shapes in one place so
 * the React hooks and the future /assistant page don't repeat
 * them.
 *
 * The base URL and auth header are handled by `api`. This module
 * only deals with the AI request/response shapes.
 *
 * Per Phase 8 plan §5, the AI surface is:
 *   - POST /assistant/queries                    — Q&A grounded in own records
 *   - POST /assistant/proposals/:id/confirm      — confirm or reject a proposal
 *   - POST /errors/:id/classification-suggest    — non-authoritative suggestion
 *
 * The AI is non-authoritative: it suggests and proposes, the student
 * decides. The confirm endpoint is the only one that mutates; it
 * runs the mutation through the existing domain services
 * (createPlannerTask, scheduleReview) — never through AI code.
 */

import type {
  AssistantProposal,
  AssistantResponse,
  ClassificationSuggestionResponse,
} from '@krodex/shared';

import { api } from './api-client';

/**
 * The shape returned by `POST /assistant/queries`. The route
 * returns the assistant response plus the set of record ids the
 * model was allowed to cite; the UI uses the latter to verify each
 * citation is owned by the student.
 */
export interface AssistantQueryResult {
  response: AssistantResponse;
  candidateSourceIds: readonly string[];
}

/**
 * The shape returned by `POST /assistant/proposals/:id/confirm`.
 *
 * When the student rejects the proposal, `executed` is `false` and
 * `proposal` is the rejected proposal back from the server (the
 * orchestrator already removed it from the in-process TTL store).
 *
 * When the student confirms, `executed` is `true` and `dispatched`
 * carries the id of the row the matching domain service wrote. The
 * dispatched row is reachable through the existing planner / review
 * hooks.
 */
export type ProposalConfirmationResult =
  | {
      executed: false;
      proposal: AssistantProposal;
    }
  | {
      executed: true;
      proposal: AssistantProposal;
      dispatched:
        | { kind: 'create_task'; taskId: string }
        | { kind: 'schedule_review'; reviewId: string };
    };

/**
 * Submit a free-form question to the assistant. The body shape
 * matches the server's `AssistantQueryBodySchema`; the response
 * includes the assistant's answer, the evidence it cited, and the
 * set of record ids it was allowed to cite.
 *
 * Errors come back as `ApiError` with `code: 'DEPENDENCY_UNAVAILABLE'`
 * or `code: 'AI_OUTPUT_INVALID'` (both transient — the UI should
 * show the deterministic fallback surface).
 */
export function assistantQuery(body: {
  question: string;
  context?: string;
}): Promise<AssistantQueryResult> {
  return api.post<AssistantQueryResult>('/assistant/queries', { body });
}

/**
 * Confirm or reject a pending AI proposal. `confirmed: false` is a
 * no-op on the database; `confirmed: true` runs the proposal
 * through the existing domain service. Returns the executed
 * dispatch on confirm, or the rejected proposal on reject.
 */
export function confirmProposal(
  proposalId: string,
  body: { confirmed: boolean },
): Promise<ProposalConfirmationResult> {
  return api.post<ProposalConfirmationResult>(
    `/assistant/proposals/${encodeURIComponent(proposalId)}/confirm`,
    { body },
  );
}

/**
 * Ask the AI to suggest a classification for an error. The
 * suggestion is non-authoritative: the student must accept or
 * override it before the category is written. The error endpoint
 * never mutates the row.
 */
export function classificationSuggest(
  errorId: string,
): Promise<ClassificationSuggestionResponse & { candidateSourceIds: readonly string[] }> {
  return api.post<
    ClassificationSuggestionResponse & { candidateSourceIds: readonly string[] }
  >(`/errors/${encodeURIComponent(errorId)}/classification-suggest`, {});
}
