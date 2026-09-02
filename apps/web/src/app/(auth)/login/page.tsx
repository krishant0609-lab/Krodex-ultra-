'use client';

/**
 * KRODEX web — dev login.
 *
 * Phase 6 ships only the dev-token mint path (per
 * Implementation Plan §291 — auth flows are out of Phase 6
 * scope beyond the dev convenience). The user enters a user_id
 * and an optional email; we POST to /auth/dev-token, persist
 * the bearer token in the memory store, and redirect to
 * /dashboard.
 *
 * There is no signup, no SSO, no password reset, no refresh.
 * Those belong to the auth phase.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useDevLogin } from '../../../hooks/use-auth';

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [ttl, setTtl] = useState(3600);
  const devLogin = useDevLogin();

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!userId.trim()) return;
    try {
      await devLogin.mutateAsync({
        user_id: userId.trim(),
        email: email.trim() || undefined,
        ttl_seconds: ttl,
      });
      router.replace('/dashboard');
    } catch {
      // The mutation's `error` is rendered below.
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2rem',
      }}
    >
      <form
        onSubmit={onSubmit}
        data-testid="login-form"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          width: '20rem',
          maxWidth: '100%',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>KRODEX — dev login</h1>
        <p style={{ margin: 0, color: '#555', fontSize: '0.875rem' }}>
          Mint a development bearer token. Available only when the API is
          configured with the dev-token route.
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.875rem' }}>User ID (UUID)</span>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            data-testid="login-user-id"
            style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.875rem' }}>Email (optional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
            style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.875rem' }}>Token TTL (seconds)</span>
          <input
            type="number"
            min={60}
            max={86400}
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
            data-testid="login-ttl"
            style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
          />
        </label>

        <button
          type="submit"
          disabled={devLogin.isPending}
          data-testid="login-submit"
          style={{
            padding: '0.5rem 1rem',
            border: '1px solid #111',
            background: '#111',
            color: '#fff',
            borderRadius: '0.25rem',
            opacity: devLogin.isPending ? 0.6 : 1,
          }}
        >
          {devLogin.isPending ? 'Minting…' : 'Sign in'}
        </button>

        {devLogin.isError ? (
          <p
            role="alert"
            data-testid="login-error"
            style={{ margin: 0, color: '#842029', fontSize: '0.875rem' }}
          >
            {(devLogin.error as Error)?.message ?? 'Login failed.'}
          </p>
        ) : null}
      </form>
    </main>
  );
}
