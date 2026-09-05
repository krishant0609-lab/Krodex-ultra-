/**
 * KRODEX web — authenticated app shell.
 *
 * Phase 7: server component wrapper. The version is read from
 * the shared package (a Node-only import) here on the server
 * and passed to the client child. The child handles the
 * client-side auth redirect and renders the nav + main + footer.
 *
 * No fake data, no fabricated progress. Every page is rendered
 * by its own route segment; the layout owns only the chrome.
 */

import type { ReactNode } from 'react';
import { KRODEX_VERSION } from '@krodex/shared';
import { AppShellClient } from './app-shell-client';

export default function AppLayout({ children }: { children: ReactNode }): JSX.Element {
  return <AppShellClient version={KRODEX_VERSION}>{children}</AppShellClient>;
}
