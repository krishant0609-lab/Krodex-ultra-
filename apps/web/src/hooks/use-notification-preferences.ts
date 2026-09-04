/**
 * KRODEX web — notification preferences hooks.
 *
 * Phase 12 adds two routes on the API:
 *   GET    /notifications/preferences   — read current prefs
 *   PATCH  /notifications/preferences   — partial update
 *
 * The server is authoritative: GET returns the persisted blob, PATCH
 * merges into the existing settings. The hook below treats the GET
 * response as the source of truth.
 *
 * The mutation invalidates the preferences query key so any other
 * view (e.g. the notification inbox) re-fetches on the next render.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferencesShared } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

/**
 * Server-side NotificationPreferences response. We accept the shared
 * shape (without the `created_at` / `updated_at` audit fields) and
 * re-export the full row including timestamps for callers that want
 * to display "last updated".
 */
export type NotificationPreferences = NotificationPreferencesShared;

export interface UpdateNotificationPreferencesInput {
  quiet_hours?: {
    enabled?: boolean;
    start?: string;
    end?: string;
  };
  enabled_kinds?: readonly string[];
  disabled_kinds?: readonly string[];
  in_app_enabled?: boolean;
  email_enabled?: boolean;
  push_enabled?: boolean;
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notificationPreferences(),
    queryFn: () =>
      api.get<NotificationPreferences>('/notifications/preferences'),
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNotificationPreferencesInput) =>
      api.patch<NotificationPreferences>('/notifications/preferences', { body }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.notificationPreferences(), data);
      qc.invalidateQueries({ queryKey: queryKeys.notificationPreferences() });
    },
  });
}
