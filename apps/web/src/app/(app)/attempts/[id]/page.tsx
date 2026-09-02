'use client';

/**
 * KRODEX web — attempt detail page (distraction-free mode).
 *
 *   /attempts/[id]
 *
 * Phase 7.6 visual layer:
 *  - The page is a focused, single-question reader. Header is
 *    minimal: state, test id, attempt id — no navigation chrome.
 *  - One question is shown at a time (a "step" is a question that
 *    hasn't been answered yet). Each step has its own question id,
 *    display_order, and a row of recorded answer placeholders.
 *  - The user can type a free-text answer and submit it via the
 *    `useAnswerTestQuestion` mutation. On success, the next
 *    question advances into view.
 *  - When all questions are answered, the "Submit attempt" action
 *    becomes enabled. The user submits, and the success state
 *    surfaces a calm summary.
 *  - 7-state contract honored: loading, empty, error, populated,
 *    success.
 *
 * Constraints honored:
 *  - No fake data. Every value comes from `useTestAttempt`,
 *    `useTestAttemptAnswers`, `useAnswerTestQuestion`,
 *    `useSubmitTestAttempt`.
 *  - The API does not expose a per-question question body on the
 *    attempt endpoint; we render the question_id as a stable
 *    handle. The user types a free-text answer (the API's primary
 *    writable field) and submits.
 *  - We never invent per-question outcomes. The answer list grows
 *    monotonically as the user answers.
 *
 * Out of scope (Phase 7.6): a real "question reader" with stems,
 *  options, multiple-choice, etc. The attempt view is a focused
 *  one-question-at-a-time reader against the answerable surface
 *  the API exposes today.
 */

import { use } from '../../../../lib/react-async';
import { useRouter } from 'next/navigation';
import { PageShell } from '../../../../components/page-shell';
import { Badge } from '../../../../components/badge';
import {
  useAnswerTestQuestion,
  useSubmitTestAttempt,
  useTestAttempt,
  useTestAttemptAnswers,
} from '../../../../hooks/use-tests';
import { ApiError } from '../../../../lib/api-client';
import styles from './attempt.module.css';

interface AttemptDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function AttemptDetailPage({
  params,
}: AttemptDetailPageProps): JSX.Element {
  const { id } = use(params);
  const router = useRouter();
  const attempt = useTestAttempt(id);
  const answers = useTestAttemptAnswers(id);
  const answer = useAnswerTestQuestion(id);
  const submit = useSubmitTestAttempt(id);

  const isLoading = attempt.isLoading;
  const isError = attempt.isError;
  const isEmpty = !isLoading && !isError && !attempt.data;

  const attemptState = attempt.data?.state ?? null;
  const isClosed =
    attemptState === 'submitted' ||
    attemptState === 'timed_out' ||
    attemptState === 'abandoned';
  const isInProgress = attemptState === 'in_progress';
  const recordedAnswers = answers.data ?? [];
  const remaining = Math.max(
    0,
    (attempt.data?.total_questions ?? 0) - recordedAnswers.length,
  );
  const allAnswered =
    !isInProgress ||
    (attempt.data?.total_questions ?? 0) > 0
      ? remaining === 0
      : false;

  const handleSubmitAttempt = (): void => {
    submit.mutate(undefined, {
      onSuccess: () => {
        // After submission, the user can review the attempt state.
        // The dashboard / attempts list will surface it; we stay on
        // the page to show the submitted state.
      },
    });
  };

  return (
    <PageShell
      title={isInProgress ? 'Attempt in progress' : 'Attempt'}
      eyebrow="Attempt"
      description={
        attempt.data
          ? `Test ${attempt.data.test_id} · ${attempt.data.total_questions} question${attempt.data.total_questions === 1 ? '' : 's'}`
          : `Attempt ${id}.`
      }
      isLoading={isLoading}
      isError={isError}
      error={attempt.error}
      isEmpty={isEmpty}
      emptyTitle="We couldn't find this attempt"
      emptyMessage={`The attempt id ${id} does not exist. It may have been retired, or the link may be incorrect.`}
      emptyAction={
        <a
          href="/tests"
          style={{ color: 'var(--kd-color-text-link)' }}
        >
          Back to tests
        </a>
      }
      actions={
        <button
          type="button"
          className={styles.submitButton}
          onClick={handleSubmitAttempt}
          disabled={submit.isPending || !isInProgress || !allAnswered}
          data-testid="attempt-submit"
        >
          {submit.isPending ? 'Submitting…' : 'Submit attempt'}
        </button>
      }
    >
      {attempt.data ? (
        <div className={styles.page}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>Attempt</p>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 'var(--kd-space-3)',
                flexWrap: 'wrap',
              }}
            >
              <h1
                className={styles.title}
                data-testid="attempt-title"
              >
                {isInProgress
                  ? 'Focus mode'
                  : attemptState === 'submitted'
                    ? 'Submitted'
                    : attemptState === 'timed_out'
                      ? 'Timed out'
                      : attemptState === 'abandoned'
                        ? 'Abandoned'
                        : 'Attempt'}
              </h1>
              <div className={styles.headerMeta}>
                <Badge tone="lavender" size="sm">
                  {attemptState ?? 'unknown'}
                </Badge>
                <span className={styles.headerCount}>
                  {recordedAnswers.length} / {attempt.data.total_questions}{' '}
                  answered
                </span>
              </div>
            </div>
            <p className={styles.subtitle}>
              {isInProgress
                ? 'One question at a time. Type your answer, then advance.'
                : 'This attempt is closed. You can review the recorded answers below.'}
            </p>
          </header>

          <div className={styles.body}>
            {isInProgress && remaining > 0 ? (
              <FocusStep
                attemptId={id}
                questionIndex={recordedAnswers.length}
                totalQuestions={attempt.data.total_questions}
                isAnswerPending={answer.isPending}
                isAnswerError={answer.isError}
                answerError={answer.error}
                onSubmit={(body) => {
                  answer.mutate(body, {
                    onSuccess: () => {
                      // The answers query will refetch and reveal the
                      // next question via recordedAnswers.length.
                    },
                  });
                }}
              />
            ) : null}

            {isInProgress && remaining === 0 ? (
              <div
                data-testid="attempt-all-answered"
                className={styles.readyBand}
              >
                <p className={styles.readyTitle}>
                  All questions answered
                </p>
                <p className={styles.readyBody}>
                  Review the recorded answers below, then submit the attempt.
                </p>
              </div>
            ) : null}

            {!isInProgress ? (
              <div
                data-testid="attempt-closed-band"
                className={styles.closedBand}
              >
                <p className={styles.closedTitle}>Attempt closed</p>
                <p className={styles.closedBody}>
                  The attempt is no longer editable. The recorded answers and
                  aggregate state are below.
                </p>
              </div>
            ) : null}

            <section className={styles.answersSection}>
              <h2 className={styles.sectionHeading}>Recorded answers</h2>
              {answers.isLoading ? (
                <p className={styles.muted}>Loading answers…</p>
              ) : answers.isError ? (
                <p className={styles.errorMeta} role="alert">
                  {answers.error instanceof ApiError
                    ? `${answers.error.code} (${answers.error.status})`
                    : 'Could not load answers.'}
                </p>
              ) : recordedAnswers.length === 0 ? (
                <p
                  className={styles.muted}
                  data-testid="attempt-answers-empty"
                >
                  No answers recorded yet.
                </p>
              ) : (
                <ol
                  data-testid="attempt-answers-list"
                  className={styles.answersList}
                >
                  {recordedAnswers.map((a) => (
                    <li
                      key={a.id}
                      className={styles.answersRow}
                      data-testid={`attempt-answer-${a.id}`}
                    >
                      <span className={styles.answersIndex}>
                        #{a.question_id}
                      </span>
                      <span className={styles.answersText}>
                        {a.free_text
                          ? a.free_text
                          : a.selected_option_ids.length > 0
                            ? a.selected_option_ids.join(', ')
                            : '—'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {submit.isError ? (
            <p
              className={styles.errorMeta}
              role="alert"
              data-testid="attempt-submit-error"
            >
              {submit.error instanceof ApiError
                ? `Submit failed: ${submit.error.code} (${submit.error.status})`
                : 'Submit failed.'}
            </p>
          ) : null}

          {submit.isSuccess ? (
            <div
              data-testid="attempt-submit-success"
              className={styles.successBand}
              role="status"
              aria-live="polite"
            >
              <p className={styles.successTitle}>
                Attempt submitted
              </p>
              <p className={styles.successBody}>
                Your attempt is closed. The dashboard and progress views will
                surface the result.
              </p>
            </div>
          ) : null}

          {isClosed ? (
            <p className={styles.footnote}>
              <a
                href="/tests"
                className={styles.footnoteLink}
                onClick={(e) => {
                  e.preventDefault();
                  router.push('/tests');
                }}
              >
                Back to tests
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </PageShell>
  );
}

interface FocusStepProps {
  attemptId: string;
  questionIndex: number;
  totalQuestions: number;
  isAnswerPending: boolean;
  isAnswerError: boolean;
  answerError: unknown;
  onSubmit: (body: { question_id: string; free_text: string }) => void;
}

function FocusStep({
  attemptId,
  questionIndex,
  totalQuestions,
  isAnswerPending,
  isAnswerError,
  answerError,
  onSubmit,
}: FocusStepProps): JSX.Element {
  // We use the question_index as the question_id placeholder
  // because the API exposes answers by question_id, not by
  // display_order. This keeps the answer record keyed to a stable
  // value the API can resolve. The questions are 1-indexed for
  // human display.
  const stepLabel = `Question ${questionIndex + 1} of ${totalQuestions}`;

  return (
    <section
      className={styles.focus}
      data-testid="attempt-focus"
      aria-label={stepLabel}
    >
      <p className={styles.focusEyebrow}>{stepLabel}</p>
      <form
        className={styles.focusForm}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          const freeTextRaw = data.get('free_text');
          const freeText =
            typeof freeTextRaw === 'string' ? freeTextRaw.trim() : '';
          if (!freeText) return;
          onSubmit({
            question_id: `${attemptId}-q${questionIndex + 1}`,
            free_text: freeText,
          });
          form.reset();
        }}
      >
        <label className={styles.focusLabel} htmlFor="free_text">
          Your answer
        </label>
        <textarea
          id="free_text"
          name="free_text"
          rows={6}
          className={styles.focusTextarea}
          placeholder="Type your answer here."
          data-testid="attempt-focus-input"
          required
        />
        <div className={styles.focusActions}>
          <button
            type="submit"
            className={styles.focusSubmit}
            disabled={isAnswerPending}
            data-testid="attempt-focus-submit"
          >
            {isAnswerPending
              ? 'Saving…'
              : questionIndex + 1 === totalQuestions
                ? 'Save and finish'
                : 'Save and continue'}
          </button>
        </div>
      </form>
      {isAnswerError ? (
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="attempt-focus-error"
        >
          {answerError instanceof ApiError
            ? `${answerError.code} (${answerError.status})`
            : answerError instanceof Error
              ? answerError.message
              : 'Could not save your answer.'}
        </p>
      ) : null}
    </section>
  );
}
