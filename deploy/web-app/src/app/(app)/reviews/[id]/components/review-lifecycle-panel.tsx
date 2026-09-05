/**
 * KRODEX web — Review lifecycle panel (Phase 10).
 *
 * Surfaces the immutable state-transition history for the
 * error attached to this schedule. Convenience wrapper around
 * `useReviewLifecycle`; rendered as a quiet section under the
 * main action area so the student can see how the review
 * progressed.
 *
 * The list is INSERT-only on the server; the UI treats it as a
 * read-only ledger.
 */

'use client';

import type { ReactNode } from 'react';
import { useReviewLifecycle } from '../../../../../hooks/use-review-session';
import { formatLongDate, formatShortDate } from '../../../../../lib/format-date';
import styles from './review-lifecycle-panel.module.css';

interface ReviewLifecyclePanelProps {
  reviewId: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  student_review: 'You marked',
  ai_suggestion: 'AI suggested',
  manual: 'Edited manually',
  system: 'System updated',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'active',
  in_review: 'in review',
  resolved: 'resolved',
  reopened: 'reopened',
  archived: 'archived',
};

export function ReviewLifecyclePanel({
  reviewId,
}: ReviewLifecyclePanelProps): ReactNode {
  const list = useReviewLifecycle(reviewId);

  if (list.isLoading) {
    return (
      <section className={styles.section} aria-label="Lifecycle history">
        <h2 className={styles.heading}>Lifecycle</h2>
        <p
          className={styles.placeholder}
          data-testid="review-lifecycle-loading"
        >
          Loading history…
        </p>
      </section>
    );
  }

  if (list.isError) {
    return (
      <section className={styles.section} aria-label="Lifecycle history">
        <h2 className={styles.heading}>Lifecycle</h2>
        <p
          className={styles.placeholder}
          data-testid="review-lifecycle-error"
        >
          Could not load the lifecycle history.
        </p>
      </section>
    );
  }

  const events = list.data ?? [];
  if (events.length === 0) {
    return (
      <section className={styles.section} aria-label="Lifecycle history">
        <h2 className={styles.heading}>Lifecycle</h2>
        <p
          className={styles.placeholder}
          data-testid="review-lifecycle-empty"
        >
          No state changes have been recorded for this error yet.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-label="Lifecycle history">
      <h2 className={styles.heading}>Lifecycle</h2>
      <ol className={styles.list} data-testid="review-lifecycle-list">
        {events.map((event) => {
          const triggerLabel =
            TRIGGER_LABELS[event.trigger] ?? event.trigger;
          return (
            <li
              key={event.id}
              className={styles.item}
              data-testid="review-lifecycle-item"
            >
              <p className={styles.itemLine}>
                <span className={styles.trigger}>{triggerLabel}</span>
                <span className={styles.transition}>
                  {event.from_status
                    ? `${STATUS_LABELS[event.from_status] ?? event.from_status} → `
                    : ''}
                  {STATUS_LABELS[event.to_status] ?? event.to_status}
                </span>
              </p>
              {event.reason ? (
                <p className={styles.reason}>{event.reason}</p>
              ) : null}
              <p
                className={styles.timestamp}
                title={formatLongDate(event.created_at) ?? ''}
              >
                {formatShortDate(event.created_at)}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
