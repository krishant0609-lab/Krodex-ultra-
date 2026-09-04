/**
 * KRODEX web — planner automation hooks (Phase 11).
 *
 * Wires up the new /planner/check-missed, /planner/tasks/:id/partial,
 * /planner/tasks/:id/reschedule, /planner/tasks/:id/history,
 * /planner/backlog/recovery-suggestions, and
 * /planner/backlog/recover/:id endpoints. Mutations invalidate the
 * tasks / backlog / progress caches the same way the existing
 * `use-planner.ts` hooks do.
 *
 * The result shapes mirror the Fastify envelope, so each hook
 * returns a typed `data` object.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BacklogItemRow,
  PlannerTaskEventRow,
  PlannerTaskRow,
} from '@krodex/shared';
import { api } from '../lib/api-client';

export interface CheckMissedResult {
  scannedAt: string;
  newlyMissed: PlannerTaskRow[];
  alreadyMissed: PlannerTaskRow[];
  createdBacklogItemIds: string[];
}

export function useCheckMissedPlannerTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { scanBefore?: string } = {}) =>
      api.post<CheckMissedResult>('/planner/check-missed', { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['backlog'] });
      qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
    },
  });
}

export interface MarkPartialInput {
  actualDurationMinutes?: number | null;
  reason?: string | null;
}

export interface MarkPartialResult {
  task: PlannerTaskRow;
  backlogItem: BacklogItemRow | null;
}

export function useMarkTaskPartial(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MarkPartialInput = {}) =>
      api.post<MarkPartialResult>(`/planner/tasks/${taskId}/partial`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['backlog'] });
      qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
    },
  });
}

export interface RescheduleTaskInput {
  newDueAt: string;
  reason?: string | null;
}

export interface RescheduleTaskResult {
  originalTask: PlannerTaskRow;
  newTask: PlannerTaskRow;
  event: PlannerTaskEventRow;
}

export function useReschedulePlannerTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RescheduleTaskInput) =>
      api.post<RescheduleTaskResult>(`/planner/tasks/${taskId}/reschedule`, {
        body: { new_due_at: body.newDueAt, reason: body.reason ?? undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['backlog'] });
    },
  });
}

export function usePlannerTaskHistory(
  taskId: string | null | undefined,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['planner', 'tasks', taskId, 'history'] as const,
    enabled: !!taskId && enabled,
    queryFn: () =>
      api.get<readonly PlannerTaskEventRow[]>(
        `/planner/tasks/${taskId}/history`,
      ),
  });
}

export interface RecoverySuggestion {
  backlogItemId: string;
  reason: string;
  suggestedAction: 'reschedule' | 'complete' | 'dismiss';
  ageDays: number;
  sourceTaskId: string | null;
}

export interface RecoverySuggestionsResult {
  suggestions: RecoverySuggestion[];
}

export function useRecoverySuggestions(limit: number = 20) {
  return useQuery({
    queryKey: ['planner', 'backlog', 'recovery-suggestions', limit] as const,
    queryFn: () =>
      api.get<RecoverySuggestionsResult>(
        '/planner/backlog/recovery-suggestions',
        { query: { limit } },
      ),
  });
}

export type RecoveryAction = 'reschedule' | 'complete' | 'dismiss' | 'split';

export interface RecoverPlannerBacklogInput {
  action: RecoveryAction;
  newDueAt?: string;
  reason?: string | null;
}

export interface RecoverPlannerBacklogResult {
  backlogItem: BacklogItemRow;
  newTask: PlannerTaskRow | null;
  recoveryEventId: string | null;
}

export function useRecoverPlannerBacklog(backlogId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecoverPlannerBacklogInput) =>
      api.post<RecoverPlannerBacklogResult>(
        `/planner/backlog/recover/${backlogId}`,
        {
          body: {
            action: body.action,
            ...(body.newDueAt ? { new_due_at: body.newDueAt } : {}),
            reason: body.reason ?? undefined,
          },
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['backlog'] });
      qc.invalidateQueries({ queryKey: ['progress', 'evidence'] });
    },
  });
}
