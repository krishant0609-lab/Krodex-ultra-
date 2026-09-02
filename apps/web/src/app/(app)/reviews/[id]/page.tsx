'use client';

/**
 * KRODEX web — Review schedule detail.
 *
 *   /reviews/[id]
 *
 * Phase 7.8 visual layer:
 *  - Breadcrumbs: Reviews → schedule id.
 *  - Title block: state + strategy (visual badges) and
 *    the due date.
 *  - Meta row: scheduled_at, completed_at (when present),
 *    error_id.
 *  - Action row: "Mark passed" (active/due → completed +
 *    passed) and "Record failed attempt" (sends a
 *    /review/schedules/:id/attempts POST) — surfaced only
 *    when the corresponding transition is valid.
 *  - 7-state contract honored: loading, empty (NOT_FOUND),
 *    error, populated. (NOT_FOUND renders as an honest
 *    error band, not a soft "no data" state.)
 *
 * Hooks used (no new server state):
 *  - useReviewSchedule(id)
 *  - useUpdateReviewSchedule(id)
 *  - useRecordReviewAttempt(id)
 */

import { use } from '../../../../lib/react-async';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageShell } from '../../../../components/page-shell';
import { Badge } from '../../../../components/badge';
import { ApiError } from '../../../../lib/api-client';
import {
  useRecordReviewAttempt,
  useReviewSchedule,
  useUpdateReviewSchedule,
} from '../../../../hooks/use-reviews';
import { formatLongDate, formatShortDate } from '../../../../lib/format-date';
import styles from './review-detail.module.css';

interface ReviewDetailPageProps {
  params: Promise<{ id: string }>;
}

const STATE_TONES = {
  scheduled: 'lavender',
  due: 'champagne',
  in_progress: 'champagne',
  completed: 'success',
  skipped: 'lavender',
  missed: 'rose',
} as const;

const OUTCOME_TONES = {
  correct: 'success',
  incorrect: 'rose',
  partial: 'champagne',
} as const;

const STRATEGY_LABELS = {
  standard: 'standard',
  spaced: 'spaced',
  focused: 'focused',
  retest_only: 'retest only',
} as const;

type ReviewState = keyof typeof STATE_TONES;
type ReviewOutcomeData = 'correct' | 'incorrect' | 'partial';
type ReviewStrategy = keyof typeof STRATEGY_LABELS;

function strategyLabel(strategy: string | null | undefined): string {
  if (!strategy) return '';
  const key = strategy as ReviewStrategy;
  return STRATEGY_LABELS[key] ?? strategy;
}

export default function ReviewDetailPage({
  params,
}: ReviewDetailPageProps): JSX.Element {
  const { id } = use(params);
  const router = useRouter();
  const schedule = useReviewSchedule(id);
  const update = useUpdateReviewSchedule(id);
  const record = useRecordReviewAttempt(id);

  const isLoading = schedule.isLoading;
  const isError = schedule.isError;
  const isEmpty = !isLoading && !isError && !schedule.data;

  const handleMarkPassed = (): void => {
    update.mutate(
      { state: 'completed', outcome: 'passed' },
      {
        onSuccess: () => {
          // Stay on the page; the entry refetches and shows
          // the completed state.
        },
      },
    );
  };

  const handleRecordFailed = (): void => {
    if (!schedule.data) return;
    record.mutate({
      schedule_id: id,
      question_id: schedule.data.error_id,
      outcome: 'failed',
      selected_option_ids: [],
    });
  };

  const handleSkip = (): void => {
    update.mutate({ state: 'skipped', outcome: 'partial' });
  };

  const handleReopen = (): void => {
    update.mutate({ state: 'due' });
  };

  const data = schedule.data;
  const state = data?.state as ReviewState | undefined;
  const outcome = data?.outcome as ReviewOutcomeData | null | undefined;
  const isOpen =
    state === 'scheduled' || state === 'due' || state === 'in_progress';
  const isClosed = state === 'completed' || state === 'skipped';

  return (
    <PageShell
      title="Review schedule"
      eyebrow="Review queue"
      description={
        data
          ? `Schedule ${data.id} · due ${formatShortDate(data.due_at) ?? '—'}`
          : `Review schedule ${id}.`
      }
      isLoading={isLoading}
      isError={isError}
      error={schedule.error}
      isEmpty={isEmpty}
      emptyTitle="We couldn't find this review schedule"
      emptyMessage={`The schedule id ${id} does not exist. It may have been removed or the link may be incorrect.`}
      emptyAction={
        <Link href="/reviews" style={{ color: 'var(--kd-color-text-link)' }}>
          Back to review queue
        </Link>
      }
      actions={
        data && isOpen ? (
          <button
            type="button"
            className={styles.primaryAction}
            onClick={handleMarkPassed}
            disabled={update.isPending || record.isPending}
            data-testid="review-mark-passed"
          >
            {update.isPending ? 'Saving…' : 'Mark passed'}
          </button>
        ) : null
      }
    >
      {data ? (
        <article className={styles.detail}>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumbs">
            <Link href="/reviews" className={styles.breadcrumbsLink}>
              Reviews
            </Link>
            <span className={styles.breadcrumbsSep}>›</span>
            <span className={styles.breadcrumbsCurrent}>{data.id}</span>
          </nav>

          <header className={styles.header}>
            <p className={styles.eyebrow}>Review schedule</p>
            <h1 className={styles.title} data-testid="review-title">
              {strategyLabel(data.strategy) || 'Review'}
            </h1>
            <div className={styles.metaRow}>
              <Badge tone={STATE_TONES[state ?? 'scheduled']} size="sm">
                {data.state}
              </Badge>
              {data.strategy ? (
                <span className={styles.metaMono}>
                  {strategyLabel(data.strategy)}
                </span>
              ) : null}
              {outcome ? (
                <Badge tone={OUTCOME_TONES[outcome] ?? 'lavender'} size="sm">
                  outcome: {outcome}
                </Badge>
              ) : null}
            </div>
            <p className={styles.subtitle}>
              {isOpen
                ? 'This schedule is open. Mark it passed when the review sticks, or record an attempt if it did not.'
                : isClosed
                  ? 'This schedule is closed. Reopen it if the mistake came back, or skip it to write it off.'
                  : 'This schedule is in your queue.'}
            </p>
          </header>

          <section className={styles.section} aria-label="Dates">
            <h2 className={styles.sectionHeading}>Dates</h2>
            <dl className={styles.dl}>
              <dt>Scheduled</dt>
              <dd>{formatLongDate(data.scheduled_at)}</dd>
              <dt>Due</dt>
              <dd>{formatLongDate(data.due_at)}</dd>
              {data.completed_at ? (
                <>
                  <dt>Completed</dt>
                  <dd>{formatLongDate(data.completed_at)}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className={styles.section} aria-label="Source error">
            <h2 className={styles.sectionHeading}>Source error</h2>
            {data.error_id ? (
              <dl className={styles.dl}>
                <dt>Error id</dt>
                <dd>
                  <Link
                    href={`/errors/${data.error_id}`}
                    className={styles.code}
                  >
                    {data.error_id}
                  </Link>
                </dd>
              </dl>
            ) : (
              <p className={styles.muted}>
                No error attached to this schedule.
              </p>
            )}
          </section>

          {isOpen ? (
            <div className={styles.secondaryActions}>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={handleRecordFailed}
                disabled={update.isPending || record.isPending}
                data-testid="review-mark-failed"
              >
                Record failed attempt
              </button>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={handleSkip}
                disabled={update.isPending || record.isPending}
                data-testid="review-skip"
              >
                Skip
              </button>
            </div>
          ) : null}

          {isClosed ? (
            <div className={styles.secondaryActions}>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={handleReopen}
                disabled={update.isPending}
                data-testid="review-reopen"
              >
                Reopen
              </button>
            </div>
          ) : null}

          {update.isError ? (
            <p
              className={styles.errorMeta}
              role="alert"
              data-testid="review-update-error"
            >
              {update.error instanceof ApiError
                ? `Update failed: ${update.error.code} (${update.error.status})`
                : 'Update failed.'}
            </p>
          ) : null}

          {record.isError ? (
            <p
              className={styles.errorMeta}
              role="alert"
              data-testid="review-attempt-error"
            >
              {record.error instanceof ApiError
                ? `Attempt failed: ${record.error.code} (${record.error.status})`
                : 'Could not record attempt.'}
            </p>
          ) : null}

          {update.isSuccess && data.state === 'completed' ? (
            <p
              className={styles.successMeta}
              role="status"
              data-testid="review-update-success"
            >
              Marked as completed.
            </p>
          ) : null}

          <p className={styles.footnote}>
            <a
              href="/reviews"
              className={styles.footnoteLink}
              onClick={(e) => {
                e.preventDefault();
                router.push('/reviews');
              }}
            >
              Back to review queue
            </a>
          </p>
        </article>
      ) : null}
    </PageShell>
  );
}
