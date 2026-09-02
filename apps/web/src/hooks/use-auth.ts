/**
 * KRODEX web — auth hooks.
 *
 * Covers the dev-token mint path (Phase 6 dev convenience) and
 * the in-memory auth store. The Phase 6 web app uses the dev-token
 * endpoint to acquire a bearer token; subsequent API calls attach
 * it via the api-client.
 */

'use client';

import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api-client';
import { setAuth, clearAuth, isAuthenticated } from '../lib/auth-store';

export interface MintDevTokenInput {
  user_id: string;
  email?: string;
  ttl_seconds?: number;
}

export interface MintDevTokenResponse {
  token: string;
  expires_at: string;
}

export function useDevLogin() {
  return useMutation({
    mutationFn: async (input: MintDevTokenInput): Promise<MintDevTokenResponse> => {
      const res = await api.post<MintDevTokenResponse>('/auth/dev-token', {
        body: input,
      });
      return res;
    },
    onSuccess: (data, variables) => {
      setAuth({
        token: data.token,
        userId: variables.user_id,
        email: variables.email ?? null,
        expiresAt: data.expires_at,
      });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      clearAuth();
      return { ok: true };
    },
  });
}

export function useIsAuthenticated(): boolean {
  return isAuthenticated();
}

export { ApiError };
