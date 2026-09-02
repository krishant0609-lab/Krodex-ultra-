'use client';

/**
 * KRODEX web — test detail page.
 *
 *   /tests/[id]
 *
 * Phase 7.6 visual layer:
 *  - Header with breadcrumbs (Tests → title), title block, and meta row.
 *  - A two-section body: a Test definition summary and the
 *    attached questions list. The questions list has its own
 *    loading / empty / error / populated state.
 *  - A "Start attempt" affordance that uses the existing
 *    `useStartTestAttempt` mutation. On success, navigates to
 *    /attempts/[attemptId] which the user can then answer.
 *
 * Hooks used (no new server state):
 *  - useTestDefinition(id)         → GET /tests/:id
 *  - useTestQuestions(id)          → GET /tests/:id/questions
 *  - useStartTestAttempt()         → POST /tests/attempts
 *
 * Out of scope: the actual question content (rendered on the
 * attempt page) and grading logic. This page is the catalog card.
 */

import { use } from '../../../../lib/react-async';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageShell } from '../../../../components/page-shell';
import { Badge } from '../../../../components/badge';
import { useTestDefinition, useTestQuestions, useStartTestAttempt } from '../../../../hooks/use-tests';
import { ApiError } from '../../../../lib/api-client';
import styles from '../tests.module.css';
import detailStyles from './test-detail.module.css';

interface TestDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function TestDetailPage({ params }: TestDetailPageProps): JSX.Element {
  const { id } = use(params);
  const router = useRouter();
  const test = useTestDefinition(id);
  const questions = useTestQuestions(id);
  const start = useStartTestAttempt();

  const isLoading = test.isLoading;
  const isError = test.isError;
  const isEmpty = !isLoading && !isError && !test.data;

  const handleStart = (): void => {
    start.mutate(
      { test_id: id },
      {
        onSuccess: (attempt) => {
          router.push(`/attempts/${attempt.id}`);
        },
      },
    );
  };

  return (
    <PageShell
      title={test.data?.title ?? 'Test'}
      eyebrow="Test"
      description={
        test.data
          ? `${test.data.intended_count} question${test.data.intended_count === 1 ? '' : 's'} · source: ${test.data.source_kind}`
          : `Test ${id}.`
      }
      isLoading={isLoading}
      isError={isError}
      error={test.error}
      isEmpty={isEmpty}
      emptyTitle="We couldn't find this test"
      emptyMessage={`The test id ${id} does not exist. It may have been retired, or the link may be incorrect.`}
      emptyAction={
        <Link href="/tests" style={{ color: 'var(--kd-color-text-link)' }}>
          Back to tests
        </Link>
      }
      actions={
        <button
          type="button"
          className={detailStyles.startButton}
          onClick={handleStart}
          disabled={
            start.isPending ||
            !test.data ||
            test.data.state === 'completed' ||
            test.data.state === 'expired'
          }
          data-testid="test-start-attempt"
        >
          {start.isPending ? 'Starting…' : 'Start attempt'}
        </button>
      }
    >
      {test.data ? (
        <header className={detailStyles.testHeader}>
          <p className={detailStyles.testBreadcrumbs}>
            <Link href="/tests" className={detailStyles.testBreadcrumbsLink}>
              Tests
            </Link>
            <span className={detailStyles.testBreadcrumbsSep} aria-hidden="true">
              {' / '}
            </span>
            <span className={detailStyles.testBreadcrumbsCurrent}>
              {test.data.title}
            </span>
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--kd-space-3)',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--kd-space-1)',
              }}
            >
              <p className={detailStyles.testEyebrow}>Test</p>
              <h1
                className={detailStyles.testTitle}
                data-testid="test-detail-title"
              >
                {test.data.title}
              </h1>
              <p className={detailStyles.testSubtitle}>
                {test.data.intended_count}{' '}
                {test.data.intended_count === 1 ? 'question' : 'questions'}
                {test.data.duration_minutes
                  ? ` · ${test.data.duration_minutes} min`
                  : ''}
              </p>
            </div>
            <div className={detailStyles.testMeta}>
              <Badge tone="lavender" size="sm">
                {test.data.state}
              </Badge>
              <Badge tone="champagne" size="sm">
                {test.data.source_kind}
              </Badge>
            </div>
          </div>
        </header>
      ) : null}

      <div className={detailStyles.testContent}>
        <h2 className={detailStyles.sectionHeading}>Questions</h2>

        {questions.isLoading ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="test-questions-loading"
            className={detailStyles.stateBand}
          >
            <div className={detailStyles.skeletonLine} aria-hidden="true" />
            <div
              className={`${detailStyles.skeletonLine} ${detailStyles.skeletonLineShort}`}
              aria-hidden="true"
            />
          </div>
        ) : null}

        {questions.isError ? (
          <div
            role="alert"
            data-testid="test-questions-error"
            className={detailStyles.stateBand}
          >
            <p className={detailStyles.stateBandTitle}>
              Couldn&apos;t load questions
            </p>
            <p className={detailStyles.stateBandBody}>
              {questions.error instanceof ApiError
                ? `${questions.error.code} (${questions.error.status})`
                : questions.error instanceof Error
                  ? questions.error.message
                  : 'Unknown error.'}
            </p>
          </div>
        ) : null}

        {!questions.isLoading &&
        !questions.isError &&
        (questions.data ?? []).length === 0 ? (
          <div
            data-testid="test-questions-empty"
            className={detailStyles.stateBand}
          >
            <p className={detailStyles.stateBandTitle}>No questions attached yet</p>
            <p className={detailStyles.stateBandBody}>
              This test has no attached questions. Edit the test to attach
              questions from the syllabus or the error book.
            </p>
          </div>
        ) : null}

        {!questions.isLoading &&
        !questions.isError &&
        (questions.data ?? []).length > 0 ? (
          <ol
            data-testid="test-questions-list"
            className={detailStyles.questionsList}
          >
            {(questions.data ?? []).map((q) => (
              <li
                key={q.id}
                className={detailStyles.questionsRow}
                data-testid={`test-question-${q.id}`}
              >
                <span className={detailStyles.questionsTitle}>
                  Question {q.display_order}
                </span>
                <code className={detailStyles.questionsCode}>{q.question_id}</code>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {start.isError ? (
        <p
          className={styles.testErrorMeta}
          role="alert"
          data-testid="test-start-error"
        >
          {start.error instanceof ApiError
            ? `Could not start an attempt: ${start.error.code} (${start.error.status})`
            : 'Could not start an attempt.'}
        </p>
      ) : null}
    </PageShell>
  );
}
