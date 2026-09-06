'use client';
import React from 'react';
import styles from './error.module.css';

export default function AppErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.iconWrap}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className={styles.textBlock}>
          <h1 className={styles.heading}>Something went wrong</h1>
          <p className={styles.message}>
            {error?.message ?? 'An unexpected error occurred in the app.'}
          </p>
          {error.digest && (
            <span className={styles.digest}>{error.digest}</span>
          )}
        </div>
        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={reset}>
            Try again
          </button>
          <a href="/dashboard" className={styles.btnSecondary}>
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
