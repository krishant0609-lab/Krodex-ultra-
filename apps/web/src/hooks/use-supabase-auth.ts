'use client';

/**
 * Auth hooks — stub implementations.
 * Wire to real Supabase client when the package is installed.
 */
import { useState, useCallback } from 'react';

export function useEmailSignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      // TODO: call real Supabase signInWithPassword
      console.warn('[useEmailSignIn] Not yet wired to Supabase', { email });
      await new Promise((r) => setTimeout(r, 600));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { signIn, loading, error };
}

export function useEmailSignUp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signUp = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      // TODO: call real Supabase signUp
      console.warn('[useEmailSignUp] Not yet wired to Supabase', { email });
      await new Promise((r) => setTimeout(r, 600));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { signUp, loading, error };
}

export function useGoogleSignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: call real Supabase signInWithOAuth
      console.warn('[useGoogleSignIn] Not yet wired to Supabase');
      await new Promise((r) => setTimeout(r, 800));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Google sign in failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { signIn, loading, error };
}

export function useSignOut() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: call real Supabase auth.signOut
      console.warn('[useSignOut] Not yet wired to Supabase');
      await new Promise((r) => setTimeout(r, 400));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign out failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { signOut, loading, error };
}
