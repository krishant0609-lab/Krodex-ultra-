/**
 * KRODEX web — authenticated app error boundary.
 *
 * The (app) route group has its own boundary so authenticated
 * users get a contextually appropriate recovery page (with a
 * link back to /dashboard, not /login).
 *
 * Shares the same visual language as the root error boundary.
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import styles from '../../app/error.module.css';

export interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: AppErrorProps): JSX.Element {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.error('[krodex.app_error_boundary]', {
        message: error.message,
        digest: error.digest,
        stack: error.stack,
      });
    }
  }, [error]);

  return (
    <main className={styles.root} data-testid="app-error-boundary">
      <section className={styles.card} role="alert">
        <span className={styles.accent} aria-hidden="true" />
        <p className={styles.eyebrow}>App surface error</p>
        <h1 className={styles.title}>This screen could not be rendered</h1>
        <p className={styles.description}>
          The rest of KRODEX is unaffected. You can try this page again
          or return to your dashboard.
        </p>
        {error.message ? (
          <pre className={styles.message} data-testid="app-error-message">
            {error.message}
          </pre>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={(): void => {
              reset();
            }}
            data-testid="app-error-reset"
          >
            Try again
          </button>
          <Link href="/dashboard" className={styles.secondary} data-testid="app-error-dashboard">
            Back to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
