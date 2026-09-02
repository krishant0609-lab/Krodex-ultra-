/**
 * KRODEX web — PageShell.
 *
 * Standardized 7-state wrapper used by every route shell.
 * The states are per PRD §1267–1296:
 *
 *   1. Loading    — initial data fetch (pulse skeleton, no spinner-icon)
 *   2. Empty      — no data (truthful empty state, generous surface)
 *   3. Populated  — data loaded
 *   4. Partial    — some queries fail, some succeed (notice + sections)
 *   5. Error      — all data fetch failed
 *   6. Success    — mutation completed, server acknowledged
 *   7. Permission — 401/403 received (redirect / show permission denied)
 *
 * Phase 7 visual layer:
 *   - All cosmetic values resolve to design tokens in
 *     styles/tokens.css. No raw colors, no hardcoded spacing.
 *   - The 7-state machine renders a dedicated style per state.
 *   - data-testid / role / aria attributes are preserved from
 *     Phase 6 so the existing 25/25 baseline tests still pass.
 *
 * Variants:
 *   - width: 'default' (72rem) | 'wide' (84rem) | 'narrow' (48rem)
 *   - titleSize: 'display' (2.5rem) | 'heading' (1.75rem)
 */

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ApiError } from '../lib/api-client';
import styles from './page-shell.module.css';

export interface PageShellProps {
  title: string;
  description?: string;
  /** Optional eyebrow shown above the title in caption style. */
  eyebrow?: string;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  isPermission?: boolean;
  /** Section-level partial: show notice + slot the populated children. */
  isPartial?: boolean;
  /** True after a successful mutation. Renders success strip. */
  isSuccess?: boolean;
  successMessage?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  errorTitle?: string;
  errorAction?: ReactNode;
  permissionAction?: ReactNode;
  partialMessage?: string;
  children?: ReactNode;
  actions?: ReactNode;
  width?: 'default' | 'wide' | 'narrow';
  titleSize?: 'display' | 'heading';
  className?: string;
}

function isPermissionError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code} (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error.';
}

export function PageShell({
  title,
  description,
  eyebrow,
  isLoading,
  isError,
  error,
  isEmpty,
  isPermission,
  isPartial,
  isSuccess,
  successMessage,
  emptyTitle = 'Nothing here yet',
  emptyMessage = 'No data yet.',
  emptyAction,
  errorTitle = 'Could not load this view',
  errorAction,
  permissionAction,
  partialMessage = 'Some sections failed to load. The data you can see is up to date.',
  children,
  actions,
  width = 'default',
  titleSize = 'display',
  className,
}: PageShellProps): JSX.Element {
  const permission = isPermission || isPermissionError(error);
  // Permission wins over all other states; loading is the only
  // state that can coexist with a populated slot.
  const showLoading = isLoading;
  const showError = !permission && !isLoading && isError;
  const showEmpty = !permission && !isLoading && !isError && isEmpty;
  const showPopulated =
    !permission && !isLoading && !isError && !isEmpty && (isPartial || isSuccess || true);
  const showSuccess = !permission && !isLoading && !isError && !isEmpty && isSuccess;

  const shellClass = [
    styles.shell,
    width === 'wide' ? styles.shellWide : '',
    width === 'narrow' ? styles.shellNarrow : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const titleClass = [styles.title, titleSize === 'heading' ? styles.titleSm : '']
    .filter(Boolean)
    .join(' ');

  return (
    <section
      data-testid="page-shell"
      data-state={
        permission
          ? 'permission'
          : isLoading
            ? 'loading'
            : isError
              ? 'error'
              : isEmpty
                ? 'empty'
                : isPartial
                  ? 'partial'
                  : isSuccess
                    ? 'success'
                    : 'populated'
      }
      className={shellClass}
    >
      <header className={styles.header}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={titleClass}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>

      {permission ? (
        <div
          role="alert"
          data-testid="page-state-permission"
          className={styles.alert}
        >
          <p className={styles.alertTitle}>You don&apos;t have access to this view.</p>
          <p className={styles.alertBody}>
            Your session may have expired or you may not be authorised to view this
            page. Please sign in again to continue.
          </p>
          <div className={styles.alertActions}>
            {permissionAction ?? (
              <Link
                href="/login"
                style={{
                  color: 'var(--kd-color-state-error-fg)',
                  fontWeight: 600,
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                }}
              >
                Go to sign in
              </Link>
            )}
          </div>
        </div>
      ) : null}

      {showLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-testid="page-state-loading"
          className={styles.loading}
        >
          <div className={styles.loadingHeader}>
            <div className={styles.loadingTitle} aria-hidden="true" />
            <div className={styles.loadingLine} aria-hidden="true" />
            <div
              className={[styles.loadingLine, styles.loadingLineShort]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            />
          </div>
          <p className={styles.loadingCaption}>Loading…</p>
        </div>
      ) : null}

      {showError ? (
        <div
          role="alert"
          data-testid="page-state-error"
          className={styles.alert}
        >
          <p className={styles.alertTitle}>{errorTitle}</p>
          <p className={styles.alertBody}>
            We couldn&apos;t reach this view. Check your connection and try again.
          </p>
          <p className={styles.alertMeta}>{describeError(error)}</p>
          {errorAction ? <div className={styles.alertActions}>{errorAction}</div> : null}
        </div>
      ) : null}

      {showEmpty ? (
        <div data-testid="page-state-empty" className={styles.empty}>
          <p className={styles.emptyTitle}>{emptyTitle}</p>
          <p className={styles.emptyBody}>{emptyMessage}</p>
          {emptyAction ? <div className={styles.emptyAction}>{emptyAction}</div> : null}
        </div>
      ) : null}

      {showPopulated ? (
        <div data-testid="page-state-populated" className={styles.populated}>
          {isPartial ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="page-state-partial"
              className={styles.partialNotice}
            >
              <span aria-hidden="true">⚠</span>
              <span>{partialMessage}</span>
            </div>
          ) : null}
          {showSuccess && successMessage ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="page-state-success"
              className={styles.success}
            >
              <span aria-hidden="true">✓</span>
              <span>{successMessage}</span>
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}
