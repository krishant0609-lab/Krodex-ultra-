'use client';

/**
 * KRODEX web — Task history timeline (Phase 11).
 *
 * Renders the immutable `planner_task_events` history for one
 * task in reverse-chronological order. Each row shows the event
 * type, the (optional) previous and new due dates, the optional
 * reason, and the timestamp.
 *
 * The timeline is honest about empty / error / loading states.
 * It never invents entries; if the service returns no rows, the
 * component says so.
 */

import { Badge } from '../../../../components/badge';
import { ApiError } from '../../../../lib/api-client';
import { formatShortDate } from '../../../../lib/format-date';
import { usePlannerTaskHistory } from '../../../../hooks/use-planner-automation';
import type { PlannerTaskEventRow } from '@krodex/shared';
import styles from './task-history.module.css';

const EVENT_TONES: Record<string, 'lavender' | 'success' | 'rose' | 'champagne'> = {
  created: 'lavender',
  rescheduled: 'lavender',
  completed: 'success',
  missed: 'rose',
  partial: 'champagne',
  skipped: 'lavender',
  recovered: 'success',
  escalated: 'rose',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface TimelineProps {
  taskId: string;
}

export function TaskHistoryTimeline({ taskId }: TimelineProps): JSX.Element {
  const history = usePlannerTaskHistory(taskId);

  if (history.isLoading) {
    return (
      <p className={styles.placeholder} data-testid="task-history-loading">
        Loading history…
      </p>
    );
  }
  if (history.isError) {
    return (
      <p className={styles.errorMeta} data-testid="task-history-error" role="status">
        {history.error instanceof ApiError
          ? `${history.error.code} (${history.error.status})`
          : 'Could not load task history.'}
      </p>
    );
  }

  const events: readonly PlannerTaskEventRow[] = history.data ?? [];

  if (events.length === 0) {
    return (
      <p
        className={styles.placeholder}
        data-testid="task-history-empty"
      >
        No history events recorded yet.
      </p>
    );
  }

  return (
    <ol className={styles.list} data-testid="task-history-list">
      {events.map((event) => {
        const tone = EVENT_TONES[event.event_type] ?? 'lavender';
        const previousLabel = event.previous_due_at
          ? formatShortDate(event.previous_due_at)
          : null;
        const newLabel = event.new_due_at
          ? formatShortDate(event.new_due_at)
          : null;
        return (
          <li
            key={event.id}
            className={styles.item}
            data-testid={`task-history-event-${event.id}`}
          >
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowMeta}>
                  <Badge tone={tone} size="sm">
                    {event.event_type}
                  </Badge>
                  {previousLabel && newLabel ? (
                    <span className={styles.rowDates}>
                      {previousLabel} → {newLabel}
                    </span>
                  ) : null}
                </div>
                {event.reason ? (
                  <p className={styles.rowReason}>{event.reason}</p>
                ) : null}
              </div>
              <div className={styles.rowAside}>
                <span className={styles.rowLabel}>Recorded</span>
                <span className={styles.rowDate}>
                  {formatTimestamp(event.created_at)}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
