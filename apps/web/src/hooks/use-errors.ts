/**
 * KRODEX web — error bank hooks.
 *
 * Each user maintains a list of error entries — records of mistakes
 * observed during attempts or captured manually. The error bank is
 * the source for review scheduling.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ErrorEntryRow, ErrorQuestionLinkRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export interface ListErrorEntriesParams {
  status?: 'active' | 'in_review' | 'resolved' | 'reopened' | 'archived';
  question_id?: string;
  cursor?: string | null;
  limit?: number;
}

export function useErrorEntries(params?: ListErrorEntriesParams) {
  return useQuery({
    queryKey: queryKeys.errors(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<ErrorEntryRow>('/errors', { query: { ...(params ?? {}) } }),
  });
}

export function useErrorEntry(errorId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.errorEntry(errorId ?? ''),
    enabled: !!errorId,
    queryFn: () => api.get<ErrorEntryRow>(`/errors/${errorId}`),
  });
}

export interface CreateErrorEntryInput {
  question_id?: string | null;
  mistake_type?:
    | 'concept'
    | 'calculation'
    | 'misread'
    | 'time_pressure'
    | 'careless'
    | 'method'
    | 'unknown'
    | null;
  remark?: string;
  source_attempt_id?: string | null;
  metadata?: Record<string, unknown>;
}

export function useCreateErrorEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateErrorEntryInput) =>
      api.post<ErrorEntryRow>('/errors', { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['errors'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export interface UpdateErrorEntryInput {
  status?: 'active' | 'in_review' | 'resolved' | 'reopened' | 'archived';
  mistake_type?:
    | 'concept'
    | 'calculation'
    | 'misread'
    | 'time_pressure'
    | 'careless'
    | 'method'
    | 'unknown'
    | null;
  remark?: string;
  recurrence_count?: number;
  metadata?: Record<string, unknown>;
}

export function useUpdateErrorEntry(errorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateErrorEntryInput) =>
      api.patch<ErrorEntryRow>(`/errors/${errorId}`, { body }),
    onSuccess: (entry) => {
      qc.setQueryData(queryKeys.errorEntry(errorId), entry);
      qc.invalidateQueries({ queryKey: ['errors'] });
      // Phase 9: status transitions append a row to the lifecycle
      // history, so any updated status invalidates the history view.
      // The evidence list is unrelated but cheap to refresh.
      qc.invalidateQueries({ queryKey: queryKeys.errorLifecycle(errorId) });
      qc.invalidateQueries({ queryKey: queryKeys.errorEntryEvidence(errorId) });
    },
  });
}

export function useLinkErrorQuestion(errorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { question_id: string }) =>
      api.post<ErrorQuestionLinkRow>(`/errors/${errorId}/questions`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.errorEntry(errorId) });
    },
  });
}
