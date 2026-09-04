'use client';

/**
 * KRODEX web — Review schedule detail.
 *
 *   /reviews/[id]
 *
 * Phase 10 rewrite. The page is now a session orchestrator:
 *
 *   1. Loading the schedule.
 *   2. "Start review" → POST /reviews/:id/start
 *      (moves schedule to `in_progress`, error to `in_review`,
 *      and picks a fresh verification question).
 *   3. Show the verification question; student picks an
 *      outcome ('correct' | 'incorrect' | 'partial') and
 *      submits → POST /reviews/:id/outcome.
 *   4. Surface the lifecycle transition + next-review
 *      decision; show the immutable lifecycle history.
 *
 * The Phase 7.8 "Mark passed" / "Record failed attempt" controls
 * are removed — those were sending the wrong outcome values
 * (Bugs 1–2 in the Phase 10 plan) and writing the wrong
 * questionId. The new flow is the only path.
 *
 * 7-state contract honored: loading, empty (NOT_FOUND),
 * error, populated. The session states sit on top of populated
 * (idle → started → answered → terminal).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use } from '../../../../lib/react-async';
import { PageShell } from '../../../../components/page-shell';
import { Badge } from '../../../../components/badge';
import { Button } from '../../../../components/button';
import { ApiError } from '../../../../lib/api-client';
import { useReviewSchedule } from '../../../../hooks/use-reviews';
import {
  useStartReview,
  type OutcomeResult,
} from '../../../../hooks/use-review-session';
import { formatLongDate, formatShortDate } from '../../../../lib/format-date';
import { ReviewLifecyclePanel } from './components/review-lifecycle-panel';
import { ReviewOutcomeFeedback } from './components/review-outcome-feedback';
import { VerificationQuestionCard } from './components/verification-question';
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

const STRATEGY_LABELS = {
  standard: 'standard',
  spaced: 'spaced',
  focused: 'focused',
  retest_only: 'retest only',
} as const;

type ReviewState = keyof typeof STATE_TONES;
type ReviewStrategy = keyof typeof STRATEGY_LABELS;

type SessionPhase = 'idle' | 'started' | 'answered';

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
  const start = useStartReview(id);

  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [verification, setVerification] = useState<
    | { kind: 'found'; questionId: string; difficulty: number }
    | { kind: 'none' }
    | null
  >(null);
  const [outcome, setOutcome] = useState<OutcomeResult | null>(null);

  // Reset local session state when navigating between schedules.
  useEffect(() => {
    setPhase('idle');
    setVerification(null);
    setOutcome(null);
  }, [id]);

  const isLoading = schedule.isLoading;
  const isError = schedule.isError;
  const isEmpty = !isLoading && !isError && !schedule.data;

  const data = schedule.data;
  const state = data?.state as ReviewState | undefined;
  const isOpen =
    state === 'scheduled' || state === 'due' || state === 'in_progress';
  const isTerminal = state === 'completed' || state === 'skipped';
  // "Already started" means the server already moved the schedule
  // to `in_progress` (e.g. a refresh mid-session). The student can
  // resume by reading the deterministic verification question.
  const scheduleIsInProgress = state === 'in_progress';

  const handleStart = (): void => {
    start.mutate(
      {},
      {
        onSuccess: (res) => {
          setVerification(res.verification);
          setPhase('started');
        },
      },
    );
  };

  const handleResume = (): void => {
    // Reload the verification question (idempotent GET).
    setPhase('started');
  };

  const handleOutcomeRecorded = useCallback((res: OutcomeResult) => {
    setOutcome(res);
    setPhase('answered');
  }, []);

  return (
    <PageShell
      title="Review session"
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
              {data.outcome ? (
                <Badge tone="lavender" size="sm">
                  outcome: {data.outcome}
                </Badge>
              ) : null}
            </div>
            <p className={styles.subtitle}>
              {phase === 'answered'
                ? 'Outcome recorded. The lifecycle below shows how this error moved.'
                : isOpen
                  ? 'Start the review to receive a fresh verification question — distinct from the original wrong question.'
                  : isTerminal
                    ? 'This schedule is closed. The error may already be resolved.'
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

          {/* Session start / resume control. Shown only while the
              schedule is open and the student has not yet submitted
              an outcome. */}
          {isOpen && phase !== 'answered' ? (
            <div className={styles.startRow}>
              {scheduleIsInProgress && phase === 'idle' ? (
                <Button
                  variant="primary"
                  onClick={handleResume}
                  data-testid="review-resume"
                >
                  Resume review
                </Button>
              ) : phase === 'idle' ? (
                <Button
                  variant="primary"
                  onClick={handleStart}
                  disabled={start.isPending}
                  data-testid="review-start"
                >
                  {start.isPending ? 'Starting…' : 'Start review'}
                </Button>
              ) : null}
              {start.isError ? (
                <p
                  className={styles.errorMeta}
                  role="alert"
                  data-testid="review-start-error"
                >
                  {start.error instanceof ApiError
                    ? `Could not start: ${start.error.code} (${start.error.status})`
                    : 'Could not start the review.'}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Verification question form. Shown after start (or
              resume) and before the outcome is recorded. */}
          {phase === 'started' && verification ? (
            <VerificationQuestionCard
              reviewId={id}
              question={verification}
              onRecorded={handleOutcomeRecorded}
            />
          ) : null}

          {/* Outcome feedback panel. Shown once the server
              confirms the outcome; the lifecycle is rendered
              below it. */}
          {phase === 'answered' && outcome ? (
            <ReviewOutcomeFeedback result={outcome} />
          ) : null}

          <ReviewLifecyclePanel reviewId={id} />

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
