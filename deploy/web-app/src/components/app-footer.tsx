/**
 * KRODEX web — AppFooter.
 *
 * The authenticated-app footer. Surfaces section links, the
 * version + status line, and a mobile-visible theme toggle.
 * Per Phase 7 plan C14 the toggle is in the nav on desktop and
 * in the footer for narrow viewports; the same `useTheme()`
 * hook powers both.
 *
 * Version is read from the KRODEX_VERSION env var that the
 * shared package exposes. If the env var is missing, the
 * footer renders a "dev" badge instead — never a fabricated
 * version number.
 */

'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Button } from './button';
import { useTheme } from '../lib/theme';
import styles from './app-footer.module.css';

interface FooterLink {
  href: string;
  label: string;
}

const SECTION_LINKS: readonly FooterLink[] = [
  { href: '/syllabus', label: 'Syllabus' },
  { href: '/tests', label: 'Tests' },
  { href: '/errors', label: 'Errors' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/planner', label: 'Planner' },
  { href: '/insights', label: 'Insights' },
];

export interface AppFooterProps {
  /** Build version; rendered verbatim. Callers pass the value
   *  they read from process.env / runtime config — this
   *  component does not invent one. */
  version?: string;
}

export function AppFooter({ version }: AppFooterProps): JSX.Element {
  const theme = useTheme();

  const onThemeToggle = useCallback((): void => {
    theme.toggle();
  }, [theme]);

  return (
    <footer className={styles.footer} role="contentinfo">
      <nav aria-label="Footer" className={styles.section}>
        <ul className={styles.links}>
          {SECTION_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={styles.link} data-testid={`footer-${l.href.replace(/^\//, '')}`}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <span className={styles.spacer} />

      <div className={styles.themeToggle}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onThemeToggle}
          data-testid="footer-theme-toggle"
          aria-label={`Switch to ${theme.resolved === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme.resolved === 'dark' ? 'Light' : 'Dark'}
        </Button>
      </div>

      <div className={styles.meta} data-testid="footer-version">
        <span className={styles.dot} aria-hidden="true" />
        <span>{version ? `v${version}` : 'dev'}</span>
      </div>
    </footer>
  );
}
