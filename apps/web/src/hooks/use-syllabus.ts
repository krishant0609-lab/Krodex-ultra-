/**
 * KRODEX web — syllabus hooks.
 *
 * The syllabus surface is the read-mostly taxonomy
 * (subjects → topics → sub-topics → questions) plus a per-user
 * progress table. Cached aggressively because the taxonomy
 * rarely changes.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  QuestionOptionRow,
  QuestionRow,
  SubjectRow,
  SubTopicRow,
  SyllabusProgressRow,
  TopicRow,
} from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export function useSubjects() {
  return useQuery({
    queryKey: queryKeys.subjects(),
    queryFn: () => api.get<readonly SubjectRow[]>('/syllabus/subjects'),
  });
}

export function useTopics(params?: { subject_id?: string; parent_topic_id?: string | null }) {
  // queryKeys.topics expects { subjectId, parentTopicId }; map our
  // server-side snake_case param shape onto the camelCase key shape.
  const keyParams = params
    ? { subjectId: params.subject_id, parentTopicId: params.parent_topic_id }
    : undefined;
  return useQuery({
    queryKey: queryKeys.topics(keyParams),
    queryFn: () =>
      api.get<readonly TopicRow[]>('/syllabus/topics', {
        query: {
          subject_id: params?.subject_id,
          parent_topic_id: params?.parent_topic_id,
        },
      }),
  });
}

export function useSubTopics(topicId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.subTopics(topicId ?? ''),
    enabled: !!topicId,
    queryFn: () =>
      api.get<readonly SubTopicRow[]>('/syllabus/sub-topics', {
        query: { topic_id: topicId },
      }),
  });
}

export interface ListQuestionsParams {
  subject_id?: string;
  topic_id?: string;
  sub_topic_id?: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'olympiad';
  type?:
    | 'single_mcq'
    | 'multi_mcq'
    | 'numerical'
    | 'short_answer'
    | 'true_false'
    | 'assertion_reason'
    | 'comprehension';
  cursor?: string | null;
  limit?: number;
}

export function useQuestions(params?: ListQuestionsParams) {
  return useQuery({
    queryKey: queryKeys.questions(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<QuestionRow>('/syllabus/questions', {
        query: { ...(params ?? {}) },
      }),
  });
}

export function useQuestionOptions(questionId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.questionOptions(questionId ?? ''),
    enabled: !!questionId,
    queryFn: () =>
      api.get<readonly QuestionOptionRow[]>(`/syllabus/questions/${questionId}/options`),
  });
}

export interface ListSyllabusProgressParams {
  scope?: 'subject' | 'topic' | 'sub_topic' | 'global';
  cursor?: string | null;
  limit?: number;
}

export function useSyllabusProgress(params?: ListSyllabusProgressParams) {
  return useQuery({
    queryKey: queryKeys.syllabusProgress({ scope: params?.scope }),
    queryFn: () =>
      api.getPage<SyllabusProgressRow>('/syllabus/progress', {
        query: { ...(params ?? {}) },
      }),
  });
}

export interface UpsertSyllabusProgressInput {
  scope: 'subject' | 'topic' | 'sub_topic' | 'global';
  scope_id?: string | null;
  coverage_state?: 'not_started' | 'in_progress' | 'covered' | 'needs_review';
  last_activity_at?: string | null;
}

export function useUpsertSyllabusProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertSyllabusProgressInput) =>
      api.put<SyllabusProgressRow>('/syllabus/progress', { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['syllabus', 'progress'] });
      qc.invalidateQueries({ queryKey: queryKeys.subjects() });
      qc.invalidateQueries({ queryKey: ['syllabus', 'topics'] });
    },
  });
}
