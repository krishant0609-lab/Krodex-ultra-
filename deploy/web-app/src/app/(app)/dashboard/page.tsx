'use client';

/**
 * KRODEX web — dashboard.
 *
 * Phase 7.4: editorial layout. The page is a one-screen summary
 * of every surface, composed from real Phase 6 hooks:
 *
 *   1. Hero strip — real date, single CTA into /planner.
 *   2. Stat row   — one tile per surface, value from the hook.
 *   3. Surface grid — top-5 items per surface, deep-linked.
 *
 * Constraints (Phase 7 / this phase):
 *   - No fake data. Every value is from a real query.
 *   - No fabricated metrics. If a query has no data, the
 *     surface is empty (not "0 of 0").
 *   - The dashboard is a real view of the same endpoints
 *     the dedicated pages use.
 *
 * The "Today" label uses the user's local date — not a stored
 * value. It is the only place the page resolves `new Date()`,
 * and it is read once on mount and discarded.
 */

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '../../../components/button';
import { usePlannerTasks } from '../../../hooks/use-planner';
import { useReviewSchedules } from '../../../hooks/use-reviews';
import { useErrorEntries } from '../../../hooks/use-errors';
import { useNotifications } from '../../../hooks/use-notifications';
import {
  formatLongDate,
  formatShortDate,
  formatTimeOfDay,
  toIsoDateOnly,
} from '../../../lib/format-date';
import {
  DashboardSummaryCard,
  DashboardStatTile,
} from './dashboard-summary-card';
import styles from './dashboard.module.css';

const PLANNER_HREF = '/planner';
const REVIEWS_HREF = '/reviews';
const ERRORS_HREF = '/errors';
const INBOX_HREF = '/notifications';

export default function DashboardPage(): JSX.Element {
  const today = useMemo(() => new Date().toISOString(), []);
  const todayIso = useMemo(() => toIsoDateOnly(today), [today]);
  const longDate = useMemo(() => formatLongDate(today), [today]);

  const tasks = usePlannerTasks({ state: 'planned', limit: 5 });
  const reviews = useReviewSchedules({ state: 'due', limit: 5 });
  const errors = useErrorEntries({ status: 'active', limit: 5 });
  const notifications = useNotifications({ state: 'unread', limit: 5 });

  const taskItems = tasks.data?.items ?? [];
  const reviewItems = reviews.data?.items ?? [];
  const errorItems = errors.data?.items ?? [];
  const notificationItems = notifications.data?.items ?? [];

  // The hero subtitle is composed from the four real query
  // states — a single sentence that names what is present and
  // what is not, without inventing counts.
  const heroSubtitle = useMemo<string>(() => {
    const parts: string[] = [];
    if (tasks.isError || reviews.isError || errors.isError || notifications.isError) {
      parts.push('Some surfaces could not be loaded — open the affected view to retry.');
    } else if (
      taskItems.length === 0 &&
      reviewItems.length === 0 &&
      errorItems.length === 0 &&
      notificationItems.length === 0
    ) {
      parts.push('Nothing waiting for you across the planner, review queue, error book, or inbox.');
    } else {
      if (taskItems.length > 0) parts.push('Tasks are waiting in the planner.');
      if (reviewItems.length > 0) parts.push('Reviews are due.');
      if (errorItems.length > 0) parts.push('Active errors are in the book.');
      if (notificationItems.length > 0) parts.push('The inbox has unread items.');
    }
    return parts.join(' ');
  }, [
    tasks.isError,
    reviews.isError,
    errors.isError,
    notifications.isError,
    taskItems.length,
    reviewItems.length,
    errorItems.length,
    notificationItems.length,
  ]);

  return (
    <div className={styles.dashboard} data-testid="dashboard">
      <header className={styles.heroStrip}>
        <div className={styles.heroDate}>
          <p className={styles.heroEyebrow}>Dashboard</p>
          <h1 className={styles.heroTitle}>{longDate ?? 'Today'}</h1>
          <p className={styles.heroSubtitle}>{heroSubtitle}</p>
        </div>
        <div className={styles.heroActions}>
          <Link href={PLANNER_HREF} prefetch={false}>
            <Button variant="primary" size="md" data-testid="dashboard-cta-planner">
              Open planner
            </Button>
          </Link>
        </div>
      </header>

      <section
        className={styles.statRow}
        aria-label="Surface summary"
        data-testid="dashboard-stat-row"
      >
        <DashboardStatTile
          surface="tasks"
          href={PLANNER_HREF}
          label="Planned"
          value={taskItems.length}
          meta="Tasks in the planner"
          isLoading={tasks.isLoading}
          isError={tasks.isError}
        />
        <DashboardStatTile
          surface="reviews"
          href={REVIEWS_HREF}
          label="Due"
          value={reviewItems.length}
          meta="Reviews waiting"
          isLoading={reviews.isLoading}
          isError={reviews.isError}
        />
        <DashboardStatTile
          surface="errors"
          href={ERRORS_HREF}
          label="Active"
          value={errorItems.length}
          meta="Errors in the book"
          isLoading={errors.isLoading}
          isError={errors.isError}
        />
        <DashboardStatTile
          surface="inbox"
          href={INBOX_HREF}
          label="Unread"
          value={notificationItems.length}
          meta="Inbox items"
          isLoading={notifications.isLoading}
          isError={notifications.isError}
        />
      </section>

      <section
        className={styles.surfaceGrid}
        aria-label="Top items per surface"
        data-testid="dashboard-surface-grid"
      >
        <DashboardSummaryCard
          surface="tasks"
          eyebrow="Planner"
          title="Planned tasks"
          cta={
            <Link href={PLANNER_HREF} prefetch={false}>
              <Button variant="ghost" size="sm" data-testid="dashboard-tasks-cta">
                Open
              </Button>
            </Link>
          }
          isLoading={tasks.isLoading}
          isError={tasks.isError}
          error={tasks.error}
          items={taskItems}
          renderKey={(t) => t.id}
          renderItem={(t) => t.title}
          renderItemMeta={(t) => {
            if (t.plan_date === todayIso) return 'Today';
            return formatShortDate(t.plan_date) ?? '—';
          }}
          renderItemHref={() => PLANNER_HREF}
          emptyTitle="No planned tasks"
          emptyBody={
            todayIso
              ? `There is nothing scheduled for ${formatShortDate(todayIso) ?? 'today'}.`
              : 'There is nothing scheduled. Add a task to get started.'
          }
        />

        <DashboardSummaryCard
          surface="reviews"
          eyebrow="Reviews"
          title="Due to review"
          cta={
            <Link href={REVIEWS_HREF} prefetch={false}>
              <Button variant="ghost" size="sm" data-testid="dashboard-reviews-cta">
                Open
              </Button>
            </Link>
          }
          isLoading={reviews.isLoading}
          isError={reviews.isError}
          error={reviews.error}
          items={reviewItems}
          renderKey={(r) => r.id}
          renderItem={(r) => `Error ${r.error_id.slice(0, 8)}`}
          renderItemMeta={(r) => {
            const time = formatTimeOfDay(r.due_at);
            return time ? `Due ${time}` : '—';
          }}
          renderItemHref={(r) => `/reviews/${r.id}`}
          emptyTitle="No reviews due"
          emptyBody="The review queue is empty. New reviews appear here as errors recur."
        />

        <DashboardSummaryCard
          surface="errors"
          eyebrow="Error book"
          title="Active errors"
          cta={
            <Link href={ERRORS_HREF} prefetch={false}>
              <Button variant="ghost" size="sm" data-testid="dashboard-errors-cta">
                Open
              </Button>
            </Link>
          }
          isLoading={errors.isLoading}
          isError={errors.isError}
          error={errors.error}
          items={errorItems}
          renderKey={(e) => e.id}
          renderItem={(e) => e.mistake_type ?? 'Uncategorised'}
          renderItemMeta={(e) =>
            e.recurrence_count > 0 ? `×${e.recurrence_count}` : '×1'
          }
          renderItemHref={(e) => `/errors/${e.id}`}
          emptyTitle="No active errors"
          emptyBody="The error book is empty. Submitting a test with incorrect answers will add the first entry."
        />

        <DashboardSummaryCard
          surface="inbox"
          eyebrow="Inbox"
          title="Unread notifications"
          cta={
            <Link href={INBOX_HREF} prefetch={false}>
              <Button variant="ghost" size="sm" data-testid="dashboard-inbox-cta">
                Open
              </Button>
            </Link>
          }
          isLoading={notifications.isLoading}
          isError={notifications.isError}
          error={notifications.error}
          items={notificationItems}
          renderKey={(n) => n.id}
          renderItem={(n) => n.title}
          renderItemMeta={(n) => n.severity}
          renderItemHref={() => INBOX_HREF}
          emptyTitle="Inbox zero"
          emptyBody="You have no unread notifications."
        />
      </section>
    </div>
  );
}

/** Helper exported for the dashboard test — never used at runtime. */
export const _internal = {
  heroSubtitleFor: (lengths: {
    tasks: number;
    reviews: number;
    errors: number;
    inbox: number;
  }): ReactNode => {
    const parts: string[] = [];
    if (lengths.tasks > 0) parts.push('Tasks are waiting in the planner.');
    if (lengths.reviews > 0) parts.push('Reviews are due.');
    if (lengths.errors > 0) parts.push('Active errors are in the book.');
    if (lengths.inbox > 0) parts.push('The inbox has unread items.');
    if (parts.length === 0) {
      return 'Nothing waiting for you across the planner, review queue, error book, or inbox.';
    }
    return parts.join(' ');
  },
};
