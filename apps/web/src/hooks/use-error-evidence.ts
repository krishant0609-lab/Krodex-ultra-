/**
 * KRODEX web — Error evidence hooks (Phase 9).
 *
 * `useErrorEvidence(id)` returns the evidence row plus, when
 * available, a short-lived signed URL pointing at the private
 * snapshot binary. The URL is generated on every refetch and
 * expires per the server-configured TTL (default 1 hour).
 *
 * `useErrorEntryEvidence(id)` returns every evidence row linked
 * to the given error entry, newest first. The list response does
 * NOT include the signed URL — that's a per-row fetch the page
 * makes when the student clicks "view" on a row.
 *
 * `useErrorLifecycle(id)` returns the immutable state-transition
 * history for an error entry, newest first.
 *
 * The hooks are read-only at the moment: classification edits
 * still go through the existing `useUpdateErrorEntry` flow. The
 * evidence row is owned by the capture pipeline.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { ErrorEvidenceRow, ErrorLifecycleEventRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { fetchEvidence, type EvidenceDetail } from '../lib/evidence-client';
import { queryKeys } from '../lib/query-keys';

export function useErrorEvidence(evidenceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.evidence(evidenceId ?? ''),
    enabled: !!evidenceId,
    queryFn: () => fetchEvidenceById(evidenceId as string),
    // The signed URL expires; don't let the browser cache a stale
    // one past the server's TTL.
    staleTime: 60_000,
  });
}

function fetchEvidenceById(evidenceId: string): Promise<EvidenceDetail> {
  return fetchEvidence(evidenceId);
}

export function useErrorEntryEvidence(errorId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.errorEntryEvidence(errorId ?? ''),
    enabled: !!errorId,
    queryFn: () =>
      api.get<readonly ErrorEvidenceRow[]>(`/errors/${errorId}/evidence`),
  });
}

export function useErrorLifecycle(errorId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.errorLifecycle(errorId ?? ''),
    enabled: !!errorId,
    queryFn: () =>
      api.get<readonly ErrorLifecycleEventRow[]>(`/errors/${errorId}/lifecycle`),
  });
}
