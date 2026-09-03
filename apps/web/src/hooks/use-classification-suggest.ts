/**
 * KRODEX web — Phase 8 classification suggestion hook.
 *
 * Asks the AI for a non-authoritative classification of an error.
 * The student must accept (write `mistake_type` via the existing
 * PATCH /errors/:id) or override (pick a category manually). The
 * hook never mutates the error — the AI returns a suggestion, the
 * student decides, the existing `useUpdateErrorEntry` writes the
 * final value.
 *
 * The endpoint is `/errors/:id/classification-suggest`, not the
 * AI-only `/assistant/queries`, because the request is error-bound
 * and the response shape is the dedicated classification envelope.
 */

'use client';

import { useMutation } from '@tanstack/react-query';
import type { ClassificationSuggestionResponse } from '@krodex/shared';
import { classificationSuggest } from '../lib/ai-client';

export interface ClassificationSuggestResult
  extends ClassificationSuggestionResponse {
  /**
   * Record ids the AI was *allowed* to cite. The UI uses this to
   * verify that every `suggestion.sourceIds` entry is owned by
   * the student — the "no hallucinated evidence" guard surfaced
   * to the user.
   */
  candidateSourceIds: readonly string[];
}

/**
 * Request a non-authoritative classification suggestion for one
 * error. The mutation is keyed by error id so two pages can call
 * it for different errors without one overwriting the other's
 * result.
 */
export function useClassificationSuggest(errorId: string | null | undefined) {
  return useMutation<
    ClassificationSuggestResult,
    Error,
    void
  >({
    // The mutation key is not used by the server, but tagging the
    // mutation with the error id lets two concurrent pages
    // distinguish their pending states.
    mutationKey: ['classification-suggest', errorId ?? ''],
    mutationFn: () => {
      // The `enabled` flag is a query-only concept; mutations
      // need an explicit guard. We short-circuit before the
      // fetch so a caller that mounts this hook with a null
      // errorId does not perform any network work — the throw
      // is what `mutateAsync` catches and the UI surfaces as
      // a "not yet loaded" state.
      if (!errorId) {
        return Promise.reject(new Error('errorId is required'));
      }
      return classificationSuggest(errorId);
    },
  });
}
