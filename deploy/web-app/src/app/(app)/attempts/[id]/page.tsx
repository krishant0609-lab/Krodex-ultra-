'use client';

/**
 * KRODEX web — attempt detail page.
 *
 *   /attempts/[id]
 *
 * Reads the authoritative attempt, its recorded answers, and the
 * authoritative question list for the test the attempt is bound
 * to. The user types a free-text answer per question; on submit,
 * the answer is POSTed to /tests/attempts/:id/answers with the
 * authoritative `question_id` returned by the test's question
 * list — never a client-generated id.
 *
 * Authoritative id source: `GET /tests/:test_id/questions` returns
 * `TestQuestionRow[]`, each with a real `question_id` and
 * `display_order`. The current step's id is the entry at
 * index `recordedAnswers.length` in the list sorted by
 * `display_order` ascending. If that index is past the end of
 * the list, or the list is still loading, or the query failed,
 * the form is rendered disabled and an honest inline error is
 * shown — we never invent an id to fill the gap.
 *
 * Visual contract (Phase 7.6 / attempt mode):
 *  - distraction-free
 *  - single column
 *  - no decorative accent
 *  - no decorative motion
 *  - no shimmer
 *  - critical learning actions wait for server acknowledgement.
 *
 * 7-state contract honored: loading, empty, error, populated,
 * success.
 *
 * Constraints honored:
 *  - No fake data. Every value comes from a Phase 6 hook.
 *  - No client-generated entity identifiers.
 *  - No "focus mode" product behavior beyond a clean
 *    single-question reader.
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
  useTestQuestions,
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
  const testId = attempt.data?.test_id;
  const questions = useTestQuestions(testId ?? null);

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

  // Authoritative question list, sorted by display_order. We
  // only have a query for this list once the attempt is loaded
  // (testId is non-null). Until then, the page renders with the
  // form disabled and an honest loading/error state.
  const orderedQuestions = (questions.data ?? [])
    .slice()
    .sort((a, b) => a.display_order - b.display_order);
  const currentStepQuestionId =
    orderedQuestions[recordedAnswers.length]?.question_id ?? null;

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
      title={
        isInProgress
          ? 'Attempt in progress'
          : attemptState === 'submitted'
            ? 'Submitted attempt'
            : attemptState === 'timed_out'
              ? 'Timed-out attempt'
              : attemptState === 'abandoned'
                ? 'Abandoned attempt'
                : 'Attempt'
      }
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
                  ? 'Attempt in progress'
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
              <NextQuestionStep
                testId={testId ?? null}
                questionIndex={recordedAnswers.length}
                totalQuestions={attempt.data.total_questions}
                questionsQuery={questions}
                authoritativeQuestionId={currentStepQuestionId}
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

interface NextQuestionStepProps {
  testId: string | null;
  questionIndex: number;
  totalQuestions: number;
  // We pass the whole useQuery result so the form can render a
  // honest loading / error state for the questions list. We
  // never substitute a synthesized id if the query is
  // unresolved.
  questionsQuery: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  authoritativeQuestionId: string | null;
  isAnswerPending: boolean;
  isAnswerError: boolean;
  answerError: unknown;
  onSubmit: (body: { question_id: string; free_text: string }) => void;
}

function NextQuestionStep({
  testId,
  questionIndex,
  totalQuestions,
  questionsQuery,
  authoritativeQuestionId,
  isAnswerPending,
  isAnswerError,
  answerError,
  onSubmit,
}: NextQuestionStepProps): JSX.Element {
  const stepLabel = `Question ${questionIndex + 1} of ${totalQuestions}`;

  // We render the form always, but disable submission until the
  // authoritative id is present. The user can still see the
  // prompt; the gate is the submit button, which is the
  // critical learning action that must wait for the server.
  //
  // The page also surfaces an honest inline error when the
  // questions query failed or when the test has fewer attached
  // questions than the attempt claims — both conditions mean we
  // cannot submit a trustworthy id and the form must remain
  // disabled.
  const questionsAvailable =
    !questionsQuery.isLoading &&
    !questionsQuery.isError &&
    authoritativeQuestionId !== null;

  const outOfRange =
    !questionsQuery.isLoading &&
    !questionsQuery.isError &&
    authoritativeQuestionId === null;

  return (
    <section
      className={styles.focus}
      data-testid="attempt-focus"
      aria-label={stepLabel}
    >
      <p className={styles.focusEyebrow}>{stepLabel}</p>
      {testId === null ? (
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="attempt-focus-no-test"
        >
          This attempt is not bound to a test. Answering is disabled until
          the attempt is associated with a test definition.
        </p>
      ) : null}
      {questionsQuery.isLoading ? (
        <p className={styles.muted} data-testid="attempt-focus-loading">
          Loading the question list…
        </p>
      ) : null}
      {questionsQuery.isError ? (
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="attempt-focus-questions-error"
        >
          {questionsQuery.error instanceof ApiError
            ? `Could not load the question list: ${questionsQuery.error.code} (${questionsQuery.error.status})`
            : 'Could not load the question list.'}
        </p>
      ) : null}
      {outOfRange ? (
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="attempt-focus-no-id"
        >
          The next question cannot be identified: the test has fewer attached
          questions than this attempt claims. Answering is disabled until
          the test definition is corrected.
        </p>
      ) : null}
      <form
        className={styles.focusForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!authoritativeQuestionId) return;
          const form = e.currentTarget;
          const data = new FormData(form);
          const freeTextRaw = data.get('free_text');
          const freeText =
            typeof freeTextRaw === 'string' ? freeTextRaw.trim() : '';
          if (!freeText) return;
          onSubmit({
            question_id: authoritativeQuestionId,
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
            disabled={isAnswerPending || !questionsAvailable}
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
