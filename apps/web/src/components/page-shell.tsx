/**
 * PageShell — shared loading/empty shell for full-page states.
 *
 * Used as a fallback while auth state is resolving, and as a
 * neutral container for loading/empty/error states.
 *
 * KRODEX Living Learning System — dark editorial aesthetic.
 */
'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Spinner } from './spinner';
import styles from './page-shell.module.css';

export type ShellState = 'loading' | 'empty' | 'populated' | 'partial' | 'error' | 'success' | 'permission';

export interface PageShellProps {
  state?: ShellState;
  isLoading?: boolean;
  title?: string;
  description?: string;
  message?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

const STATE_CONFIG: Partial<Record<ShellState, { icon: React.ReactNode; title: string; body: string }>> = {
  loading: {
    icon: null,
    title: 'Loading',
    body: 'Hold on — KRODEX is preparing your workspace.',
  },
  empty: {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="8" y="12" width="32" height="28" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 20h16M16 28h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Nothing here yet',
    body: 'There\'s nothing to display at the moment.',
  },
  error: {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="1.5" />
        <path d="M24 14v14M24 32v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Something went wrong',
    body: 'An unexpected error occurred. Please try again.',
  },
  success: {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 24l6 6 10-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'All clear',
    body: 'Everything looks good.',
  },
  permission: {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="10" y="20" width="28" height="22" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 20v-6a8 8 0 1 1 16 0v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Access restricted',
    body: 'You don\'t have permission to view this page.',
  },
};

export function PageShell({
  state = 'loading',
  isLoading,
  title,
  description,
  message,
  icon,
  action,
  className = '',
  children,
}: PageShellProps) {
  const resolvedState: ShellState = isLoading ? 'loading' : state;
  const config = STATE_CONFIG[resolvedState];

  return (
    <div className={[styles.shell, styles[resolvedState], className].filter(Boolean).join(' ')}>
      {config ? (
        <motion.div
          className={styles.content}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <div className={styles.icon}>{icon ?? config.icon}</div>
          <h2 className={styles.title}>{title ?? config.title}</h2>
          <p className={styles.body}>{message ?? description ?? config.body}</p>
          {action && <div className={styles.action}>{action}</div>}
        </motion.div>
      ) : (
        children
      )}
    </div>
  );
}
