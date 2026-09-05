'use client';

/**
 * KRODEX web — Task-miss banner (Phase 11).
 *
 * The list page's calm hero. It shows the count of overdue
 * tasks (planned or in_progress whose plan_date is in the
 * past) and offers a single action: "Scan for missed tasks"
 * which posts to /planner/check-missed.
 *
 * The banner is honest about the result: after a scan, the
 * page reflects the freshly-missed tasks + new backlog
 * items via TanStack Query invalidation. We do not display
 * a celebratory success message — the count badge is the
 * signal.
 *
 * The banner is opt-in: it only renders if there is at
 * least one overdue task OR the user explicitly wants to
 * scan. It does not run a scan on mount.
 */

import { useMemo, useState } from 'react';
import { useCheckMissedPlannerTasks } from '../../../../hooks/use-planner-automation';
import { ApiError } from '../../../../lib/api-client';
import type { PlannerTaskRow } from '@krodex/shared';
import { formatShortDate } from '../../../../lib/format-date';
import styles from './task-miss-banner.module.css';

interface Props {
  tasks: readonly PlannerTaskRow[];
  /** ISO timestamp; tasks before this are overdue. */
  now: string;
}

function isOverdue(task: PlannerTaskRow, nowIso: string): boolean {
  if (task.state !== 'planned' && task.state !== 'in_progress') return false;
  const planDate = new Date(`${task.plan_date}T23:59:59Z`);
  const now = new Date(nowIso);
  if (Number.isNaN(planDate.getTime()) || Number.isNaN(now.getTime())) return false;
  return planDate.getTime() < now.getTime();
}

export function TaskMissBanner({ tasks, now }: Props): JSX.Element | null {
  const checkMissed = useCheckMissedPlannerTasks();
  const [lastResult, setLastResult] = useState<string | null>(null);

  const overdueTasks = useMemo(
    () => tasks.filter((t) => isOverdue(t, now)),
    [tasks, now],
  );

  if (overdueTasks.length === 0 && !lastResult) return null;

  const handleScan = (): void => {
    checkMissed.mutate(
      {},
      {
        onSuccess: (data) => {
          const newly = data.newlyMissed.length;
          const already = data.alreadyMissed.length;
          setLastResult(
            `Scan complete — ${newly} newly missed, ${already} already in the backlog.`,
          );
        },
      },
    );
  };

  return (
    <section
      className={styles.banner}
      data-testid="task-miss-banner"
    >
      <div className={styles.body}>
        <h2 className={styles.title}>
          {overdueTasks.length} overdue task
          {overdueTasks.length === 1 ? '' : 's'}
        </h2>
        <p className={styles.description}>
          {overdueTasks.length === 0
            ? 'No overdue tasks remain after the last scan.'
            : 'Anything in the past that you did not complete will be moved to the backlog and counted as missed.'}
        </p>
        {lastResult ? (
          <p className={styles.result} data-testid="task-miss-result">
            {lastResult}
          </p>
        ) : null}
        {checkMissed.isError ? (
          <p className={styles.errorMeta} role="status">
            {checkMissed.error instanceof ApiError
              ? `${checkMissed.error.code} (${checkMissed.error.status})`
              : 'Scan failed.'}
          </p>
        ) : null}
        <ul className={styles.list}>
          {overdueTasks.slice(0, 5).map((task) => (
            <li
              key={task.id}
              className={styles.item}
              data-testid={`task-miss-item-${task.id}`}
            >
              <span className={styles.itemTitle}>{task.title}</span>
              <span className={styles.itemDate}>
                {formatShortDate(task.plan_date) ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={handleScan}
          disabled={checkMissed.isPending}
          data-testid="task-miss-scan"
        >
          {checkMissed.isPending ? 'Scanning…' : 'Scan for missed tasks'}
        </button>
      </div>
    </section>
  );
}
