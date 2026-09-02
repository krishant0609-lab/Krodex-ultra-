/**
 * KRODEX web — student model hook.
 *
 * The student model is advisory. The hook is read-only; the only
 * writer is the scheduled orchestrator (or the service-role admin
 * recompute, which the web app does NOT call directly).
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { StudentModelSnapshotPayload } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export function useStudentModel(windowDays?: number) {
  return useQuery({
    queryKey: [...queryKeys.studentModel(), windowDays ?? 28],
    queryFn: () =>
      api.get<{ snapshot: StudentModelSnapshotPayload; windowDays: number }>(
        '/student-model',
        { query: windowDays !== undefined ? { window_days: windowDays } : {} },
      ),
    // 404 (no snapshot yet) is an expected cold-start; let the UI
    // render the empty state via `error.code === 'NOT_FOUND'`.
    retry: false,
  });
}
