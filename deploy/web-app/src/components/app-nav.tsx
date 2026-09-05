/**
 * KRODEX web — AppNav.
 *
 * The authenticated-app primary navigation. Sticky at the top of
 * the (app) route group, brand on the left, primary nav in the
 * middle, theme toggle + logout on the right.
 *
 * Per Phase 7 plan C14: theme toggle is visible in the nav
 * (desktop) and in the AppFooter (mobile). The active route is
 * inferred from `usePathname`; links render with a tinted
 * underline and a stronger weight when active.
 *
 * No fake data: every nav entry points at a real Phase 6 route
 * shell backed by real TanStack Query hooks. The NAV order is
 * the same one the dashboard / sidebar would surface — primary
 * surfaces first, admin surfaces last.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { Button } from './button';
import { Badge } from './badge';
import { useTheme } from '../lib/theme';
import { cls } from '../lib/classnames';
import styles from './app-nav.module.css';

interface NavItem {
  href: string;
  label: string;
  /** Optional aria-label override for icon-only or
   *  abbreviated labels (none today, but kept for future). */
  ariaLabel?: string;
}

const NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/syllabus', label: 'Syllabus' },
  { href: '/tests', label: 'Tests' },
  { href: '/errors', label: 'Errors' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/planner', label: 'Planner' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/insights', label: 'Insights' },
  { href: '/student-model', label: 'Model' },
  { href: '/notifications', label: 'Inbox' },
  // Phase 8: non-authoritative AI assistant. Listed as 'Assistant'
  // so the student can reach the Q&A surface from the same nav.
  { href: '/assistant', label: 'Assistant' },
  { href: '/settings', label: 'Settings' },
];

export interface AppNavProps {
  /** Right-side action slot for testing or future use. */
  rightSlot?: ReactNode;
  /** Custom logout handler. The (app) layout passes the
   *  real clearAuth + router.replace pair. */
  onLogout?: () => void;
}

export function AppNav({ rightSlot, onLogout }: AppNavProps): JSX.Element {
  const pathname = usePathname();
  const theme = useTheme();

  const onThemeToggle = useCallback((): void => {
    theme.toggle();
  }, [theme]);

  return (
    <header className={styles.bar} role="banner">
      <Link href="/dashboard" className={styles.brand} aria-label="KRODEX — go to dashboard">
        <span className={styles.brandMark} aria-hidden="true" />
        <span>KRODEX</span>
        <Badge size="sm" tone="lavender">
          Phase 7
        </Badge>
      </Link>

      <nav aria-label="Primary" data-testid="app-nav">
        <ul className={styles.navList}>
          {NAV.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname?.startsWith(item.href + '/'));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  data-testid={`nav-${item.href.replace(/^\//, '')}`}
                  aria-label={item.ariaLabel ?? item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={cls([styles.navLink, isActive ? styles.navLinkActive : undefined])}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <span className={styles.spacer} />

      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onThemeToggle}
          data-testid="nav-theme-toggle"
          aria-label={`Switch to ${theme.resolved === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme.resolved === 'dark' ? 'Light' : 'Dark'}
        </Button>
        {rightSlot}
        {onLogout ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onLogout}
            data-testid="nav-logout"
          >
            Log out
          </Button>
        ) : null}
      </div>
    </header>
  );
}
