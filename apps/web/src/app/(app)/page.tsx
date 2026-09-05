/**
 * KRODEX web — authenticated root index.
 *
 * Replaces the auto-redirect logic that used to live in
 * src/app/page.tsx. Anonymous users now see the public
 * landing page (src/app/page.tsx); authenticated users
 * hitting "/" are routed to /dashboard.
 *
 * The redirect runs client-side after hydration so it does
 * not interfere with the server render. A short loading
 * state keeps the surface from blanking during the check.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '../../lib/auth-store';
import { PageShell } from '../../components/page-shell';

export default function AppIndex(): JSX.Element {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAuthenticated()) {
      router.replace('/dashboard');
      return;
    }
    setAuthed(false);
  }, [router]);

  if (authed === false) {
    // AppLayout (the (app) layout) will redirect to /login via
    // its own client guard. We still render a minimal shell so
    // the user sees something while the redirect happens.
    return (
      <PageShell
        isPermission
        title="Sign in required"
        description="Redirecting to sign in…"
      >
        <p>Redirecting to sign in…</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      isLoading
      title="Loading KRODEX"
      description="Preparing your workspace…"
    >
      <p>Preparing your workspace…</p>
    </PageShell>
  );
}
