/**
 * KRODEX web — notifications hooks.
 *
 * Notifications are produced by other endpoints (e.g. task completion,
 * review outcome, error bank changes). The notifications feed is the
 * inbox; marking read is a PATCH.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export interface ListNotificationsParams {
  state?: 'unread' | 'read' | 'archived';
  cursor?: string | null;
  limit?: number;
  kind?: string;
  severity?: 'info' | 'success' | 'warning' | 'critical';
}

export function useNotifications(params?: ListNotificationsParams) {
  return useQuery({
    queryKey: queryKeys.notifications(params as Record<string, unknown> | undefined),
    queryFn: () =>
      api.getPage<NotificationRow>('/notifications', {
        query: { ...(params ?? {}) },
      }),
  });
}

export interface UpdateNotificationInput {
  state?: 'unread' | 'read' | 'archived';
}

export function useUpdateNotification(notificationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNotificationInput) =>
      api.patch<NotificationRow>(`/notifications/${notificationId}`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
