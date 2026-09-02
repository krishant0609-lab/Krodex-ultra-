/**
 * KRODEX web — root index.
 *
 * Phase 7: editorial Hero replaces the Phase 6 placeholder.
 * Authenticated users are still routed to /dashboard; the
 * hero renders for unauthenticated visitors and surfaces a
 * single CTA to /login. No fake metrics, no fabricated
 * progress — the description names the surfaces the user
 * will see, the eyebrow names the phase.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '../lib/auth-store';
import { Hero } from '../components/hero';
import { Button } from '../components/button';

export default function HomePage(): JSX.Element {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    router.replace(isAuthenticated() ? '/dashboard' : '/login');
  }, [router]);

  return (
    <Hero
      eyebrow="Learning system foundation"
      title="KRODEX"
      description="A study surface that connects a syllabus tree, tests, an error book, a review queue, and a planner into a single editorial workspace."
      actions={
        <Button
          variant="primary"
          size="lg"
          onClick={(): void => {
            router.push('/login');
          }}
          data-testid="hero-cta"
        >
          Sign in to continue
        </Button>
      }
      meta="Phase 7 — UI/UX implementation"
      metaAccent="lavender"
    />
  );
}
