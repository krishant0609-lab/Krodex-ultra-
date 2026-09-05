/**
 * KRODEX web — Phase 8 assistant hooks.
 *
 * Two mutations: one to ask the assistant a question, one to
 * confirm or reject a pending proposal. The assistant is
 * non-authoritative, so neither hook writes to the database on its
 * own — the `confirm` path delegates to the existing planner /
 * review domain services (via the API route), and the reject path
 * is a server-side no-op.
 *
 * The hooks invalidate the same query keys the corresponding
 * direct-mutation hooks do, so the UI's cache stays consistent
 * whether the student types a value into a form or accepts an AI
 * proposal. The Phase 8 invariant is "AI never writes; the route
 * dispatches to the same domain services the UI uses."
 */

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys';
import {
  assistantQuery,
  confirmProposal,
  type AssistantQueryResult,
  type ProposalConfirmationResult,
} from '../lib/ai-client';

export interface AskAssistantInput {
  question: string;
  context?: string;
}

/**
 * Ask the assistant a question. Returns the assistant's answer,
 * the evidence it cited, and the set of record ids it was allowed
 * to cite (for client-side verification of ownership).
 *
 * This is a mutation, not a query, because the request is
 * student-initiated POSTs and the answer is not cacheable across
 * users. We `invalidateQueries({ queryKey: ['assistant'] })` on
 * success so any page that wants to show recent questions
 * refetches.
 */
export function useAssistantQuery() {
  const qc = useQueryClient();
  return useMutation<
    AssistantQueryResult,
    Error,
    AskAssistantInput
  >({
    mutationFn: (input) => assistantQuery(input),
    onSuccess: () => {
      // The conversation history is a stub for Phase 8 (single-turn
      // only). When the page adds a "recent questions" list, that
      // key will be the one to invalidate. For now we just touch
      // the namespace so any listeners re-render.
      qc.invalidateQueries({ queryKey: ['assistant'] });
    },
  });
}

export interface ConfirmProposalInput {
  proposalId: string;
  confirmed: boolean;
}

/**
 * Confirm or reject a pending AI proposal. On `confirmed: true`,
 * the route dispatches the proposal to the matching domain
 * service (`createPlannerTask` or `scheduleReview`). On
 * `confirmed: false`, the proposal is removed from the in-process
 * TTL store and no mutation is performed.
 *
 * On success the hook invalidates the query keys the matching
 * domain-service hook would have invalidated, so the planner /
 * review pages see the new row.
 */
export function useProposalConfirm() {
  const qc = useQueryClient();
  return useMutation<
    ProposalConfirmationResult,
    Error,
    ConfirmProposalInput
  >({
    mutationFn: (input) => confirmProposal(input.proposalId, { confirmed: input.confirmed }),
    onSuccess: (result) => {
      if (!result.executed) return;
      // The route already wrote the row through the existing
      // service. Invalidate the matching list so the UI refetches.
      if (result.dispatched.kind === 'create_task') {
        qc.invalidateQueries({ queryKey: queryKeys.tasks() });
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.reviews() });
      }
      // The errors / notifications feeds also need to refresh —
      // scheduleReview writes a review state change and may
      // emit notifications.
      qc.invalidateQueries({ queryKey: ['errors'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
