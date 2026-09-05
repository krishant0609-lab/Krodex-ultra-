/**
 * KRODEX web — progress evidence hooks.
 *
 * The progress evidence feed is the raw, ordered history of every
 * signal the system has produced for the user. Pages render this
 * verbatim — no aggregates, no rollups.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { ProgressEvidenceRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export interface ListProgressEvidenceParams {
  dimension?: string;
  since?: string;
  until?: string;
  cursor?: string | null;
  limit?: number;
}

export function useProgressEvidence(params?: ListProgressEvidenceParams) {
  return useQuery({
    queryKey: queryKeys.progressEvidence(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<ProgressEvidenceRow>('/progress/evidence', {
        query: { ...(params ?? {}) },
      }),
  });
}
