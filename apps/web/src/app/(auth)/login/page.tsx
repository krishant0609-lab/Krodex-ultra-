'use client';

/**
 * KRODEX web — sign in.
 *
 * Real Supabase Auth (production path):
 *  - Google OAuth (signInWithOAuth) — primary, since Google
 *    is enabled on the production Supabase project.
 *  - Email + password (signInWithPassword) — fallback for
 *    accounts that were created via Supabase admin or email
 *    sign-up.
 *  - Email sign-up (signUp) — creates a new auth user. The
 *    public.users row is provisioned lazily on the API side
 *    the first time that user calls an authenticated endpoint.
 *
 * The SupabaseAuthProvider (lib/auth-context.tsx) listens to
 * the auth state and writes the Supabase access token (ES256)
 * into the in-memory auth-store that the api-client reads. The
 * KRODEX API prehandler validates the same access token with
 * `supabase.auth.getUser(jwt)` and forwards it unchanged to
 * PostgREST so RLS keeps enforcing user ownership.
 *
 * The dev-token mint form has been removed; it is preserved
 * only for unit tests, behind `useDevLogin` in hooks/use-auth.ts.
 */

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useEmailSignIn,
  useEmailSignUp,
  useGoogleSignIn,
  useSignOut,
} from '../../../hooks/use-supabase-auth';
import { useSupabaseAuth } from '../../../lib/auth-context';
import { Field } from '../../../components/field';
import { Input } from '../../../components/input';
import styles from './login.module.css';

function LoginPageInner(): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const { status } = useSupabaseAuth();
  const google = useGoogleSignIn();
  const emailIn = useEmailSignIn();
  const emailUp = useEmailSignUp();
  const signOut = useSignOut();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // If we already have a session, route to the app immediately.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  // Surface ?error=... returned from the OAuth callback page.
  const oauthError = search?.get('error') ?? null;

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (mode === 'signin') {
      await emailIn.mutateAsync({ email: email.trim(), password });
      router.replace('/dashboard');
    } else {
      await emailUp.mutateAsync({ email: email.trim(), password });
    }
  };

  const pending = google.isPending || emailIn.isPending || emailUp.isPending;
  const errorMessage =
    google.error?.message ??
    emailIn.error?.message ??
    emailUp.error?.message ??
    oauthError ??
    null;

  return (
    <main className={styles.shell}>
      <section
        className={styles.card}
        aria-label="Sign in"
        data-testid="login-card"
      >
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            KX
          </span>
          <span className={styles.brandWord}>KRODEX</span>
        </div>

        <header className={styles.intro}>
          <p className={styles.eyebrow}>Session</p>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.description}>
            Continue with Google, or use the email associated with
            your KRODEX account.
          </p>
        </header>

        <button
          type="button"
          className={styles.googleButton}
          onClick={() => google.mutate()}
          disabled={pending}
          data-testid="login-google"
        >
          <span aria-hidden="true" className={styles.googleMark}>
            G
          </span>
          {google.isPending ? 'Opening Google…' : 'Continue with Google'}
        </button>

        <div className={styles.divider} role="separator" aria-label="or">
          <span>or</span>
        </div>

        <form
          onSubmit={onSubmit}
          data-testid="login-form"
          className={styles.form}
          noValidate
        >
          <Field
            id="login-email"
            label="Email"
            required
            helper="Use the email tied to your KRODEX account."
          >
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="login-email"
            />
          </Field>

          <Field
            id="login-password"
            label="Password"
            required
            helper={mode === 'signup' ? 'At least 8 characters.' : 'Your KRODEX password.'}
          >
            <Input
              id="login-password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : 1}
              data-testid="login-password"
            />
          </Field>

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.submit}
              disabled={pending}
              data-testid="login-submit"
            >
              {emailIn.isPending
                ? 'Signing in…'
                : emailUp.isPending
                  ? 'Creating account…'
                  : mode === 'signin'
                    ? 'Sign in'
                    : 'Create account'}
            </button>

            <button
              type="button"
              className={styles.secondary}
              onClick={() =>
                setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
              }
              disabled={pending}
              data-testid="login-toggle"
            >
              {mode === 'signin'
                ? "Don't have an account? Create one"
                : 'Already have an account? Sign in'}
            </button>

            {status === 'authenticated' ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => signOut.mutate()}
                data-testid="login-signout"
              >
                Sign out of this device
              </button>
            ) : null}

            {errorMessage ? (
              <p
                className={styles.errorMeta}
                role="alert"
                data-testid="login-error"
              >
                {errorMessage}
              </p>
            ) : null}
          </div>
        </form>

        <p className={styles.hint}>
          Sessions are kept in memory and in Supabase's secure
          cookies. Signing out clears the access token from this
          browser.
        </p>
      </section>
    </main>
  );
}

export default function LoginPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
