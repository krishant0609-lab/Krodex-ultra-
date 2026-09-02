/**
 * KRODEX web — users hooks.
 *
 * Self-service surface: read + update the caller's own `public.users`
 * row and `public.profiles` row. No admin surface in Phase 6.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileRow, UserRow } from '@krodex/shared';
import { api } from '../lib/api-client';
import { queryKeys } from '../lib/query-keys';

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: () => api.get<UserRow>('/users/me'),
  });
}

export interface UpdateUserInput {
  display_name?: string;
  timezone?: string;
  locale?: string;
}

export function useUpdateCurrentUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateUserInput) =>
      api.patch<UserRow>('/users/me', { body }),
    onSuccess: (user) => {
      qc.setQueryData(queryKeys.currentUser(), user);
    },
  });
}

export function useCurrentUserProfile() {
  return useQuery({
    queryKey: queryKeys.userProfile(),
    queryFn: () => api.get<ProfileRow>('/users/me/profile'),
  });
}

export interface UpdateProfileInput {
  grade?: string | null;
  board?: string | null;
  exam_target?: string | null;
  study_goal?: string | null;
  preferred_subject_ids?: readonly string[] | null;
  settings?: Record<string, unknown> | null;
}

export function useUpdateCurrentUserProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileInput) =>
      api.patch<ProfileRow>('/users/me/profile', { body }),
    onSuccess: (profile) => {
      qc.setQueryData(queryKeys.userProfile(), profile);
    },
  });
}
