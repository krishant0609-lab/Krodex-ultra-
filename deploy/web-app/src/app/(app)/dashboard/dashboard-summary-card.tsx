'use client';

/**
 * KRODEX web — dashboard surface card.
 *
 * A single editorial card that renders one of four states for a
 * dashboard surface (Tasks, Reviews, Errors, Inbox):
 *
 *   1. Loading    — pulsing skeleton lines (no spinner icon)
 *   2. Empty      — dashed message inside the card
 *   3. Error      — red-tinted band with a calm error message
 *   4. Populated  — list of items (text rows or links)
 *
 * State resolution is explicit and conservative: a query that
 * has not yet returned is Loading even if `data` is undefined;
 * a query that returned zero items is Empty (truthful);
 * a query that errored is Error; otherwise Populated.
 *
 * No fake data is generated. The component never shows
 * "0" as Populated — empty is its own visual state.
 */

import type { ReactNode } from 'react';
import { Card } from '../../../components/card';
import { Badge } from '../../../components/badge';
import { ApiError } from '../../../lib/api-client';
import styles from './dashboard.module.css';

export type SurfaceState = 'loading' | 'empty' | 'error' | 'populated';

export interface DashboardSummaryCardProps<T> {
  /** The test-id suffix used to make data-testid unique. */
  surface: 'tasks' | 'reviews' | 'errors' | 'inbox';
  eyebrow: string;
  title: string;
  /** CTA shown in the card header (right-aligned). */
  cta?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  items: readonly T[];
  /** Stable key for each list row. */
  renderKey: (item: T) => string;
  /** Renders the visible text for a populated row. */
  renderItem: (item: T) => ReactNode;
  /** Optional right-aligned metadata for the row (e.g. "Due 14:30"). */
  renderItemMeta?: (item: T) => ReactNode;
  /** If provided, the row becomes a link to this URL (deep link). */
  renderItemHref?: (item: T) => string;
  emptyTitle: string;
  emptyBody: string;
  maxItems?: number;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.code} (${err.status})`;
  if (err instanceof Error) return err.message;
  return 'Unknown error.';
}

function resolveState<T>(
  props: DashboardSummaryCardProps<T>,
  truncatedLength: number,
): SurfaceState {
  if (props.isError) return 'error';
  if (props.isLoading) return 'loading';
  if (truncatedLength === 0) return 'empty';
  return 'populated';
}

export function DashboardSummaryCard<T>({
  surface,
  eyebrow,
  title,
  cta,
  isLoading,
  isError,
  error,
  items,
  renderKey,
  renderItem,
  renderItemMeta,
  renderItemHref,
  emptyTitle,
  emptyBody,
  maxItems = 5,
}: DashboardSummaryCardProps<T>): JSX.Element {
  const visible = items.slice(0, maxItems);
  const state = resolveState(
    { isLoading, isError, error, items, renderKey, renderItem, surface, eyebrow, title, cta, renderItemMeta, renderItemHref, emptyTitle, emptyBody, maxItems },
    visible.length,
  );

  return (
    <Card
      tone="raised"
      padding="md"
      className={styles.surfaceCard}
      data-testid={`dashboard-card-${surface}`}
      data-state={state}
      aria-busy={state === 'loading' ? true : undefined}
    >
      <Card.Header>
        <div>
          <Card.Eyebrow>{eyebrow}</Card.Eyebrow>
          <Card.Title level={2}>{title}</Card.Title>
        </div>
        {cta}
      </Card.Header>

      {state === 'loading' ? (
        <div
          role="status"
          aria-live="polite"
          data-testid={`dashboard-${surface}-loading`}
          className={styles.surfaceLoading}
        >
          <div className={styles.surfaceLoadingLine} aria-hidden="true" />
          <div className={styles.surfaceLoadingLine} aria-hidden="true" />
          <div
            className={`${styles.surfaceLoadingLine} ${styles.surfaceLoadingLineShort}`}
            aria-hidden="true"
          />
        </div>
      ) : null}

      {state === 'error' ? (
        <div
          role="alert"
          data-testid={`dashboard-${surface}-error`}
          className={styles.surfaceError}
        >
          <p className={styles.surfaceErrorTitle}>Couldn&apos;t load this view</p>
          <p className={styles.surfaceErrorMeta}>{describeError(error)}</p>
        </div>
      ) : null}

      {state === 'empty' ? (
        <div
          data-testid={`dashboard-${surface}-empty`}
          className={styles.surfaceEmpty}
        >
          <p className={styles.surfaceEmptyTitle}>{emptyTitle}</p>
          <p className={styles.surfaceEmptyBody}>{emptyBody}</p>
        </div>
      ) : null}

      {state === 'populated' ? (
        <ul className={styles.surfaceItems} data-testid={`dashboard-${surface}-items`}>
          {visible.map((item) => {
            const href = renderItemHref?.(item);
            const meta = renderItemMeta?.(item);
            if (href) {
              return (
                <li key={renderKey(item)}>
                  <a
                    href={href}
                    className={styles.surfaceItemLink}
                    data-testid={`dashboard-${surface}-row`}
                  >
                    <span className={styles.surfaceItemTitle}>{renderItem(item)}</span>
                    {meta ? <span className={styles.surfaceItemMeta}>{meta}</span> : null}
                  </a>
                </li>
              );
            }
            return (
              <li key={renderKey(item)} className={styles.surfaceItem}>
                <span className={styles.surfaceItemTitle}>{renderItem(item)}</span>
                {meta ? <span className={styles.surfaceItemMeta}>{meta}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* A11y / dev signal: render the resolved state as a sr-only
          badge so screen readers and E2E tests have a single hook
          regardless of which child rendered. */}
      <span
        aria-hidden="true"
        data-testid={`dashboard-${surface}-state`}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {state}
      </span>

      {/* Hide accent decoration: keeps the data-testid surface
          uniform for state-only checks. */}
      <span style={{ display: 'none' }} data-testid={`dashboard-${surface}-count`}>
        {visible.length}
      </span>
    </Card>
  );
}

/**
 * Stat tile — single value + label, linkable to its surface.
 * Shows em-dash during loading, real count when populated,
 * a small "—" badge on error.
 */
export interface DashboardStatTileProps {
  surface: 'tasks' | 'reviews' | 'errors' | 'inbox';
  href: string;
  label: string;
  value: number | null;
  meta: string;
  isLoading?: boolean;
  isError?: boolean;
}

export function DashboardStatTile({
  surface,
  href,
  label,
  value,
  meta,
  isLoading,
  isError,
}: DashboardStatTileProps): JSX.Element {
  let valueNode: ReactNode;
  if (isError) {
    valueNode = (
      <span className={styles.statError} aria-label="Could not load">
        —
      </span>
    );
  } else if (isLoading || value === null) {
    valueNode = (
      <span className={styles.statSkeleton} aria-hidden="true" />
    );
  } else {
    valueNode = (
      <span className={styles.statValue} data-testid={`dashboard-stat-${surface}-value`}>
        {value}
      </span>
    );
  }

  return (
    <a
      href={href}
      className={styles.statCard}
      data-testid={`dashboard-stat-${surface}`}
      data-state={isError ? 'error' : isLoading || value === null ? 'loading' : 'populated'}
    >
      <p className={styles.statLabel}>
        <Badge tone="neutral" size="sm">
          {label}
        </Badge>
      </p>
      {valueNode}
      <p className={styles.statMeta}>{meta}</p>
    </a>
  );
}
