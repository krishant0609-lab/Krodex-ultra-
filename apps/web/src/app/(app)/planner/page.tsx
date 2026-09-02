'use client';

/**
 * KRODEX web — Planner (index).
 *
 *   /planner
 *
 * Phase 7.9 visual layer:
 *  - Eyebrow "Planner", title "Tasks", and a calm
 *    description that names the purpose without fabrication.
 *  - A list of planner tasks. Each row shows: title,
 *    optional description, state badge, planned_minutes
 *    when set, and the plan date on the right.
 *  - Inline action row: "Complete" (planned/in_progress →
 *    completed), "Mark missed" (planned/in_progress →
 *    missed) — surfaced only when the corresponding
 *    transition is valid for the task's current state.
 *  - 7-state contract honored: loading, empty, error,
 *    populated. The empty state is honest: "No tasks
 *    planned yet" — we do not invent a starter task.
 *
 * Hooks used (no new server state):
 *  - usePlannerTasks({ limit: 100 })
 *  - useUpdatePlannerTask(id)
 *  - useMarkTaskMissed(id)
 */

import { PageShell } from '../../../components/page-shell';
import { Badge } from '../../../components/badge';
import { ApiError } from '../../../lib/api-client';
import {
  useMarkTaskMissed,
  usePlannerTasks,
  useUpdatePlannerTask,
} from '../../../hooks/use-planner';
import { formatShortDate } from '../../../lib/format-date';
import styles from './planner.module.css';

const STATE_TONES = {
  planned: 'lavender',
  in_progress: 'champagne',
  completed: 'success',
  partial: 'champagne',
  missed: 'rose',
  backlog: 'lavender',
  cancelled: 'lavender',
} as const;

type PlannerTaskState = keyof typeof STATE_TONES;

function excerpt(text: string | null): string {
  if (!text) return '';
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

function formatMinutes(min: number | null): string | null {
  if (min === null || min === undefined) return null;
  return `${min} min`;
}

interface TaskRowProps {
  task: {
    id: string;
    title: string;
    description: string | null;
    state: string;
    plan_date: string;
    planned_minutes: number | null;
  };
}

function TaskRow({ task }: TaskRowProps): JSX.Element {
  const update = useUpdatePlannerTask(task.id);
  const markMissed = useMarkTaskMissed(task.id);

  const state = task.state as PlannerTaskState;
  const stateTone = STATE_TONES[state] ?? 'lavender';
  const isOpen = state === 'planned' || state === 'in_progress';
  const minutesLabel = formatMinutes(task.planned_minutes);
  const planLabel = formatShortDate(task.plan_date) ?? '—';
  const desc = excerpt(task.description);

  const handleComplete = (): void => {
    update.mutate({ state: 'completed' });
  };

  const handleMissed = (): void => {
    markMissed.mutate();
  };

  return (
    <li
      className={styles.item}
      data-testid={`planner-task-${task.id}`}
    >
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <div className={styles.rowMeta}>
            <Badge tone={stateTone} size="sm">
              {task.state}
            </Badge>
            {minutesLabel ? (
              <span className={styles.rowMinutes}>{minutesLabel}</span>
            ) : null}
          </div>
          <h3 className={styles.rowTitle} data-testid={`planner-task-title-${task.id}`}>
            {task.title}
          </h3>
          {desc ? (
            <p className={styles.rowDescription}>{desc}</p>
          ) : (
            <p className={styles.rowDescriptionMuted}>
              No description recorded.
            </p>
          )}
          {isOpen ? (
            <div className={styles.actionsRow}>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
                onClick={handleComplete}
                disabled={update.isPending || markMissed.isPending}
                data-testid={`planner-task-complete-${task.id}`}
              >
                Complete
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={handleMissed}
                disabled={update.isPending || markMissed.isPending}
                data-testid={`planner-task-missed-${task.id}`}
              >
                Mark missed
              </button>
            </div>
          ) : null}
        </div>
        <div className={styles.rowAside}>
          <span className={styles.rowLabel}>Plan date</span>
          <span className={styles.rowDate}>{planLabel}</span>
        </div>
      </div>
    </li>
  );
}

export default function PlannerPage(): JSX.Element {
  const tasks = usePlannerTasks({ limit: 100 });
  const items = tasks.data?.items ?? [];
  const isEmpty = !tasks.isLoading && !tasks.isError && items.length === 0;

  return (
    <PageShell
      title="Tasks"
      eyebrow="Planner"
      description="Your agenda of planned study blocks. Mark a task complete when you finish it, or mark it missed to send it to the backlog."
      isLoading={tasks.isLoading}
      isError={tasks.isError}
      error={tasks.error}
      isEmpty={isEmpty}
      emptyTitle="No tasks planned yet"
      emptyMessage="When you schedule study time, it will appear here."
    >
      <ol className={styles.list} data-testid="planner-list">
        {items.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ol>
      {tasks.isError ? (
        <p className={styles.errorMeta} role="status">
          {tasks.error instanceof ApiError
            ? `${tasks.error.code} (${tasks.error.status})`
            : 'Could not load tasks.'}
        </p>
      ) : null}
    </PageShell>
  );
}
