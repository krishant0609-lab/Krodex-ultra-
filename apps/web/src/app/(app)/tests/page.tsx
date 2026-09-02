'use client';

/**
 * KRODEX web — tests index page.
 *
 *   /tests
 *
 * Phase 7.6 visual layer:
 *  - Editorial shell with a hero strip (eyebrow + title + subtitle)
 *    followed by a quiet list of test definitions.
 *  - Each test card is a deep link to /tests/[id].
 *  - The 7-state contract is honored: loading, empty, error, populated.
 *  - No fake data — every value comes from `useTestDefinitions`.
 *
 * Out of scope (Phase 7.6+): starting attempts inline, review state,
 *  filtering, sorting. This page is the catalog.
 */

import Link from 'next/link';
import { PageShell } from '../../../components/page-shell';
import { Badge } from '../../../components/badge';
import { useTestDefinitions } from '../../../hooks/use-tests';
import { ApiError } from '../../../lib/api-client';
import styles from './tests.module.css';

export default function TestsPage(): JSX.Element {
  const tests = useTestDefinitions({ limit: 50 });
  const items = tests.data?.items ?? [];
  const isEmpty = !tests.isLoading && !tests.isError && items.length === 0;

  return (
    <PageShell
      title="Tests"
      eyebrow="Library"
      description="Test definitions authored for or by you. Open one to review its questions or start an attempt."
      isLoading={tests.isLoading}
      isError={tests.isError}
      error={tests.error}
      isEmpty={isEmpty}
      emptyTitle="No tests yet"
      emptyMessage="Author a test to start an attempt. Tests pull from the syllabus, the error book, or a mix."
    >
      <ul className={styles.testList} data-testid="tests-items">
        {items.map((test) => (
          <li key={test.id} className={styles.testItem}>
            <Link
              href={`/tests/${test.id}`}
              className={styles.testRow}
              data-testid={`tests-item-${test.id}`}
            >
              <span className={styles.testTitle}>{test.title}</span>
              <span className={styles.testMeta}>
                <Badge tone="lavender" size="sm">
                  {test.state}
                </Badge>
                <Badge tone="champagne" size="sm">
                  {test.source_kind}
                </Badge>
                <span className={styles.testCount}>
                  {test.intended_count}{' '}
                  {test.intended_count === 1 ? 'question' : 'questions'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {tests.isError ? (
        <p className={styles.testErrorMeta} role="alert">
          {tests.error instanceof ApiError
            ? `${tests.error.code} (${tests.error.status})`
            : tests.error instanceof Error
              ? tests.error.message
              : 'Unknown error.'}
        </p>
      ) : null}
    </PageShell>
  );
}
