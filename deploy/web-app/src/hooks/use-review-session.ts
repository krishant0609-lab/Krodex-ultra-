/**
 * KRODEX web — review session hooks (Phase 10).
 *
 * The review session is the new three-step flow:
 *
 *   1. `start`     — POST /reviews/:id/start
 *      Moves the schedule to `in_progress`, transitions the
 *      error to `in_review`, picks a fresh verification
 *      question, and returns the picked question.
 *
 *   2. `verification` — GET /reviews/:id/verification-question
 *      Re-fetches the deterministic verification question for
 *      this session. The selector is stable across calls until
 *      the student POSTs an outcome (which "uses up" the picked
 *      question).
 *
 *   3. `outcome`   — POST /reviews/:id/outcome
 *      Records the outcome of the verification question and
 *      returns the error transition + the next-review decision
 *      (or null if the error was resolved).
 *
 * The session hook is a thin wrapper over three React Query
 * mutations + one query. The page composes them into a single
 * state machine: idle → started → answered → terminal.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export type VerificationQuestion =
  | { kind: 'found'; questionId: string; difficulty: number }
  | { kind: 'none' };

export type SessionOutcome = 'correct' | 'incorrect' | 'partial';

export interface StartReviewResult {
  schedule: {
    id: string;
    state: string;
    [k: string]: unknown;
  };
  errorTransition: { fromStatus: string; toStatus: string };
  verification: VerificationQuestion;
}

export interface ReviewLifecycleEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  trigger: string;
  reason: string | null;
  review_id: string | null;
  created_at: string;
}

export interface OutcomeResult {
  outcomeId: string;
  errorTransition: { fromStatus: string; toStatus: string };
  nextReviewScheduled: boolean;
  nextReview: {
    dueAt: string;
    reasonCode: string;
    reasonText: string;
    confidence: number;
    requiresConfirmation: boolean;
  } | null;
  terminalOutcome: SessionOutcome;
}

export interface StartReviewInput {
  commandId?: string;
}

export interface RecordOutcomeInput {
  questionId: string;
  outcome: SessionOutcome;
  selectedOptionIds?: readonly string[];
  freeText?: string | null;
  durationMs?: number | null;
  commandId?: string;
}

/**
 * Start (or resume) the review session for one schedule.
 * Returns the picked verification question in the response
 * payload. The mutation invalidates the schedule query so the
 * page refetches the new `in_progress` state.
 */
export function useStartReview(reviewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartReviewInput = {}) =>
      api.post<StartReviewResult>(`/reviews/${reviewId}/start`, {
        body,
        ...(body.commandId ? { idempotencyKey: body.commandId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.review(reviewId) });
      qc.invalidateQueries({ queryKey: queryKeys.reviews() });
      qc.invalidateQueries({ queryKey: ['errors'] });
    },
  });
}

/**
 * GET the most recent verification question for this session.
 * Re-running the deterministic selector always returns the
 * same `questionId` until the student POSTs an outcome (which
 * "consumes" the question and triggers a fresh pick).
 */
export function useReviewVerificationQuestion(
  reviewId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...queryKeys.review(reviewId ?? ''), 'verification-question'],
    enabled: !!reviewId && enabled,
    queryFn: () =>
      api.get<VerificationQuestion>(
        `/reviews/${reviewId}/verification-question`,
      ),
  });
}

/**
 * POST the outcome of the verification question. Wrapped in
 * `withIdempotency` on the server; the client may pass an
 * `Idempotency-Key` via `commandId` for retry-safety.
 */
export function useRecordReviewOutcome(reviewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordOutcomeInput) =>
      api.post<OutcomeResult>(`/reviews/${reviewId}/outcome`, {
        body,
        ...(body.commandId ? { idempotencyKey: body.commandId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.review(reviewId) });
      qc.invalidateQueries({ queryKey: queryKeys.reviews() });
      qc.invalidateQueries({ queryKey: ['errors'] });
      qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
    },
  });
}

/**
 * GET the immutable lifecycle history for the error attached
 * to this schedule. Convenience alias for the route that the
 * page already fetches on the error detail page.
 */
export function useReviewLifecycle(reviewId: string | null | undefined) {
  return useQuery({
    queryKey: [...queryKeys.review(reviewId ?? ''), 'lifecycle'],
    enabled: !!reviewId,
    queryFn: () =>
      api.get<readonly ReviewLifecycleEvent[]>(`/reviews/${reviewId}/lifecycle`),
  });
}
