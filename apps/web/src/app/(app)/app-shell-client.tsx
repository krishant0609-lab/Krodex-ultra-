'use client';

/**
 * KRODEX web — authenticated-app shell (client half).
 *
 * Phase 9: switched from the horizontal AppNav to a vertical
 * Sidebar as the primary navigation surface. The shell owns:
 *  - the auth-guard redirect to /login
 *  - the sidebar + main outlet + footer layout
 *  - the logout handler
 *
 * The version is passed in from the server wrapper so the
 * @krodex/shared import (which transitively pulls in node:crypto
 * via the events barrel) stays out of the client bundle.
 *
 * No fake data, no fabricated progress. The shell renders the
 * chrome only; each page composes its own data via TanStack
 * Query hooks.
 */

import { useCallback, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, clearAuth } from '../../lib/auth-store';
import { Sidebar } from '../../components/sidebar';
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
        background: 'var(--kd-color-surface-background)',
      }}
    >
      <Sidebar version={version} onLogout={onLogout} />
      <main
        style={{
          flex: 1,
          padding: 'var(--kd-space-6)',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
        data-testid="app-main"
      >
        <div style={{ flex: 1 }}>{children}</div>
        <AppFooter version={version} />
      </main>
    </div>
  );
}
