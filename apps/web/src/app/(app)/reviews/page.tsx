'use client';

/**
 * KRODEX web — Reviews queue (index).
 *
 *   /reviews
 *
 * Phase 7.8 visual layer:
 *  - Eyebrow "Review queue", title "Reviews", and a calm
 *    description that names the purpose without fabrication.
 *  - A list of review schedules. Each row is a deep link to
 *    /reviews/[id] and shows: error_id (mono), state badge,
 *    strategy, and the due date on the right.
 *  - 7-state contract honored: loading, empty, error,
 *    populated. The empty state is honest: "No reviews
 *    scheduled yet" — we do not invent a starter schedule.
 *
 * Hooks used (no new server state):
 *  - useReviewSchedules({ limit: 50 })
 *
 * Out of scope: scheduling new reviews from this page (the
 * scheduler is wired into the error detail flow in Phase 7.7
 * via the createReviewSchedule endpoint). This page is the
 * read-only queue.
 */

import Link from 'next/link';
import { PageShell } from '../../../components/page-shell';
import { Badge } from '../../../components/badge';
import { ApiError } from '../../../lib/api-client';
import { useReviewSchedules } from '../../../hooks/use-reviews';
import { formatShortDate } from '../../../lib/format-date';
import styles from './reviews.module.css';

const STATE_TONES = {
  scheduled: 'lavender',
  due: 'champagne',
  in_progress: 'champagne',
  completed: 'success',
  skipped: 'lavender',
  missed: 'rose',
} as const;

const STRATEGY_LABELS = {
  standard: 'standard',
  spaced: 'spaced',
  focused: 'focused',
  retest_only: 'retest only',
} as const;

type ReviewState = keyof typeof STATE_TONES;
type ReviewStrategy = keyof typeof STRATEGY_LABELS;

function strategyLabel(strategy: string | null | undefined): string {
  if (!strategy) return '';
  const key = strategy as ReviewStrategy;
  return STRATEGY_LABELS[key] ?? strategy;
}

export default function ReviewsPage(): JSX.Element {
  const reviews = useReviewSchedules({ limit: 50 });
  const items = reviews.data?.items ?? [];
  const isEmpty = !reviews.isLoading && !reviews.isError && items.length === 0;

  return (
    <PageShell
      title="Reviews"
      eyebrow="Review queue"
      description="The mistakes you've scheduled to revisit. Open a row to mark it passed, record an attempt, or skip it."
      isLoading={reviews.isLoading}
      isError={reviews.isError}
      error={reviews.error}
      isEmpty={isEmpty}
      emptyTitle="No reviews scheduled yet"
      emptyMessage="When a review is scheduled from an error entry, it will appear here."
    >
      <ol className={styles.list} data-testid="reviews-list">
        {items.map((schedule) => {
          const state = schedule.state as ReviewState;
          const stateTone = STATE_TONES[state] ?? 'lavender';
          const strategy = strategyLabel(schedule.strategy);
          const dueLabel = formatShortDate(schedule.due_at) ?? '—';
          return (
            <li
              key={schedule.id}
              className={styles.item}
              data-testid={`reviews-item-${schedule.id}`}
            >
              <Link
                href={`/reviews/${schedule.id}`}
                className={styles.row}
                data-testid={`reviews-row-${schedule.id}`}
              >
                <div className={styles.rowMain}>
                  <div className={styles.rowMeta}>
                    <Badge tone={stateTone} size="sm">
                      {schedule.state}
                    </Badge>
                    {strategy ? (
                      <span className={styles.rowStrategy}>{strategy}</span>
                    ) : null}
                    {schedule.error_id ? (
                      <span className={styles.rowError}>
                        {schedule.error_id}
                      </span>
                    ) : (
                      <span className={styles.rowErrorMuted}>
                        No error attached
                      </span>
                    )}
                  </div>
                  {schedule.outcome ? (
                    <p className={styles.rowStrategy}>
                      Outcome: {schedule.outcome}
                    </p>
                  ) : null}
                </div>
                <div className={styles.rowAside}>
                  <span className={styles.rowLabel}>Due</span>
                  <span className={styles.rowDate}>{dueLabel}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
      {reviews.isError ? (
        <p className={styles.errorMeta} role="status">
          {reviews.error instanceof ApiError
            ? `${reviews.error.code} (${reviews.error.status})`
            : 'Could not load reviews.'}
        </p>
      ) : null}
    </PageShell>
  );
}
