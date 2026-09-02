/**
 * KRODEX web — client-side providers.
 *
 * Phase 7: wraps the React tree in
 *   - ThemeProvider  (light-first / dark opt-in)
 *   - QueryClientProvider (TanStack Query)
 *
 * Class A: TRD §35 names "Query cache — Server data caching" as
 * a required client layer; the provider is the wiring that makes
 * every hook see the same client.
 * Class A: Implementation Plan §293 — light-first theme, dark
 * mode.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './query-client';
import { ThemeProvider } from './theme';

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  const [client] = useState(() => createQueryClient());
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
