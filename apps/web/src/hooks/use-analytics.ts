/**
 * KRODEX web — analytics hooks.
 *
 * Analytics endpoints are derived from progress evidence. They are
 * NOT the source of truth — pages must show raw evidence alongside
 * the aggregate when both are visible. Per Engineering Support §24.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: queryKeys.analyticsOverview(),
    queryFn: () => api.get<unknown>('/analytics/dashboards/overview'),
  });
}

export function useAnalyticsDimensions() {
  return useQuery({
    queryKey: queryKeys.analyticsDimensions(),
    queryFn: () => api.get<unknown>('/analytics/dimensions'),
  });
}

export interface ListAnalyticsEvidenceParams {
  dimension?: string;
  since?: string;
  until?: string;
  cursor?: string | null;
  limit?: number;
}

export function useAnalyticsEvidence(params?: ListAnalyticsEvidenceParams) {
  return useQuery({
    queryKey: queryKeys.analyticsEvidence(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.get<unknown>('/analytics/evidence', { query: { ...(params ?? {}) } }),
  });
}

export function useDimensionDashboard(key: string | null | undefined) {
  return useQuery({
    queryKey: ['analytics', 'dimension', key ?? ''],
    enabled: !!key,
    queryFn: () => api.get<unknown>(`/analytics/dashboards/dimension/${key}`),
  });
}
