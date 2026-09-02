'use client';

/**
 * KRODEX web — authenticated-app shell (client half).
 *
 * Phase 7: this client component owns the client-only concerns
 * of the (app) layout — the auth-guard redirect, the logout
 * handler, the sticky AppNav, the page outlet, and the
 * AppFooter. The version is passed in from the server wrapper
 * so the @krodex/shared import (which transitively pulls in
 * node:crypto via the events barrel) stays out of the client
 * bundle.
 *
 * No fake data, no fabricated progress. The shell renders the
 * chrome only; each page composes its own data via TanStack
 * Query hooks.
 */

import { useCallback, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, clearAuth } from '../../lib/auth-store';
import { AppNav } from '../../components/app-nav';
import { AppFooter } from '../../components/app-footer';

export interface AppShellClientProps {
  version?: string;
  children: ReactNode;
}

export function AppShellClient({ version, children }: AppShellClientProps): JSX.Element {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    }
  }, [router]);

  const onLogout = useCallback((): void => {
    clearAuth();
    router.replace('/login');
  }, [router]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--kd-color-surface-background)',
      }}
    >
      <AppNav onLogout={onLogout} />
      <main style={{ flex: 1, padding: 'var(--kd-space-6)' }} data-testid="app-main">
        {children}
      </main>
      <AppFooter version={version} />
    </div>
  );
}
