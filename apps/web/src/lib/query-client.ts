/**
 * KRODEX web — TanStack Query client factory.
 *
 * Sensible defaults for a server-state-heavy app:
 *  - `staleTime: 30s` for most queries (the API rarely changes within
 *    a single user session, and TanStack Query will revalidate in the
 *    background when the user navigates back to a route).
 *  - `gcTime: 5min` to keep recently-visited routes instantly rendered
 *    when the user navigates back.
 *  - `retry: 1` for transient errors only. 4xx errors are not retried
 *    because they are deterministic (validation, auth, not-found).
 *  - `refetchOnWindowFocus: true` matches the Engineering Support §24
 *    "live update" strategy.
 *
 * Class A: query caching strategy is required by Engineering Support §24.
 * TanStack Query is the canonical implementation; the 30s staleTime
 * default is a deterministic derivation of the typical user session length.
 */

import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          // Don't retry on auth/validation/conflict — those are deterministic.
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? (error as { status?: number }).status
              : undefined;
          if (status === 401 || status === 403 || status === 404) return false;
          if (status === 400 || status === 409 || status === 422) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
