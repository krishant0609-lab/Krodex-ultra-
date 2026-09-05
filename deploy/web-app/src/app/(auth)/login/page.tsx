'use client';

/**
 * KRODEX web — dev login.
 *
 * Phase 7.11 visual layer:
 *  - Editorial card on a quiet background. Brand mark, eyebrow
 *    "Session", title "Sign in", and a calm description that
 *    names the dev-only nature of the flow.
 *  - Three labeled fields: user_id (required), email (optional),
 *    ttl_seconds (required). All inputs use the shared design
 *    tokens. The submit button uses the accent and is disabled
 *    while the mint is in flight.
 *  - 7-state contract honored: loading (pending), error (mint
 *    failed), success (redirect to /dashboard). There is no
 *    empty / partial state for a mint form — those are N/A.
 *
 * The mutation uses the existing useDevLogin hook from Phase 6
 * (POST /auth/dev-token). The auth store is the memory-only
 * store from Phase 6. No new server state, no new contracts.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useDevLogin } from '../../../hooks/use-auth';
import { ApiError } from '../../../lib/api-client';
import { Field } from '../../../components/field';
import { Input } from '../../../components/input';
import styles from './login.module.css';

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
      // Error rendered below.
    }
  };

  return (
    <main className={styles.shell}>
      <section
        className={styles.card}
        aria-label="Dev login"
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
            Mint a development bearer token. Available only when the API is
            configured with the dev-token route.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          data-testid="login-form"
          className={styles.form}
          noValidate
        >
          <Field
            id="login-user-id"
            label="User ID"
            required
            helper="UUID of an existing user row."
          >
            <Input
              id="login-user-id"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              data-testid="login-user-id"
            />
          </Field>

          <Field
            id="login-email"
            label="Email"
            optional
            helper="Optional. Stored on the session for display only."
          >
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
            />
          </Field>

          <Field
            id="login-ttl"
            label="Token TTL (seconds)"
            helper="Between 60 and 86400."
          >
            <Input
              id="login-ttl"
              type="number"
              min={60}
              max={86400}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              data-testid="login-ttl"
            />
          </Field>

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.submit}
              disabled={devLogin.isPending}
              data-testid="login-submit"
            >
              {devLogin.isPending ? 'Minting…' : 'Sign in'}
            </button>
            {devLogin.isError ? (
              <p
                className={styles.errorMeta}
                role="alert"
                data-testid="login-error"
              >
                {devLogin.error instanceof ApiError
                  ? `${devLogin.error.code} (${devLogin.error.status})`
                  : 'Login failed.'}
              </p>
            ) : null}
          </div>
        </form>

        <p className={styles.hint}>
          Sessions are kept in memory only. A page reload will require a new
          token.
        </p>
      </section>
    </main>
  );
}
