/**
 * KRODEX web — review schedule hooks.
 *
 * The review scheduler picks the next due_at for each error
 * entry, records attempts, and finalizes outcomes.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewAttemptRow, ReviewScheduleRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export interface ListReviewSchedulesParams {
  state?: 'scheduled' | 'due' | 'completed' | 'skipped' | 'overdue';
  due_before?: string;
  cursor?: string | null;
  limit?: number;
}

export function useReviewSchedules(params?: ListReviewSchedulesParams) {
  return useQuery({
    queryKey: queryKeys.reviews(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<ReviewScheduleRow>('/review/schedules', {
        query: { ...(params ?? {}) },
      }),
  });
}

export function useReviewSchedule(scheduleId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.review(scheduleId ?? ''),
    enabled: !!scheduleId,
    queryFn: () => api.get<ReviewScheduleRow>(`/review/schedules/${scheduleId}`),
  });
}

export interface ScheduleReviewInput {
  error_id: string;
  strategy?: 'standard' | 'spaced' | 'focused' | 'retest_only';
  due_at: string;
  metadata?: Record<string, unknown>;
}

export function useScheduleReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduleReviewInput) =>
      api.post<ReviewScheduleRow>('/review/schedules', { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review', 'schedules'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export interface UpdateReviewScheduleInput {
  state?: 'scheduled' | 'due' | 'completed' | 'skipped' | 'overdue';
  due_at?: string;
  outcome?: 'passed' | 'failed' | 'skipped' | 'partial';
  strategy?: 'standard' | 'spaced' | 'focused' | 'retest_only';
  metadata?: Record<string, unknown>;
}

export function useUpdateReviewSchedule(scheduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateReviewScheduleInput) =>
      api.patch<ReviewScheduleRow>(`/review/schedules/${scheduleId}`, { body }),
    onSuccess: (schedule) => {
      qc.setQueryData(queryKeys.review(scheduleId), schedule);
      qc.invalidateQueries({ queryKey: ['review', 'schedules'] });
    },
  });
}

export interface RecordReviewAttemptInput {
  schedule_id: string;
  question_id: string;
  outcome: 'passed' | 'failed' | 'skipped' | 'partial';
  selected_option_ids: readonly string[];
  free_text?: string | null;
  duration_ms?: number | null;
}

export function useRecordReviewAttempt(scheduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordReviewAttemptInput) =>
      api.post<ReviewAttemptRow>(`/review/schedules/${scheduleId}/attempts`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.review(scheduleId) });
      qc.invalidateQueries({ queryKey: ['review', 'schedules'] });
      qc.invalidateQueries({ queryKey: ['errors'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
    },
  });
}
