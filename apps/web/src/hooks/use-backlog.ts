/**
 * KRODEX web — backlog hooks.
 *
 * Backlog items are missed tasks that the user can recover (re-schedule)
 * or drop. The backlog is the bridge between planner and the rest of
 * the system.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BacklogItemRow, BacklogRecoveryRow, PlannerTaskRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export interface ListBacklogItemsParams {
  state?: 'open' | 'recovered' | 'dropped' | 'resolved';
  reason?: 'missed' | 'abandoned' | 'overdue' | 'manual';
  cursor?: string | null;
  limit?: number;
}

export function useBacklogItems(params?: ListBacklogItemsParams) {
  return useQuery({
    queryKey: queryKeys.backlog(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<BacklogItemRow>('/backlog', { query: { ...(params ?? {}) } }),
  });
}

export function useBacklogItem(itemId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.backlogItem(itemId ?? ''),
    enabled: !!itemId,
    queryFn: () => api.get<BacklogItemRow>(`/backlog/${itemId}`),
  });
}

export interface RecoverBacklogItemInput {
  plan_date?: string;
  notes?: string;
}

export interface RecoverBacklogItemResult {
  backlog: BacklogItemRow;
  recovered_task: PlannerTaskRow;
  recovery: BacklogRecoveryRow;
}

export function useRecoverBacklogItem(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecoverBacklogItemInput) =>
      api.post<RecoverBacklogItemResult>(`/backlog/${itemId}/recover`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backlog'] });
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
    },
  });
}

export function useDropBacklogItem(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<BacklogItemRow>(`/backlog/${itemId}/drop`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backlog'] });
    },
  });
}
