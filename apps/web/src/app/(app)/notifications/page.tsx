'use client';

/**
 * KRODEX web — Notifications (index).
 *
 *   /notifications
 *
 * Phase 7.10 visual layer:
 *  - Eyebrow "Inbox", title "Notifications", and a calm
 *    description that names the purpose (the inbox from
 *    completed tasks, review outcomes, and error-bank
 *    changes) without fabrication.
 *  - A list of notification rows. Each row shows: the
 *    kind, severity badge, title, optional body excerpt,
 *    and a "Mark read" action.
 *  - The read state is derived from `read_at` and
 *    `dismissed_at` — there is no `state` column on
 *    NotificationRow.
 *  - 7-state contract honored: loading, empty, error,
 *    populated. The empty state is honest: "Inbox zero"
 *    — we do not invent notifications.
 *  - Phase 12: header gains a "Preferences" link to
 *    /notifications/preferences.
 *
 * Hooks used (no new server state):
 *  - useNotifications({ limit: 50 })
 *  - useUpdateNotification(id)
 *
 * Out of scope: filtering by state. The page is the
 * read-and-act list; filtering is a future affordance.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageShell } from '../../../components/page-shell';
import { Badge } from '../../../components/badge';
import { ApiError } from '../../../lib/api-client';
import {
  useNotifications,
  useUpdateNotification,
} from '../../../hooks/use-notifications';
import { formatShortDate } from '../../../lib/format-date';
import styles from './notifications.module.css';

const SEVERITY_TONES = {
  info: 'lavender',
  success: 'success',
  warning: 'champagne',
  critical: 'rose',
} as const;

type Severity = keyof typeof SEVERITY_TONES;

const KIND_FILTERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'review_due', label: 'Review due' },
  { id: 'review_overdue', label: 'Review overdue' },
  { id: 'error_recorded', label: 'Errors' },
  { id: 'task_missed', label: 'Task missed' },
  { id: 'task_completed', label: 'Task completed' },
  { id: 'task_upcoming', label: 'Task upcoming' },
  { id: 'backlog_recovery', label: 'Backlog' },
  { id: 'attempt_analyzed', label: 'Attempts' },
];

function excerpt(text: string | null): string {
  if (!text) return '';
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine;
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

interface NotificationRowProps {
  id: string;
  kind: string;
  severity: Severity | null;
  title: string;
  body: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

function NotificationRow({
  id,
  kind,
  severity,
  title,
  body,
  readAt,
  dismissedAt,
  createdAt,
}: NotificationRowProps): JSX.Element {
  const update = useUpdateNotification(id);
  const isRead = readAt !== null || dismissedAt !== null;
  const createdLabel = formatShortDate(createdAt) ?? '—';
  const bodyText = excerpt(body);

  const handleMarkRead = (): void => {
    update.mutate({ state: 'read' });
  };

  return (
    <li
      className={styles.item}
      data-testid={`notifications-item-${id}`}
      data-state={isRead ? 'read' : 'unread'}
    >
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <div className={styles.rowMeta}>
            <Badge
              tone={severity ? SEVERITY_TONES[severity] : 'lavender'}
              size="sm"
            >
              {severity ?? 'info'}
            </Badge>
            <span className={styles.rowKind}>{kind}</span>
            {!isRead ? (
              <span className={styles.unreadDot} aria-label="unread">
                ●
              </span>
            ) : null}
          </div>
          <h3 className={styles.rowTitle} data-testid={`notifications-title-${id}`}>
            {title}
          </h3>
          {bodyText ? (
            <p className={styles.rowBody}>{bodyText}</p>
          ) : null}
        </div>
        <div className={styles.rowAside}>
          <span className={styles.rowLabel}>Received</span>
          <span className={styles.rowDate}>{createdLabel}</span>
          {isRead ? (
            <span className={styles.rowReadTag}>read</span>
          ) : (
            <button
              type="button"
              className={styles.markButton}
              onClick={handleMarkRead}
              disabled={update.isPending}
              data-testid={`notifications-mark-read-${id}`}
            >
              {update.isPending ? 'Saving…' : 'Mark read'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function NotificationsPage(): JSX.Element {
  // useSearchParams() in the inner component requires a Suspense
  // boundary at the page level so Next.js can bail out of static
  // prerendering cleanly.
  return (
    <Suspense fallback={null}>
      <NotificationsPageContent />
    </Suspense>
  );
}

function NotificationsPageContent(): JSX.Element {
  const searchParams = useSearchParams();
  const kindFilter = searchParams.get('kind') ?? undefined;
  const notifications = useNotifications(
    kindFilter ? { kind: kindFilter, limit: 50 } : { limit: 50 },
  );
  const items = notifications.data?.items ?? [];
  const isEmpty =
    !notifications.isLoading && !notifications.isError && items.length === 0;

  return (
    <PageShell
      title="Notifications"
      eyebrow="Inbox"
      description="Inbox from completed tasks, review outcomes, and error-bank changes. Mark a row read when you have dealt with it."
      isLoading={notifications.isLoading}
      isError={notifications.isError}
      error={notifications.error}
      isEmpty={isEmpty}
      emptyTitle="Inbox zero"
      emptyMessage="Nothing has been written to your inbox yet. New items will appear here as the system produces them."
      actions={
        <Link
          href="/notifications/preferences"
          data-testid="notifications-prefs-link"
          className={styles.prefsLink}
        >
          Preferences
        </Link>
      }
    >
      <ol className={styles.list} data-testid="notifications-list">
        {items.map((n) => (
          <NotificationRow
            key={n.id}
            id={n.id}
            kind={n.kind}
            severity={
              n.severity && SEVERITY_TONES[n.severity as Severity]
                ? (n.severity as Severity)
                : null
            }
            title={isString(n.title) ? n.title : n.kind}
            body={typeof n.body === 'string' ? n.body : null}
            readAt={n.read_at}
            dismissedAt={n.dismissed_at}
            createdAt={n.created_at}
          />
        ))}
      </ol>
      <nav
        className={styles.filterBar}
        aria-label="Filter by kind"
        data-testid="notifications-filter-bar"
      >
        <Link
          href="/notifications"
          className={styles.filterChip}
          data-active={kindFilter ? undefined : 'true'}
          data-testid="notifications-filter-all"
        >
          All
        </Link>
        {KIND_FILTERS.map((k) => (
          <Link
            key={k.id}
            href={`/notifications?kind=${encodeURIComponent(k.id)}`}
            className={styles.filterChip}
            data-active={kindFilter === k.id ? 'true' : undefined}
            data-testid={`notifications-filter-${k.id}`}
          >
            {k.label}
          </Link>
        ))}
      </nav>
      {notifications.isError ? (
        <p className={styles.errorMeta} role="status">
          {notifications.error instanceof ApiError
            ? `${notifications.error.code} (${notifications.error.status})`
            : 'Could not load notifications.'}
        </p>
      ) : null}
    </PageShell>
  );
}
