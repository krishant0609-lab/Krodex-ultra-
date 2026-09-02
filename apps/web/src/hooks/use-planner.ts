/**
 * KRODEX web — planner (tasks + templates) hooks.
 *
 * Tasks are scheduled activities; templates are reusable activity
 * bundles. Marking a task missed creates a backlog item.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BacklogItemRow, PlannerTaskRow, PlannerTemplateRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export interface ListPlannerTasksParams {
  state?: 'planned' | 'in_progress' | 'completed' | 'skipped' | 'missed';
  plan_date?: string;
  subject_id?: string;
  cursor?: string | null;
  limit?: number;
}

export function usePlannerTasks(params?: ListPlannerTasksParams) {
  return useQuery({
    queryKey: queryKeys.tasks(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<PlannerTaskRow>('/planner/tasks', {
        query: { ...(params ?? {}) },
      }),
  });
}

export function usePlannerTask(taskId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    enabled: !!taskId,
    queryFn: () => api.get<PlannerTaskRow>(`/planner/tasks/${taskId}`),
  });
}

export interface CreatePlannerTaskInput {
  template_id?: string | null;
  plan_date: string;
  title: string;
  description?: string;
  subject_id?: string | null;
  topic_id?: string | null;
  sub_topic_id?: string | null;
  planned_minutes?: number | null;
  metadata?: Record<string, unknown>;
}

export function useCreatePlannerTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePlannerTaskInput) =>
      api.post<PlannerTaskRow>('/planner/tasks', { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
    },
  });
}

export interface UpdatePlannerTaskInput {
  title?: string;
  description?: string;
  state?: 'planned' | 'in_progress' | 'completed' | 'skipped' | 'missed';
  planned_minutes?: number | null;
  actual_minutes?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
}

export function useUpdatePlannerTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePlannerTaskInput) =>
      api.patch<PlannerTaskRow>(`/planner/tasks/${taskId}`, { body }),
    onSuccess: (task) => {
      qc.setQueryData(queryKeys.task(taskId), task);
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
      // Completing a task writes progress evidence + notifications.
      if (task.state === 'completed') {
        qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
        qc.invalidateQueries({ queryKey: ['notifications'] });
      }
    },
  });
}

export function useMarkTaskMissed(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ task: PlannerTaskRow; backlog: BacklogItemRow | null }>(
        `/planner/tasks/${taskId}/missed`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['backlog'] });
      qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
    },
  });
}

export function usePlannerTemplates() {
  return useQuery({
    queryKey: queryKeys.templates(),
    queryFn: () =>
      api.get<readonly PlannerTemplateRow[]>('/planner/templates'),
  });
}

export interface CreatePlannerTemplateInput {
  name: string;
  is_default?: boolean;
  template_payload: Record<string, unknown>;
}

export function useCreatePlannerTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePlannerTemplateInput) =>
      api.post<PlannerTemplateRow>('/planner/templates', { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner', 'templates'] });
    },
  });
}

export interface UpdatePlannerTemplateInput {
  name?: string;
  is_default?: boolean;
  template_payload?: Record<string, unknown>;
}

export function useUpdatePlannerTemplate(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePlannerTemplateInput) =>
      api.patch<PlannerTemplateRow>(`/planner/templates/${templateId}`, { body }),
    onSuccess: (template) => {
      qc.setQueryData(queryKeys.template(templateId), template);
      qc.invalidateQueries({ queryKey: ['planner', 'templates'] });
    },
  });
}
