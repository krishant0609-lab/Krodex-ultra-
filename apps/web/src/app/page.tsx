/**
 * KRODEX web — public landing page.
 *
 * Premium animated marketing page for unauthenticated visitors.
 * Authenticated users are redirected to /dashboard.
 *
 * All animations use Motion Framer — no CSS keyframes.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, Variants } from 'framer-motion';
import { isAuthenticated } from '../lib/auth-store';
import { PageShell } from '../components/page-shell';
import { Button } from '../components/button';
import styles from './landing.module.css';

/* ─── Reusable variants ─────────────────────────────────── */
const FADE_UP: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const STAGGER_CONTAINER: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
};

const FADE_SCALE: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
};

/* ─── Orb float variants (driven by custom props) ─────────── */
const ORB_FLOAT = (delay: number, dx: number, dy: number, ds: number): Variants => ({
  hidden: { x: 0, y: 0, scale: 1 },
  visible: {
    x: [0, dx * 0.6, -dx * 0.4, dx * 0.3, 0],
    y: [0, dy * 0.5, dy * 0.8, dy * 0.3, 0],
    scale: [1, 1 + ds * 0.05, 1 - ds * 0.03, 1],
    transition: {
      duration: 14 + delay,
      delay,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
});

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
  },
];

/* ─── Sticky nav ─────────────────────────────────────────── */
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

/* ─── Floating orbs ─────────────────────────────────────── */
const ORBS = [
  { top: '-100px', left: '-200px', size: 700, color: 'rgba(110, 95, 179, 0.18)', delay: 0, dx: 60, dy: 80, ds: 1 },
  { bottom: '-50px', right: '-100px', size: 500, color: 'rgba(212, 137, 10, 0.12)', delay: 4, dx: -70, dy: -60, ds: 0.8 },
];

function Orb({ top, left, bottom, right, size, color, delay, dx, dy, ds }: typeof ORBS[0]): JSX.Element {
  return (
    <motion.div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        top,
        left,
        bottom,
        right,
      }}
      variants={ORB_FLOAT(delay, dx, dy, ds)}
      initial="hidden"
      animate="visible"
      aria-hidden="true"
    />
  );
}

/* ─── Animated hero ────────────────────────────────────────── */
function HeroSection(): JSX.Element {
  const containerVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
  };

  return (
    <section className={styles.hero}>
      <div className={styles.heroBg} aria-hidden="true">
        {ORBS.map((orb, i) => <Orb key={i} {...orb} />)}
        <div className={styles.heroBgGrid} />
      </div>

      <motion.div
        className={styles.heroContent}
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        <motion.div className={styles.heroBadge} variants={FADE_UP} transition={{ duration: 0.6 }}>
          <motion.span
            className={styles.heroBadgeDot}
            animate={{ opacity: [1, 0.5, 1], scale: [1, 0.8, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          One interconnected study system
        </motion.div>

        <motion.h1 className={styles.heroTitle} variants={FADE_UP} transition={{ duration: 0.6, delay: 0.1 }}>
          Your syllabus,<br />
          <span className={styles.heroTitleAccent}>your errors,</span><br />
          one model.
        </motion.h1>

        <motion.p className={styles.heroSubtitle} variants={FADE_UP} transition={{ duration: 0.6, delay: 0.2 }}>
          KRODEX connects a syllabus tree, tests, an error book, a review queue, and a planner
          into one editorial workspace. Every surface reads from the same event bus
          and the same student model — so nothing is fabricated and nothing is siloed.
        </motion.p>

        <motion.div className={styles.heroCtas} variants={FADE_UP} transition={{ duration: 0.6, delay: 0.3 }}>
          <Link href="/login?mode=signup">
            <Button variant="primary" size="lg">Start for free</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" size="lg">I have an account</Button>
          </Link>
        </motion.div>

        <motion.p className={styles.heroMeta} variants={FADE_UP} transition={{ duration: 0.6, delay: 0.4 }}>
          No credit card · No fabricated metrics · Real data, always
        </motion.p>
      </motion.div>
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

// Clock positions: 0=top, 1=upper-right, 2=lower-right, 3=bottom, 4=lower-left, 5=upper-left
const NODE_POSITIONS = [
  { top: 0, left: '50%', transform: 'translateX(-50%)' },
  { top: '22%', right: '5%', transform: 'none' },
  { bottom: '22%', right: '5%', transform: 'none' },
  { bottom: 0, left: '50%', transform: 'translateX(-50%)' },
  { bottom: '22%', left: '5%', transform: 'none' },
  { top: '22%', left: '5%', transform: 'none' },
];

function DiagramSection(): JSX.Element {
  return (
    <section className={styles.diagram} id="how-it-works">
      <div className={styles.sectionHeader}>
        <p className={styles.sectionEyebrow}>Architecture</p>
        <h2 className={styles.sectionTitle}>Six surfaces, one event bus</h2>
        <p className={styles.sectionSubtitle}>
          Every action publishes an event. Notifications, analytics, and the student model
          are all driven by the same queue — no polling, no duplication, no gaps.
        </p>
      </div>

      <div className={styles.diagramCanvas}>
        {/* Event bus center */}
        <motion.div
          className={styles.busCenter}
          initial={{ opacity: 0, scale: 0.5 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          viewport={{ once: true }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.9"/>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
            <circle cx="12" cy="12" r="12" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
          </svg>
          <span>Event<br/>bus</span>
        </motion.div>

        {/* Nodes */}
        <motion.div
          variants={STAGGER_CONTAINER}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          style={{ position: 'absolute', inset: 0 }}
        >
          {BUS_NODES.map((node, i) => (
            <motion.div
              key={node.label}
              className={styles.busNode}
              style={NODE_POSITIONS[i]}
              variants={FADE_SCALE}
            >
              <div className={styles.busNodeInner} style={{ '--node-color': node.color } as React.CSSProperties}>
                <span className={styles.busNodeLabel}>{node.label}</span>
                <span className={styles.busNodeSub}>{node.sub}</span>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Connecting lines */}
        {BUS_NODES.map((_, i) => (
          <motion.div
            key={`line-${i}`}
            className={`${styles.busLine} ${styles[`busLine${i}`]}`}
            initial={{ scaleY: 0, opacity: 0 }}
            whileInView={{ scaleY: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 + i * 0.06, ease: [0.25, 0.46, 0.45, 0.94] }}
            viewport={{ once: true }}
            style={{ originY: '0px' }}
          />
        ))}
      </div>
    </section>
  );
}

/* ─── Feature card ────────────────────────────────────────── */
function FeatureCard({ f, delay }: { f: typeof FEATURES[0]; delay: number }): JSX.Element {
  return (
    <motion.li
      className={styles.featureCard}
      data-accent={f.accent}
      variants={FADE_UP}
      whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
      style={{ ['--node-color' as string]: {
        sapphire: '#6fa5c8', amber: '#d4a00a', emerald: '#2e9e6e',
        lavender: '#a891ff', rose: '#c0526a', champagne: '#d4b832',
      }[f.accent] }}
    >
      <motion.span
        className={styles.featureIcon}
        data-accent={f.accent}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: delay * 0.08 + 0.2 }}
      >
        {f.icon}
      </motion.span>
      <h3 className={styles.featureTitle}>{f.title}</h3>
      <p className={styles.featureDesc}>{f.description}</p>
    </motion.li>
  );
}

/* ─── Feature grid ───────────────────────────────────────── */
function FeaturesSection(): JSX.Element {
  return (
    <section className={styles.features} id="features">
      <div className={styles.sectionHeader}>
        <p className={styles.sectionEyebrow}>Everything you need</p>
        <h2 className={styles.sectionTitle}>Six connected surfaces</h2>
        <p className={styles.sectionSubtitle}>
          Each surface is purpose-built. Together they form one coherent system —
          not a collection of disconnected tools.
        </p>
      </div>
      <motion.ul
        className={styles.featureGrid}
        variants={STAGGER_CONTAINER}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
      >
        {FEATURES.map((f, i) => (
          <FeatureCard key={f.title} f={f} delay={i} />
        ))}
      </motion.ul>
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
  return (
    <section className={styles.principles} id="principles">
      <div className={styles.sectionHeader}>
        <p className={styles.sectionEyebrow}>How we build</p>
        <h2 className={styles.sectionTitle}>Four commitments</h2>
      </div>
      <motion.ul
        className={styles.principlesGrid}
        variants={STAGGER_CONTAINER}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
      >
        {PRINCIPLES.map((p, i) => (
          <motion.li
            key={p.title}
            className={styles.principleCard}
            variants={FADE_UP}
            transition={{ delay: i * 0.1 }}
            whileHover={{ scale: 1.01, transition: { duration: 0.2 } }}
          >
            <span className={styles.principleIcon}>{p.icon}</span>
            <div>
              <h3 className={styles.principleTitle}>{p.title}</h3>
              <p className={styles.principleBody}>{p.body}</p>
            </div>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}

/* ─── Final CTA ───────────────────────────────────────────── */
function CtaSection(): JSX.Element {
  return (
    <section className={styles.cta}>
      <motion.div
        className={styles.ctaCard}
        initial={{ opacity: 0, y: 32, scale: 0.95 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
        whileHover={{ scale: 1.01 }}
        viewport={{ once: true, amount: 0.3 }}
      >
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
      </motion.div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────── */
function LandingFooter(): JSX.Element {
  return (
    <motion.footer
      className={styles.footer}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
      viewport={{ once: true }}
    >
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
    </motion.footer>
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
