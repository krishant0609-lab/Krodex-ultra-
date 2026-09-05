/**
 * KRODEX web — root error boundary.
 *
 * Next.js 14 App Router error boundary. Catches unhandled
 * exceptions in any descendant route segment and renders a
 * branded recovery page instead of a blank screen.
 *
 * The boundary is intentionally minimal: a clear title, a
 * one-line description, the error message (when safe to
 * show), and a "Try again" button that calls reset(). The
 * recovery path is the same as a hard refresh from the
 * user's perspective.
 *
 * No fake content. No fabricated recovery. If the user
 * cannot recover with reset, the link back to /login is
 * the honest fallback.
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import styles from './error.module.css';

export interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps): JSX.Element {
  useEffect(() => {
    // Server-side: log the full error to the structured logger.
    // Client-side: this surfaces in the browser console.
    if (typeof console !== 'undefined') {
      console.error('[krodex.error_boundary]', {
        message: error.message,
        digest: error.digest,
        stack: error.stack,
      });
    }
  }, [error]);

  return (
    <main className={styles.root} data-testid="error-boundary">
      <section className={styles.card} role="alert">
        <span className={styles.accent} aria-hidden="true" />
        <p className={styles.eyebrow}>Something went wrong</p>
        <h1 className={styles.title}>We hit an unexpected error</h1>
        <p className={styles.description}>
          KRODEX caught an unhandled exception while rendering this page.
          Your work is safe — this is a render-time error, not a data error.
        </p>
        {error.message ? (
          <pre className={styles.message} data-testid="error-message">
            {error.message}
          </pre>
        ) : null}
        {error.digest ? (
          <p className={styles.digest}>
            <span className={styles.digestLabel}>Reference</span>
            <code>{error.digest}</code>
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={(): void => {
              reset();
            }}
            data-testid="error-reset"
          >
            Try again
          </button>
          <Link href="/login" className={styles.secondary} data-testid="error-signin">
            Back to sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
