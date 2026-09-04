'use client';

/**
 * KRODEX web — Error entry detail.
 *
 *   /errors/[id]
 *
 * Phase 7.7 visual layer:
 *  - Breadcrumbs: Errors → entry id.
 *  - Title block: mistake_type + status (visual badges).
 *  - Meta row: recurrence_count, first/last seen dates,
 *    resolved_at (when present), source_attempt_id.
 *  - Action row: "Mark resolved" (active → resolved) and
 *    "Reopen" (resolved/reopened → active) — surfaced only
 *    when the corresponding transition is valid.
 *  - Remark section: full remark text, or a quiet fallback
 *    if none was recorded.
 *  - Linked-questions placeholder section: a calm
 *    "linked questions will appear here once recorded"
 *    message (the linked-questions endpoint is wired in
 *    hooks; the page reads the field when the API exposes
 *    it on the entry, otherwise shows the placeholder).
 *
 * Hooks used (no new server state):
 *  - useErrorEntry(id)
 *  - useUpdateErrorEntry(id)
 *
 * 7-state contract honored: loading, empty (NOT_FOUND),
 * error, populated. (NOT_FOUND renders as an honest
 * "we couldn't find this entry" card, not as a fake
 * "0 mistakes" success state.)
 */

import { use } from '../../../../lib/react-async';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageShell } from '../../../../components/page-shell';
import { Badge } from '../../../../components/badge';
import { ApiError } from '../../../../lib/api-client';
import { useErrorEntry, useUpdateErrorEntry } from '../../../../hooks/use-errors';
import { formatShortDate, formatLongDate } from '../../../../lib/format-date';
import { ClassificationSuggestCard } from './classification-suggest-card';
import { EvidenceSection } from './components/evidence-section';
import { LifecycleHistory } from './components/lifecycle-history';
import styles from './error-detail.module.css';

interface ErrorDetailPageProps {
  params: Promise<{ id: string }>;
}

const STATUS_TONES = {
  active: 'rose',
  in_review: 'champagne',
  resolved: 'success',
  reopened: 'rose',
  archived: 'lavender',
} as const;

const MISTAKE_TONES = {
  concept: 'lavender',
  calculation: 'champagne',
  misread: 'lavender',
  time_pressure: 'champagne',
  careless: 'rose',
  method: 'lavender',
  unknown: 'lavender',
} as const;

type ErrorEntryStatus = keyof typeof STATUS_TONES;
type MistakeType = keyof typeof MISTAKE_TONES;

export default function ErrorDetailPage({
  params,
}: ErrorDetailPageProps): JSX.Element {
  const { id } = use(params);
  const router = useRouter();
  const entry = useErrorEntry(id);
  const update = useUpdateErrorEntry(id);

  const isLoading = entry.isLoading;
  const isError = entry.isError;
  const isEmpty = !isLoading && !isError && !entry.data;

  const handleMarkResolved = (): void => {
    update.mutate(
      { status: 'resolved' },
      {
        onSuccess: () => {
          // Stay on the page; the entry refetches and shows
          // the resolved state.
        },
      },
    );
  };

  const handleReopen = (): void => {
    // The error state machine allows `resolved -> reopened` only
    // (reopened is the canonical "I saw this mistake again" state
    // and drives a `error.lifecycle.reopened` event + notification).
    // Sending `active` would be illegal and the API would 400.
    update.mutate({ status: 'reopened' });
  };

  const handleArchive = (): void => {
    update.mutate({ status: 'archived' });
  };

  return (
    <PageShell
      title={
        entry.data?.mistake_type
          ? `${entry.data.mistake_type} mistake`
          : 'Error entry'
      }
      eyebrow="Error book"
      description={
        entry.data
          ? `Entry ${entry.data.id} · recorded ${formatShortDate(
              entry.data.first_seen_at,
            )}`
          : `Error entry ${id}.`
      }
      isLoading={isLoading}
      isError={isError}
      error={entry.error}
      isEmpty={isEmpty}
      emptyTitle="We couldn't find this error entry"
      emptyMessage={`The entry id ${id} does not exist. It may have been archived or the link may be incorrect.`}
      emptyAction={
        <Link href="/errors" style={{ color: 'var(--kd-color-text-link)' }}>
          Back to error book
        </Link>
      }
      actions={
        entry.data &&
        entry.data.status !== 'resolved' &&
        entry.data.status !== 'archived' ? (
          <button
            type="button"
            className={styles.primaryAction}
            onClick={handleMarkResolved}
            disabled={update.isPending}
            data-testid="error-mark-resolved"
          >
            {update.isPending ? 'Saving…' : 'Mark resolved'}
          </button>
        ) : null
      }
    >
      {entry.data ? (
        <article className={styles.detail}>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumbs">
            <Link href="/errors" className={styles.breadcrumbsLink}>
              Errors
            </Link>
            <span className={styles.breadcrumbsSep}>›</span>
            <span className={styles.breadcrumbsCurrent}>
              {entry.data.id}
            </span>
          </nav>

          <header className={styles.header}>
            <p className={styles.eyebrow}>Error entry</p>
            <h1 className={styles.title} data-testid="error-title">
              {entry.data.mistake_type
                ? `${entry.data.mistake_type} mistake`
                : 'Unclassified mistake'}
            </h1>
            <div className={styles.metaRow}>
              {entry.data.mistake_type ? (
                <Badge
                  tone={
                    MISTAKE_TONES[entry.data.mistake_type as MistakeType] ??
                    'lavender'
                  }
                  size="sm"
                >
                  {entry.data.mistake_type}
                </Badge>
              ) : null}
              <Badge
                tone={
                  STATUS_TONES[entry.data.status as ErrorEntryStatus] ??
                  'lavender'
                }
                size="sm"
              >
                {entry.data.status}
              </Badge>
              <span className={styles.metaMono}>
                {entry.data.recurrence_count}{' '}
                {entry.data.recurrence_count === 1
                  ? 'recurrence'
                  : 'recurrences'}
              </span>
            </div>
            <p className={styles.subtitle}>
              {entry.data.status === 'resolved'
                ? 'This entry is closed. You can reopen it if the mistake came back.'
                : entry.data.status === 'archived'
                  ? 'This entry is archived and no longer counts toward your active list.'
                  : 'This entry is on your active list. Mark it resolved when you have a clean run.'}
            </p>
          </header>

          {/* Phase 8: AI classification suggestion. Shown only for
              unclassified entries. The card is self-contained: it
              fetches its own suggestion, shows the manual fallback
              when AI is unavailable, and writes the chosen category
              through the existing update hook. */}
          <ClassificationSuggestCard
            errorId={entry.data.id}
            currentCategory={entry.data.mistake_type}
          />

          <section className={styles.section} aria-label="Dates">
            <h2 className={styles.sectionHeading}>Dates</h2>
            <dl className={styles.dl}>
              <dt>First seen</dt>
              <dd>
                {formatLongDate(entry.data.first_seen_at)}
              </dd>
              <dt>Last seen</dt>
              <dd>
                {formatLongDate(entry.data.last_seen_at)}
              </dd>
              {entry.data.resolved_at ? (
                <>
                  <dt>Resolved</dt>
                  <dd>{formatLongDate(entry.data.resolved_at)}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className={styles.section} aria-label="Remark">
            <h2 className={styles.sectionHeading}>Remark</h2>
            {entry.data.remark ? (
              <p className={styles.remark} data-testid="error-remark">
                {entry.data.remark}
              </p>
            ) : (
              <p className={styles.remarkEmpty} data-testid="error-remark-empty">
                No remark was recorded for this entry.
              </p>
            )}
          </section>

          <section
            className={styles.section}
            aria-label="Source and linked questions"
          >
            <h2 className={styles.sectionHeading}>Source &amp; links</h2>
            <dl className={styles.dl}>
              {entry.data.source_attempt_id ? (
                <>
                  <dt>From attempt</dt>
                  <dd>
                    <code className={styles.code}>
                      {entry.data.source_attempt_id}
                    </code>
                  </dd>
                </>
              ) : (
                <>
                  <dt>Source</dt>
                  <dd className={styles.muted}>
                    Recorded by hand, not from an attempt.
                  </dd>
                </>
              )}
              {entry.data.question_id ? (
                <>
                  <dt>Question</dt>
                  <dd>
                    <code className={styles.code}>{entry.data.question_id}</code>
                  </dd>
                </>
              ) : null}
            </dl>
          </section>

          {/* Phase 9: per-attempt evidence rows. The list query is
              cheap (no signed URLs); the per-row snapshot is fetched
              lazily when the student clicks "view". */}
          <EvidenceSection errorId={entry.data.id} />

          {/* Phase 9: immutable lifecycle timeline. Newest first;
              append-only on the server, read-only on the client. */}
          <LifecycleHistory errorId={entry.data.id} />

          {entry.data.status === 'resolved' ||
          entry.data.status === 'archived' ? (
            <div className={styles.secondaryActions}>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={handleReopen}
                disabled={update.isPending}
                data-testid="error-reopen"
              >
                Reopen
              </button>
              {entry.data.status !== 'archived' ? (
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={handleArchive}
                  disabled={update.isPending}
                  data-testid="error-archive"
                >
                  Archive
                </button>
              ) : null}
            </div>
          ) : null}

          {update.isError ? (
            <p
              className={styles.errorMeta}
              role="alert"
              data-testid="error-update-error"
            >
              {update.error instanceof ApiError
                ? `Update failed: ${update.error.code} (${update.error.status})`
                : 'Update failed.'}
            </p>
          ) : null}

          {update.isSuccess && entry.data.status === 'resolved' ? (
            <p
              className={styles.successMeta}
              role="status"
              data-testid="error-update-success"
            >
              Marked as resolved.
            </p>
          ) : null}

          <p className={styles.footnote}>
            <a
              href="/errors"
              className={styles.footnoteLink}
              onClick={(e) => {
                e.preventDefault();
                router.push('/errors');
              }}
            >
              Back to error book
            </a>
          </p>
        </article>
      ) : null}
    </PageShell>
  );
}
