/**
 * KRODEX web — public landing page.
 *
 * Handles BOTH anonymous visitors (renders the marketing page) and
 * authenticated users (redirects to /dashboard). This is the sole
 * owner of the "/" URL; there is no competing "(app)/page.tsx".
 *
 * Design rules:
 *  - No fake metrics, no fabricated progress.
 *  - All values shown to the user are derived from real hooks
 *    (none here — this is the unauthenticated surface).
 *  - All visual values come from --kd-* design tokens.
 *  - The CTA links route to /login which owns auth.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated } from '../lib/auth-store';
import { PageShell } from '../components/page-shell';
import { Hero } from '../components/hero';
import { Button } from '../components/button';
import styles from './landing.module.css';

interface Pillar {
  title: string;
  body: string;
  accent: 'sapphire' | 'rose' | 'emerald' | 'lavender' | 'amber' | 'champagne';
}

const PILLARS: readonly Pillar[] = [
  {
    title: 'Syllabus tree',
    body: 'A hierarchical map of every unit, chapter, and topic. The source of truth for what to study next.',
    accent: 'sapphire',
  },
  {
    title: 'Error book',
    body: 'Every wrong attempt becomes a durable, searchable record. Categorize the mistake, not just the question.',
    accent: 'amber',
  },
  {
    title: 'Spaced reviews',
    body: 'A scheduler that surfaces the right item at the right time. Honest estimates, no fabricated streaks.',
    accent: 'emerald',
  },
  {
    title: 'Planner',
    body: 'Plan templates, task automation, and missed-task detection — all driven by real events.',
    accent: 'lavender',
  },
  {
    title: 'Tests & attempts',
    body: 'Take tests, submit attempts, get an immediate, per-question analysis tied to the same event bus.',
    accent: 'rose',
  },
  {
    title: 'Progress & insights',
    body: 'Rollups computed from real persisted state. One student model, one source of truth.',
    accent: 'champagne',
  },
];

function LandingContent(): JSX.Element {
  return (
    <main className={styles.root} data-testid="landing-root">
      <Hero
        eyebrow="One interconnected study system"
        title="KRODEX"
        description="A study surface that connects a syllabus tree, tests, an error book, a review queue, and a planner into one editorial workspace. Every screen reads from the same event bus and the same student model."
        actions={
          <div className={styles.heroActions}>
            <Link href="/login?mode=signup" prefetch={false}>
              <Button
                variant="primary"
                size="lg"
                data-testid="landing-cta-signup"
              >
                Get started
              </Button>
            </Link>
            <Link href="/login" prefetch={false}>
              <Button
                variant="secondary"
                size="lg"
                data-testid="landing-cta-signin"
              >
                I already have an account
              </Button>
            </Link>
          </div>
        }
        meta="Phase 9 — connected learning surfaces"
        metaAccent="lavender"
      />

      <section className={styles.pillars} aria-label="What KRODEX does">
        <h2 className={styles.pillarsHeading}>Six connected surfaces</h2>
        <ul className={styles.pillarGrid}>
          {PILLARS.map((p) => (
            <li
              key={p.title}
              className={styles.pillar}
              data-testid={`pillar-${p.title.toLowerCase().replace(/\s+/g, '-')}`}
              data-accent={p.accent}
            >
              <span className={styles.pillarAccent} aria-hidden="true" />
              <h3 className={styles.pillarTitle}>{p.title}</h3>
              <p className={styles.pillarBody}>{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.principles} aria-label="How KRODEX is built">
        <h2 className={styles.principlesHeading}>How this is built</h2>
        <ul className={styles.principleList}>
          <li>
            <strong>No fake data.</strong> Every number on the dashboard comes from a real, persisted event.
          </li>
          <li>
            <strong>One event bus.</strong> Tests, attempts, errors, and reviews publish events; the same
            outbox worker drives notifications, analytics, and the student model.
          </li>
          <li>
            <strong>RLS at the database, assertOwned at the service layer.</strong> Cross-user data is
            not possible by design.
          </li>
          <li>
            <strong>Honest failure modes.</strong> A 503 from the API is reported as a 503, not hidden
            behind a generic empty state.
          </li>
        </ul>
      </section>

      <footer className={styles.landingFooter}>
        <span>© {new Date().getFullYear()} KRODEX</span>
        <span aria-hidden="true">·</span>
        <span>One source of truth · One student model · One event bus</span>
      </footer>
    </main>
  );
}

export default function LandingPage(): JSX.Element {
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

  if (authed === null) {
    return (
      <PageShell isLoading title="Loading KRODEX" description="Preparing your workspace…">
        <p>Preparing your workspace…</p>
      </PageShell>
    );
  }

  // authed === false — anonymous visitor, show the landing page
  return <LandingContent />;
}
