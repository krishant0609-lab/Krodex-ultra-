/**
 * KRODEX web — Supabase auth actions.
 *
 * Real production auth: Google OAuth + email/password.
 * The SupabaseAuthContext (lib/auth-context.tsx) keeps the
 * in-memory auth-store in sync, so the existing api-client
 * keeps reading `getToken()` without modification.
 *
 * - `useGoogleSignIn` — initiates Google OAuth via
 *   supabase.auth.signInWithOAuth({ provider: 'google' }).
 *   Supabase returns the user back to /login (or the configured
 *   redirectTo) once the OAuth round-trip completes.
 * - `useEmailSignIn` — email/password sign-in (also used for
 *   sign-up when the account does not yet exist, when the
 *   auto-confirm flow is enabled).
 * - `useEmailSignUp` — explicit sign-up.
 * - `useSignOut` — clears the session.
 */

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabaseBrowser } from '../lib/supabase-browser';

function safeRedirectTo(): string {
  // The Supabase OAuth flow appends the code at the end of
  // redirectTo. Default to /dashboard for the same-origin flow.
  if (typeof window === 'undefined') return '/dashboard';
  const here = window.location.origin;
  return `${here}/auth/callback`;
}

export function useGoogleSignIn() {
  return useMutation({
    mutationFn: async (): Promise<{ url: string | null }> => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: safeRedirectTo(),
          queryParams: {
            // request the user to pick an account every time; remove
            // for a quieter UX once KRODEX has a real domain.
            prompt: 'select_account',
          },
        },
      });
      if (error) {
        throw new Error(error.message || 'Google sign-in failed');
      }
      return { url: data.url };
    },
    onSuccess: ({ url }) => {
      if (url) {
        window.location.assign(url);
      }
    },
  });
}

export function useEmailSignIn() {
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.auth.signInWithPassword(input);
      if (error) {
        throw new Error(error.message || 'Email sign-in failed');
      }
      return data;
    },
  });
}

export function useEmailSignUp() {
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          emailRedirectTo: safeRedirectTo(),
        },
      });
      if (error) {
        throw new Error(error.message || 'Email sign-up failed');
      }
      return data;
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw new Error(error.message || 'Sign-out failed');
      }
      return { ok: true as const };
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
