/**
 * KRODEX web — Supabase OAuth callback.
 *
 * Supabase appends `?code=...` to the redirect URL after a
 * successful Google OAuth flow. The browser client exchanges
 * the code for a session (cookies, access_token, refresh_token)
 * and then routes the user into the app.
 *
 * The SupabaseAuthProvider picks up the resulting session and
 * mirrors it into the in-memory auth-store, so any code reading
 * `getToken()` after the redirect has the right bearer token.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '../../../lib/supabase-browser';
import { useSupabaseAuth } from '../../../lib/auth-context';

export default function AuthCallbackPage(): JSX.Element {
  const router = useRouter();
  const { status } = useSupabaseAuth();

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    supabase.auth
      .exchangeCodeForSession(window.location.href)
      .then(({ error }) => {
        if (cancelled) return;
        if (error) {
          // Surface the failure on /login so the user can retry.
          router.replace('/login?error=' + encodeURIComponent(error.message));
          return;
        }
        router.replace('/dashboard');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'OAuth callback failed';
        router.replace('/login?error=' + encodeURIComponent(msg));
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Show a calm "Finishing sign-in…" state while the context
  // settles (e.g. cookie already hydrated from a previous tab).
  return (
    <main
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--text-muted, #6b7280)',
      }}
    >
      <p>
        {status === 'authenticated'
          ? 'Signed in. Redirecting…'
          : 'Finishing sign-in…'}
      </p>
    </main>
  );
}
