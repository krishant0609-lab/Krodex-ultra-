/**
 * KRODEX web — root layout.
 *
 * Phase 7: sets the initial data-theme attribute (no-FOIT),
 * mounts the ThemeProvider + QueryClientProvider, applies the
 * design-token layer via globals.css.
 */

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Providers } from '../lib/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'KRODEX',
  description: 'Learning system foundation. Phase 7 — UI/UX implementation.',
};

/**
 * Theme bootstrap script.
 *
 * Runs synchronously in <head> before paint to set the
 * correct data-theme on <html>. This avoids a flash of the
 * wrong theme on page load. The script is small and
 * self-contained; the same logic lives in src/lib/theme.tsx
 * (which runs after hydration) and reads the same
 * localStorage key. Both paths must agree.
 *
 * Keeping this inline (not a separate <Script>) is intentional:
 * Next 14's <Script> is async and would still flash.
 */
const themeInitScript = `(function(){try{var p=window.localStorage.getItem('kd-theme-pref');var m;if(p==='light'||p==='dark'){m=p;}else{m=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',m);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
