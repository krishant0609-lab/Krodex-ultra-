/**
 * KRODEX web — Review outcome feedback (Phase 10).
 *
 * Renders the server's response after the student POSTs an
 * outcome to /reviews/:id/outcome:
 *
 *   - errorTransition: from -> to
 *   - terminalOutcome: 'correct' | 'incorrect' | 'partial'
 *   - nextReviewScheduled: true|false
 *   - nextReview: SchedulingDecision (if scheduled)
 *
 * The component is presentational: the parent owns the
 * recorded-result state and passes it in.
 */

'use client';

import type { ReactNode } from 'react';
import { Badge } from '../../../../../components/badge';
import type { OutcomeResult } from '../../../../../hooks/use-review-session';
import { formatLongDate, formatShortDate } from '../../../../../lib/format-date';
import styles from './review-outcome-feedback.module.css';

interface ReviewOutcomeFeedbackProps {
  result: OutcomeResult;
}

const TRANSITION_TONES = {
  active: 'rose',
  in_review: 'champagne',
  resolved: 'success',
  reopened: 'rose',
  archived: 'lavender',
} as const;

type ErrorStatus = keyof typeof TRANSITION_TONES;

const OUTCOME_TONES: Record<OutcomeResult['terminalOutcome'], 'success' | 'rose' | 'champagne'> = {
  correct: 'success',
  incorrect: 'rose',
  partial: 'champagne',
};

const HEADLINE: Record<OutcomeResult['terminalOutcome'], string> = {
  correct: 'Marked correct. Nice work.',
  partial: 'Marked partial. Practice it again before it sticks.',
  incorrect: 'Marked incorrect. The error stays open.',
};

export function ReviewOutcomeFeedback({
  result,
}: ReviewOutcomeFeedbackProps): ReactNode {
  const { fromStatus, toStatus } = result.errorTransition;
  const showNextReview = result.nextReviewScheduled && result.nextReview;
  const fromTone =
    (TRANSITION_TONES[fromStatus as ErrorStatus] ?? 'lavender') as
      | 'rose'
      | 'champagne'
      | 'success'
      | 'lavender';
  const toTone =
    (TRANSITION_TONES[toStatus as ErrorStatus] ?? 'lavender') as
      | 'rose'
      | 'champagne'
      | 'success'
      | 'lavender';

  return (
    <section
      className={styles.section}
      aria-label="Outcome"
      data-testid="review-outcome-feedback"
    >
      <h2 className={styles.heading}>Outcome</h2>
      <p className={styles.headline}>
        {HEADLINE[result.terminalOutcome]}
      </p>
      <dl className={styles.dl}>
        <dt>Outcome</dt>
        <dd>
          <Badge
            tone={OUTCOME_TONES[result.terminalOutcome]}
            size="sm"
          >
            {result.terminalOutcome}
          </Badge>
        </dd>
        <dt>Error transition</dt>
        <dd className={styles.transition}>
          <Badge tone={fromTone} size="sm">
            {fromStatus}
          </Badge>
          <span aria-hidden="true" className={styles.transitionArrow}>
            →
          </span>
          <Badge tone={toTone} size="sm">
            {toStatus}
          </Badge>
        </dd>
        {showNextReview ? (
          <>
            <dt>Next review</dt>
            <dd
              data-testid="review-next-due"
              title={formatLongDate(result.nextReview!.dueAt) ?? ''}
            >
              {formatShortDate(result.nextReview!.dueAt)} ·{' '}
              <span className={styles.reason}>
                {result.nextReview!.reasonText}
              </span>
            </dd>
            {result.nextReview!.requiresConfirmation ? (
              <>
                <dt>Confidence</dt>
                <dd>
                  low — please confirm the next date in your planner
                </dd>
              </>
            ) : null}
          </>
        ) : (
          <>
            <dt>Next review</dt>
            <dd className={styles.reason}>
              No follow-up scheduled. The error is closed.
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
