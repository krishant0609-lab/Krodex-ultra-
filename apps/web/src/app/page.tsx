/**
 * KRODEX web — public landing page.
 *
 * Premium animated marketing page for unauthenticated visitors.
 * Authenticated users are redirected to /dashboard.
 *
 * Design rules:
 *  - No fake metrics, no fabricated progress.
 *  - All values shown are derived from real hooks (none on this
 *    surface — it is the unauthenticated entry point).
 *  - All visual values use --kd-* design tokens.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated } from '../lib/auth-store';
import { PageShell } from '../components/page-shell';
import { Button } from '../components/button';
import styles from './landing.module.css';

/* ─── Feature data ─────────────────────────────────────────── */
const FEATURES = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    ),
    title: 'Syllabus tree',
    description: 'A hierarchical map of every unit, chapter, and topic. The single source of truth for what comes next in your study plan.',
    accent: 'sapphire',
    stat: null,
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
    title: 'Error book',
    description: 'Every wrong attempt becomes a durable record. Categorize the mistake, not just the question — so patterns become visible.',
    accent: 'amber',
    stat: null,
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    title: 'Spaced reviews',
    description: 'A scheduler that surfaces the right item at the right time. Honest estimates — no fabricated streaks or gamified counts.',
    accent: 'emerald',
    stat: null,
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="9" y1="21" x2="9" y2="9"/>
      </svg>
    ),
    title: 'Planner',
    description: 'Plan templates, task automation, and missed-task detection — all driven by the same event bus that powers every other surface.',
    accent: 'lavender',
    stat: null,
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
    title: 'Tests & attempts',
    description: 'Take tests, submit attempts, and get immediate per-question analysis — all publishing events into the same bus that drives everything else.',
    accent: 'rose',
    stat: null,
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
    title: 'Progress & insights',
    description: 'Rollups computed from real persisted state. One student model, one source of truth — so every insight is earned, not estimated.',
    accent: 'champagne',
    stat: null,
  },
];

/* ─── UseInView hook (tiny, no library needed) ──────────── */
function useInView(ref: React.RefObject<Element | null>, threshold = 0.15): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) setInView(true); }, { threshold });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref, threshold]);
  return inView;
}

/* ─── Feature card ────────────────────────────────────────── */
function FeatureCard({ f, delay }: { f: typeof FEATURES[0]; delay: number }): JSX.Element {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref as React.RefObject<Element>);
  return (
    <li
      ref={ref}
      className={styles.featureCard}
      data-accent={f.accent}
      style={{ transitionDelay: `${delay}ms` }}
      data-inview={inView}
    >
      <span className={styles.featureIcon} data-accent={f.accent}>{f.icon}</span>
      <h3 className={styles.featureTitle}>{f.title}</h3>
      <p className={styles.featureDesc}>{f.description}</p>
    </li>
  );
}

/* ─── Sticky nav ──────────────────────────────────────────── */
function LandingNav(): JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={styles.nav} data-scrolled={scrolled}>
      <div className={styles.navInner}>
        <span className={styles.navLogo}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          KRODEX
        </span>
        <div className={styles.navLinks}>
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#principles">Principles</a>
        </div>
        <div className={styles.navCtas}>
          <Link href="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/login?mode=signup">
            <Button variant="primary" size="sm">Get started free</Button>
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ─── Animated hero ────────────────────────────────────────── */
function HeroSection(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref as React.RefObject<Element>, 0.1);
  return (
    <section className={styles.hero} ref={ref} data-inview={inView}>
      <div className={styles.heroBg} aria-hidden="true">
        <div className={styles.heroBgOrb1} />
        <div className={styles.heroBgOrb2} />
        <div className={styles.heroBgGrid} />
      </div>
      <div className={styles.heroContent}>
        <div className={styles.heroBadge} data-inview={inView}>
          <span className={styles.heroBadgeDot} />
          One interconnected study system
        </div>
        <h1 className={styles.heroTitle} data-inview={inView} style={{ transitionDelay: '100ms' }}>
          Your syllabus,<br />
          <span className={styles.heroTitleAccent}>your errors,</span><br />
          one model.
        </h1>
        <p className={styles.heroSubtitle} data-inview={inView} style={{ transitionDelay: '200ms' }}>
          KRODEX connects a syllabus tree, tests, an error book, a review queue, and a planner
          into one editorial workspace. Every surface reads from the same event bus
          and the same student model — so nothing is fabricated and nothing is siloed.
        </p>
        <div className={styles.heroCtas} data-inview={inView} style={{ transitionDelay: '300ms' }}>
          <Link href="/login?mode=signup">
            <Button variant="primary" size="lg">Start for free</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" size="lg">I have an account</Button>
          </Link>
        </div>
        <p className={styles.heroMeta} data-inview={inView} style={{ transitionDelay: '400ms' }}>
          No credit card · No fabricated metrics · Real data, always
        </p>
      </div>
    </section>
  );
}

/* ─── Connected diagram ───────────────────────────────────── */
const BUS_NODES = [
  { label: 'Syllabus', sub: 'tree & topics', color: '#4a6fa5' },
  { label: 'Tests', sub: 'attempts & analysis', color: '#c0526a' },
  { label: 'Errors', sub: 'categorised mistakes', color: '#d4890a' },
  { label: 'Reviews', sub: 'spaced scheduler', color: '#2e9e6e' },
  { label: 'Planner', sub: 'tasks & events', color: '#7c6eb8' },
  { label: 'Insights', sub: 'student model', color: '#b8960d' },
];

function DiagramSection(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref as React.RefObject<Element>, 0.1);
  return (
    <section className={styles.diagram} id="how-it-works" ref={ref}>
      <div className={styles.sectionHeader}>
        <p className={styles.sectionEyebrow}>Architecture</p>
        <h2 className={styles.sectionTitle}>Six surfaces, one event bus</h2>
        <p className={styles.sectionSubtitle}>
          Every action publishes an event. Notifications, analytics, and the student model
          are all driven by the same queue — no polling, no duplication, no gaps.
        </p>
      </div>
      <div className={styles.diagramCanvas} data-inview={inView}>
        {BUS_NODES.map((node, i) => (
          <div key={node.label} className={styles.busNode} style={{ transitionDelay: `${i * 80}ms` }} data-inview={inView}>
            <div className={styles.busNodeInner} style={{ '--node-color': node.color } as React.CSSProperties}>
              <span className={styles.busNodeLabel}>{node.label}</span>
              <span className={styles.busNodeSub}>{node.sub}</span>
            </div>
          </div>
        ))}
        <div className={styles.busCenter} data-inview={inView}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.9"/>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
            <circle cx="12" cy="12" r="12" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
          </svg>
          <span>Event<br/>bus</span>
        </div>
        {BUS_NODES.map((_, i) => (
          <div key={`line-${i}`} className={`${styles.busLine} ${styles[`busLine${i}`]}`} data-inview={inView} />
        ))}
      </div>
    </section>
  );
}

/* ─── Feature grid ───────────────────────────────────────── */
function FeaturesSection(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useInView(ref as React.RefObject<Element>, 0.05);
  return (
    <section className={styles.features} id="features" ref={ref}>
      <div className={styles.sectionHeader}>
        <p className={styles.sectionEyebrow}>Everything you need</p>
        <h2 className={styles.sectionTitle}>Six connected surfaces</h2>
        <p className={styles.sectionSubtitle}>
          Each surface is purpose-built. Together they form one coherent system —
          not a collection of disconnected tools.
        </p>
      </div>
      <ul className={styles.featureGrid}>
        {FEATURES.map((f, i) => (
          <FeatureCard key={f.title} f={f} delay={i * 80} />
        ))}
      </ul>
    </section>
  );
}

/* ─── Principles ───────────────────────────────────────────── */
const PRINCIPLES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    ),
    title: 'No fake data',
    body: 'Every number on the dashboard comes from a real, persisted event.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: 'RLS at the database',
    body: 'assertOwned at the service layer. Cross-user data is not possible by design.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
    title: 'Honest failure modes',
    body: 'A 503 from the API is reported as a 503 — never hidden behind an empty state.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    ),
    title: 'Transparent by default',
    body: 'You see what the system knows, what it estimated, and where the gaps are.',
  },
];

function PrinciplesSection(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref as React.RefObject<Element>, 0.1);
  return (
    <section className={styles.principles} id="principles" ref={ref}>
      <div className={styles.sectionHeader}>
        <p className={styles.sectionEyebrow}>How we build</p>
        <h2 className={styles.sectionTitle}>Four commitments</h2>
      </div>
      <ul className={styles.principlesGrid}>
        {PRINCIPLES.map((p, i) => (
          <li key={p.title} className={styles.principleCard} data-inview={inView} style={{ transitionDelay: `${i * 100}ms` }}>
            <span className={styles.principleIcon}>{p.icon}</span>
            <div>
              <h3 className={styles.principleTitle}>{p.title}</h3>
              <p className={styles.principleBody}>{p.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─── Final CTA ───────────────────────────────────────────── */
function CtaSection(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref as React.RefObject<Element>, 0.2);
  return (
    <section className={styles.cta} ref={ref} data-inview={inView}>
      <div className={styles.ctaCard} data-inview={inView} style={{ transitionDelay: '0ms' }}>
        <h2 className={styles.ctaTitle}>Ready to study with clarity?</h2>
        <p className={styles.ctaSubtitle}>
          Join learners who use KRODEX to connect their syllabus, errors, reviews,
          and planning into one honest, event-driven system.
        </p>
        <div className={styles.ctaActions}>
          <Link href="/login?mode=signup">
            <Button variant="primary" size="lg">Create free account</Button>
          </Link>
          <Link href="/login">
            <Button variant="ghost" size="lg">Sign in instead</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────── */
function LandingFooter(): JSX.Element {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span className={styles.footerLogo}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          KRODEX
        </span>
        <p className={styles.footerTagline}>One source of truth · One student model · One event bus</p>
        <p className={styles.footerCopy}>© {new Date().getFullYear()} KRODEX. Built with real data.</p>
      </div>
    </footer>
  );
}

/* ─── Page root ───────────────────────────────────────────── */
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

  return (
    <div className={styles.page}>
      <LandingNav />
      <main>
        <HeroSection />
        <FeaturesSection />
        <DiagramSection />
        <PrinciplesSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
