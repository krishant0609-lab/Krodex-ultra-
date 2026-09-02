'use client';

/**
 * KRODEX web — Error Book (index).
 *
 *   /errors
 *
 * Phase 7.7 visual layer:
 *  - Eyebrow "Error book", title "Errors", and a calm
 *    description that names the purpose without fabrication.
 *  - A list of error entries. Each row is a deep link to
 *    /errors/[id] and shows: mistake_type badge, status
 *    badge, recurrence count, last-seen date, and the
 *    first line of the remark (if any).
 *  - 7-state contract honored: loading, empty, error,
 *    populated. The empty state is honest: "No errors
 *    recorded yet" — we do not invent a starter entry.
 *
 * Hooks used (no new server state):
 *  - useErrorEntries({ limit: 50 })
 *
 * Out of scope: creating new errors from this page (the
 * capture flow is Phase 9). This page is the read-only book.
 */

import Link from 'next/link';
import { PageShell } from '../../../components/page-shell';
import { Badge } from '../../../components/badge';
import { ApiError } from '../../../lib/api-client';
import { useErrorEntries } from '../../../hooks/use-errors';
import { formatShortDate } from '../../../lib/format-date';
import styles from './errors.module.css';

const STATUS_TONES = {
  active: 'rose',
  in_review: 'champagne',
  resolved: 'success',
  reopened: 'rose',
  archived: 'lavender',
} as const;

type ErrorEntryStatus = keyof typeof STATUS_TONES;

const MISTAKE_TONES = {
  concept: 'lavender',
  calculation: 'champagne',
  misread: 'lavender',
  time_pressure: 'champagne',
  careless: 'rose',
  method: 'lavender',
  unknown: 'lavender',
} as const;

type MistakeType = keyof typeof MISTAKE_TONES;

function remarkExcerpt(remark: string | null): string {
  if (!remark) return '';
  // Take the first non-empty line, trimmed, and bound by length.
  const firstLine = remark
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

export default function ErrorsPage(): JSX.Element {
  const errors = useErrorEntries({ limit: 50 });
  const items = errors.data?.items ?? [];
  const isEmpty = !errors.isLoading && !errors.isError && items.length === 0;

  return (
    <PageShell
      title="Errors"
      eyebrow="Error book"
      description="A record of the mistakes you've logged. Open a row to see its context, mark it resolved, or reopen it."
      isLoading={errors.isLoading}
      isError={errors.isError}
      error={errors.error}
      isEmpty={isEmpty}
      emptyTitle="No errors recorded yet"
      emptyMessage="When you record a mistake — from an attempt or by hand — it will show up here."
    >
      <ol className={styles.list} data-testid="errors-list">
        {items.map((entry) => {
          const status = entry.status as ErrorEntryStatus;
          const statusTone = STATUS_TONES[status] ?? 'lavender';
          const mistakeType = entry.mistake_type as MistakeType | null;
          const mistakeTone = mistakeType
            ? MISTAKE_TONES[mistakeType]
            : 'lavender';
          const excerpt = remarkExcerpt(entry.remark);
          return (
            <li
              key={entry.id}
              className={styles.item}
              data-testid={`errors-item-${entry.id}`}
            >
              <Link
                href={`/errors/${entry.id}`}
                className={styles.row}
                data-testid={`errors-row-${entry.id}`}
              >
                <div className={styles.rowMain}>
                  <div className={styles.rowMeta}>
                    {mistakeType ? (
                      <Badge tone={mistakeTone} size="sm">
                        {mistakeType}
                      </Badge>
                    ) : null}
                    <Badge tone={statusTone} size="sm">
                      {entry.status}
                    </Badge>
                    <span className={styles.rowRecurrence}>
                      {entry.recurrence_count}{' '}
                      {entry.recurrence_count === 1
                        ? 'recurrence'
                        : 'recurrences'}
                    </span>
                  </div>
                  {excerpt ? (
                    <p className={styles.rowRemark}>{excerpt}</p>
                  ) : (
                    <p className={styles.rowRemarkMuted}>
                      No remark recorded.
                    </p>
                  )}
                </div>
                <div className={styles.rowAside}>
                  <span className={styles.rowLabel}>Last seen</span>
                  <span className={styles.rowDate}>
                    {formatShortDate(entry.last_seen_at)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
      {errors.isError ? (
        <p className={styles.errorMeta} role="status">
          {errors.error instanceof ApiError
            ? `${errors.error.code} (${errors.error.status})`
            : 'Could not load errors.'}
        </p>
      ) : null}
    </PageShell>
  );
}
