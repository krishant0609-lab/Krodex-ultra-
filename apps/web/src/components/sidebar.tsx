/**
 * KRODEX web — Sidebar.
 *
 * Premium vertical sidebar for the authenticated app shell.
 * Replaces the horizontal AppNav as the primary navigation
 * surface on desktop; on mobile it collapses behind a
 * hamburger button and slides in as a drawer.
 *
 * Layout:
 *   ┌──────────┐
 *   │  KRODEX  │  <- brand + collapse toggle
 *   ├──────────┤
 *   │  ⌂ Dash  │  <- nav items
 *   │  ▤ Syll  │
 *   │  ✓ Test  │
 *   │  ...     │
 *   ├──────────┤
 *   │  ☾ Theme │  <- footer actions
 *   │  ⎋ Logout│
 *   │  v0.1.0  │  <- version
 *   └──────────┘
 *
 * Behavior:
 *   - Two widths: 64px collapsed (icon-only), 240px expanded.
 *   - State persisted in localStorage under `kd-sidebar-collapsed`.
 *   - Active route inferred via usePathname.
 *   - Theme toggle + logout wired through props (the (app)
 *     layout owns the auth handlers).
 *   - Mobile (<768px): drawer-style, hidden by default,
 *     toggled by a hamburger in the top bar.
 *
 * No fake data, no fabricated badges or counts.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useTheme } from '../lib/theme';
import { cls } from '../lib/classnames';
import styles from './sidebar.module.css';

interface NavItem {
  href: string;
  label: string;
  /** Short unicode glyph used as the icon. Keeps the bundle
   *  small and avoids shipping an icon font for one surface. */
  icon: string;
  /** Optional accent for the active state dot. */
  accent: 'lavender' | 'sapphire' | 'rose' | 'emerald' | 'amber' | 'champagne';
}

const NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '◇', accent: 'lavender' },
  { href: '/syllabus', label: 'Syllabus', icon: '▦', accent: 'sapphire' },
  { href: '/tests', label: 'Tests', icon: '✓', accent: 'rose' },
  { href: '/errors', label: 'Errors', icon: '!', accent: 'amber' },
  { href: '/reviews', label: 'Reviews', icon: '↻', accent: 'emerald' },
  { href: '/planner', label: 'Planner', icon: '◫', accent: 'lavender' },
  { href: '/backlog', label: 'Backlog', icon: '⊟', accent: 'rose' },
  { href: '/insights', label: 'Insights', icon: '◐', accent: 'sapphire' },
  { href: '/student-model', label: 'Model', icon: '◈', accent: 'emerald' },
  { href: '/notifications', label: 'Inbox', icon: '✉', accent: 'champagne' },
  { href: '/assistant', label: 'Assistant', icon: '✦', accent: 'lavender' },
  { href: '/settings', label: 'Settings', icon: '⚙', accent: 'champagne' },
];

const COLLAPSE_KEY = 'kd-sidebar-collapsed';
const MOBILE_BREAKPOINT = 768;

export interface SidebarProps {
  version?: string;
  onLogout?: () => void;
}

function readCollapsedDefault(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Sidebar({ version, onLogout }: SidebarProps): JSX.Element {
  const pathname = usePathname();
  const theme = useTheme();

  // SSR-safe: start expanded; hydrate from localStorage on mount.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    setCollapsed(readCollapsedDefault());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const apply = (): void => {
      setIsMobile(mq.matches);
      if (!mq.matches) setMobileOpen(false);
    };
    apply();
    mq.addEventListener('change', apply);
    return (): void => mq.removeEventListener('change', apply);
  }, []);

  // Close the mobile drawer when the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCollapsed = useCallback((): void => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Ignore — localStorage may be unavailable (private mode, etc.)
      }
      return next;
    });
  }, []);

  const toggleMobile = useCallback((): void => {
    setMobileOpen((prev) => !prev);
  }, []);

  const onThemeToggle = useCallback((): void => {
    theme.toggle();
  }, [theme]);

  const widthClass = collapsed ? styles.collapsed : styles.expanded;
  const isDrawer = isMobile;

  return (
    <>
      {isDrawer ? (
        <button
          type="button"
          className={styles.mobileToggle}
          onClick={toggleMobile}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          data-testid="sidebar-mobile-toggle"
        >
          <span aria-hidden="true">{mobileOpen ? '×' : '☰'}</span>
        </button>
      ) : null}

      {isDrawer && mobileOpen ? (
        <div
          className={styles.scrim}
          onClick={(): void => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cls([
          styles.sidebar,
          widthClass,
          isDrawer ? styles.drawer : styles.rail,
          isDrawer && mobileOpen ? styles.drawerOpen : undefined,
        ])}
        aria-label="Primary navigation"
        data-testid="sidebar"
        data-collapsed={collapsed || undefined}
        data-mobile={isDrawer || undefined}
      >
        <div className={styles.brand}>
          <Link
            href="/dashboard"
            className={styles.brandLink}
            aria-label="KRODEX — go to dashboard"
          >
            <span className={styles.brandMark} aria-hidden="true" />
            {collapsed ? null : <span className={styles.brandText}>KRODEX</span>}
          </Link>
          {!isDrawer ? (
            <button
              type="button"
              className={styles.collapseToggle}
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              data-testid="sidebar-collapse-toggle"
            >
              <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
            </button>
          ) : null}
        </div>

        <nav className={styles.nav} aria-label="Primary" data-testid="sidebar-nav">
          <ul className={styles.navList}>
            {NAV.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' &&
                  pathname?.startsWith(item.href + '/'));
              return (
                <li key={item.href} className={styles.navItem}>
                  <Link
                    href={item.href}
                    data-testid={`sidebar-${item.href.replace(/^\//, '')}`}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cls([
                      styles.navLink,
                      isActive ? styles.navLinkActive : undefined,
                    ])}
                    data-accent={item.accent}
                  >
                    <span className={styles.navIcon} aria-hidden="true">
                      {item.icon}
                    </span>
                    {collapsed ? null : (
                      <span className={styles.navLabel}>{item.label}</span>
                    )}
                    {isActive ? (
                      <span className={styles.activeDot} aria-hidden="true" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.footerBtn}
            onClick={onThemeToggle}
            aria-label={`Switch to ${theme.resolved === 'dark' ? 'light' : 'dark'} theme`}
            data-testid="sidebar-theme-toggle"
          >
            <span className={styles.navIcon} aria-hidden="true">
              {theme.resolved === 'dark' ? '☀' : '☾'}
            </span>
            {collapsed ? null : (
              <span className={styles.navLabel}>
                {theme.resolved === 'dark' ? 'Light' : 'Dark'}
              </span>
            )}
          </button>

          {onLogout ? (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={onLogout}
              aria-label="Log out"
              data-testid="sidebar-logout"
            >
              <span className={styles.navIcon} aria-hidden="true">
                ⎋
              </span>
              {collapsed ? null : <span className={styles.navLabel}>Log out</span>}
            </button>
          ) : null}

          {version ? (
            <span
              className={styles.version}
              data-testid="sidebar-version"
            >
              v{version}
            </span>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export type { NavItem };
export { NAV as SIDEBAR_NAV };
export const SidebarTestIds: { readonly mobileToggle: string; readonly collapseToggle: string } = {
  mobileToggle: 'sidebar-mobile-toggle',
  collapseToggle: 'sidebar-collapse-toggle',
} as const;
// Re-export ReactNode so callers can use the same import site.
export type { ReactNode };
