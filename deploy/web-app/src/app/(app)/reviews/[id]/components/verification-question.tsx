/**
 * KRODEX web — Verification question (Phase 10).
 *
 * Renders a fresh verification question for an in-progress
 * review session. The question is picked by the deterministic
 * FreshQuestionSelector on the server; this component is a
 * presentational shell that captures the student's answer
 * choice and posts the outcome to /reviews/:id/outcome.
 *
 * PRD §18: the verification question must be distinct from the
 * original wrong question. The component therefore does NOT
 * fetch the original question or compare against it — that's a
 * server-side guarantee.
 *
 * States:
 *   - `kind: 'found'` — render the questionId + difficulty
 *   - `kind: 'none'` — graceful empty state ("no verification
 *     question available for this error")
 */

'use client';

import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../../../../../lib/api-client';
import {
  useRecordReviewOutcome,
  type OutcomeResult,
  type SessionOutcome,
  type VerificationQuestion,
} from '../../../../../hooks/use-review-session';
import { Button } from '../../../../../components/button';
import styles from './verification-question.module.css';

interface VerificationQuestionCardProps {
  reviewId: string;
  question: VerificationQuestion;
  /**
   * Called when the outcome has been accepted by the server.
   * Receives the full server response so the parent can render
   * transition + next-review feedback without re-fetching.
   */
  onRecorded?: (result: OutcomeResult) => void;
}

export function VerificationQuestionCard({
  reviewId,
  question,
  onRecorded,
}: VerificationQuestionCardProps): ReactNode {
  if (question.kind === 'none') {
    return (
      <section
        className={styles.card}
        aria-label="Verification question"
        data-testid="review-verification-none"
      >
        <h2 className={styles.heading}>Verification question</h2>
        <p className={styles.emptyMessage}>
          No verification question is available for this error right now.
          The topic pool may be exhausted. You can still close this
          review below.
        </p>
      </section>
    );
  }

  return (
    <FoundQuestionForm
      reviewId={reviewId}
      questionId={question.questionId}
      difficulty={question.difficulty}
      onRecorded={onRecorded}
    />
  );
}

interface FoundQuestionFormProps {
  reviewId: string;
  questionId: string;
  difficulty: number;
  onRecorded?: (result: OutcomeResult) => void;
}

function FoundQuestionForm({
  reviewId,
  questionId,
  difficulty,
  onRecorded,
}: FoundQuestionFormProps): ReactNode {
  const fieldsetId = useId();
  const [outcome, setOutcome] = useState<SessionOutcome | ''>('');
  const [freeText, setFreeText] = useState('');
  const record = useRecordReviewOutcome(reviewId);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!outcome) return;
    record.mutate(
      {
        questionId,
        outcome,
        selectedOptionIds: [],
        freeText: freeText.trim() || null,
      },
      {
        onSuccess: (res) => {
          onRecorded?.(res);
        },
      },
    );
  };

  return (
    <section
      className={styles.card}
      aria-label="Verification question"
      data-testid="review-verification-card"
    >
      <header className={styles.header}>
        <h2 className={styles.heading}>Verification question</h2>
        <span className={styles.difficulty}>
          difficulty {difficulty}/5
        </span>
      </header>
      <p className={styles.lede}>
        A fresh question — distinct from the original wrong question —
        is below. Answering it closes the review session.
      </p>
      <dl className={styles.meta}>
        <dt>Question id</dt>
        <dd className={styles.code} data-testid="review-verification-qid">
          {questionId}
        </dd>
      </dl>
      <form
        onSubmit={handleSubmit}
        className={styles.form}
        aria-describedby={`${fieldsetId}-hint`}
      >
        <fieldset className={styles.fieldset} disabled={record.isPending}>
          <legend className={styles.legend}>How did it go?</legend>
          <p
            id={`${fieldsetId}-hint`}
            className={styles.fieldsetHint}
          >
            Pick the result that matches your answer.
          </p>
          <div className={styles.outcomeRow} role="radiogroup">
            <label className={styles.outcomeOption}>
              <input
                type="radio"
                name="outcome"
                value="correct"
                checked={outcome === 'correct'}
                onChange={() => setOutcome('correct')}
                data-testid="review-outcome-correct"
              />
              <span className={styles.outcomeLabel}>Correct</span>
            </label>
            <label className={styles.outcomeOption}>
              <input
                type="radio"
                name="outcome"
                value="partial"
                checked={outcome === 'partial'}
                onChange={() => setOutcome('partial')}
                data-testid="review-outcome-partial"
              />
              <span className={styles.outcomeLabel}>Partial</span>
            </label>
            <label className={styles.outcomeOption}>
              <input
                type="radio"
                name="outcome"
                value="incorrect"
                checked={outcome === 'incorrect'}
                onChange={() => setOutcome('incorrect')}
                data-testid="review-outcome-incorrect"
              />
              <span className={styles.outcomeLabel}>Incorrect</span>
            </label>
          </div>
        </fieldset>

        <label className={styles.freeTextLabel}>
          <span className={styles.freeTextTitle}>Notes (optional)</span>
          <textarea
            className={styles.freeText}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={3}
            maxLength={8_000}
            disabled={record.isPending}
            data-testid="review-outcome-notes"
          />
        </label>

        <div className={styles.actions}>
          <Button
            type="submit"
            disabled={!outcome || record.isPending}
            data-testid="review-submit-outcome"
          >
            {record.isPending ? 'Submitting…' : 'Submit outcome'}
          </Button>
        </div>
      </form>

      {record.isError ? (
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="review-outcome-error"
        >
          {record.error instanceof ApiError
            ? `Could not record: ${record.error.code} (${record.error.status})`
            : 'Could not record the outcome.'}
        </p>
      ) : null}
    </section>
  );
}
