/**
 * KRODEX web — test definition / attempt / answer hooks.
 *
 * Tests are user-authored or system-generated test definitions
 * with attached questions. An attempt is a run of one test by
 * one user; answers are recorded per-question; submission finalizes
 * the attempt and writes evidence + notifications + student-model
 * inputs.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TestAttemptRow,
  TestDefinitionRow,
  TestQuestionRow,
  TestAnswerRow,
} from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export interface ListTestDefinitionsParams {
  state?: 'created' | 'in_progress' | 'completed' | 'abandoned' | 'expired';
  source_kind?:
    | 'syllabus'
    | 'error_bank'
    | 'reviewed'
    | 'mixed'
    | 'manual'
    | 'captured';
  cursor?: string | null;
  limit?: number;
}

export function useTestDefinitions(params?: ListTestDefinitionsParams) {
  return useQuery({
    queryKey: queryKeys.tests(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<TestDefinitionRow>('/tests', { query: { ...(params ?? {}) } }),
  });
}

export function useTestDefinition(testId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.test(testId ?? ''),
    enabled: !!testId,
    queryFn: () => api.get<TestDefinitionRow>(`/tests/${testId}`),
  });
}

export function useTestQuestions(testId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.testQuestions(testId ?? ''),
    enabled: !!testId,
    queryFn: () =>
      api.get<readonly TestQuestionRow[]>(`/tests/${testId}/questions`),
  });
}

export interface CreateTestDefinitionInput {
  title: string;
  source_kind:
    | 'syllabus'
    | 'error_bank'
    | 'reviewed'
    | 'mixed'
    | 'manual'
    | 'captured';
  source_payload?: Record<string, unknown>;
  intended_count: number;
  duration_minutes?: number | null;
  metadata?: Record<string, unknown>;
}

export function useCreateTestDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTestDefinitionInput) =>
      api.post<TestDefinitionRow>('/tests', { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tests', 'definitions'] });
    },
  });
}

export interface UpdateTestDefinitionInput {
  title?: string;
  duration_minutes?: number | null;
  state?: 'created' | 'in_progress' | 'completed' | 'abandoned' | 'expired';
  metadata?: Record<string, unknown>;
}

export function useUpdateTestDefinition(testId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTestDefinitionInput) =>
      api.patch<TestDefinitionRow>(`/tests/${testId}`, { body }),
    onSuccess: (test) => {
      qc.setQueryData(queryKeys.test(testId), test);
      qc.invalidateQueries({ queryKey: ['tests', 'definitions'] });
    },
  });
}

export interface AttachTestQuestionInput {
  question_id: string;
  display_order: number;
}

export function useAttachTestQuestion(testId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AttachTestQuestionInput) =>
      api.post<TestQuestionRow>(`/tests/${testId}/questions`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.testQuestions(testId) });
    },
  });
}

export interface ListTestAttemptsParams {
  test_id?: string;
  state?: 'in_progress' | 'submitted' | 'timed_out' | 'abandoned';
  cursor?: string | null;
  limit?: number;
}

export function useTestAttempts(params?: ListTestAttemptsParams) {
  return useQuery({
    queryKey: queryKeys.attempts(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<TestAttemptRow>('/tests/attempts', {
        query: { ...(params ?? {}) },
      }),
  });
}

export function useTestAttempt(attemptId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.attempt(attemptId ?? ''),
    enabled: !!attemptId,
    queryFn: () => api.get<TestAttemptRow>(`/tests/attempts/${attemptId}`),
  });
}

export interface StartTestAttemptInput {
  test_id: string;
}

export function useStartTestAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartTestAttemptInput) =>
      api.post<TestAttemptRow>('/tests/attempts', { body }),
    onSuccess: (attempt) => {
      qc.invalidateQueries({ queryKey: ['tests', 'attempts'] });
      qc.invalidateQueries({ queryKey: queryKeys.test(attempt.test_id) });
    },
  });
}

export interface AnswerTestQuestionInput {
  question_id: string;
  selected_option_ids?: readonly string[];
  free_text?: string;
  duration_ms?: number | null;
}

export function useAnswerTestQuestion(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AnswerTestQuestionInput) =>
      api.post<TestAnswerRow>(`/tests/attempts/${attemptId}/answers`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.answers(attemptId) });
    },
  });
}

export function useTestAttemptAnswers(attemptId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.answers(attemptId ?? ''),
    enabled: !!attemptId,
    queryFn: () =>
      api.get<readonly TestAnswerRow[]>(`/tests/attempts/${attemptId}/answers`),
  });
}

export interface SubmitTestAttemptResult {
  attempt: TestAttemptRow;
  // Server may include derived fields; permissive record.
  [k: string]: unknown;
}

export function useSubmitTestAttempt(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<SubmitTestAttemptResult>(`/tests/attempts/${attemptId}/submit`, {}),
    onSuccess: (result) => {
      const attempt = (result as { attempt?: TestAttemptRow }).attempt;
      if (attempt) {
        qc.setQueryData(queryKeys.attempt(attemptId), attempt);
      }
      qc.invalidateQueries({ queryKey: ['tests', 'attempts'] });
      qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['student-model'] });
    },
  });
}
