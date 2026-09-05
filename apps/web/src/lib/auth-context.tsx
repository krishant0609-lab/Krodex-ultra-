/**
 * KRODEX web — Supabase auth context.
 *
 * Subscribes to the Supabase browser client's auth state and
 * mirrors the current session into the in-memory `auth-store`
 * (which the api-client reads to attach `Authorization: Bearer
 * <token>` to every request). The mirror runs in both directions:
 *
 *   - sign-in (Google OAuth callback or email/password) →
 *     `setAuth({ token, userId, email, expiresAt })`
 *   - sign-out / token refresh → `setAuth` or `clearAuth`
 *
 * The bearer token written into the store is the Supabase
 * access token (ES256, validated by GoTrue). The KRODEX API
 * prehandler accepts it directly and forwards it unchanged to
 * PostgREST so RLS keeps working.
 *
 * The dev-token path is preserved only for unit tests that
 * still mint HS256 tokens through `useDevLogin`; the new
 * `useSupabaseAuth` hook is the production entry point.
 */

'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowser } from './supabase-browser';
import { clearAuth, setAuth } from './auth-store';

export interface SupabaseAuthState {
  session: Session | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
}

const AuthContext = createContext<SupabaseAuthState | null>(null);

export function SupabaseAuthProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SupabaseAuthState['status']>('loading');

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    // Pick up any session that already exists (e.g. on full
    // page reload, after the cookie-based session is hydrated).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setStatus(data.session ? 'authenticated' : 'unauthenticated');
      if (data.session) {
        writeSessionToStore(data.session);
      } else {
        clearAuth();
      }
    });

    // Subscribe to changes (sign-in, sign-out, token refresh).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? 'authenticated' : 'unauthenticated');
      if (next) {
        writeSessionToStore(next);
      } else {
        clearAuth();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SupabaseAuthState>(
    () => ({ session, status }),
    [session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSupabaseAuth(): SupabaseAuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useSupabaseAuth must be used inside <SupabaseAuthProvider>');
  }
  return ctx;
}

function writeSessionToStore(session: Session): void {
  const token = session.access_token;
  if (!token) return;
  const userId = session.user?.id ?? null;
  const email = session.user?.email ?? null;
  const expiresAt = session.expires_at
    ? new Date(session.expires_at * 1000).toISOString()
    : null;
  setAuth({ token, userId, email, expiresAt });
}
