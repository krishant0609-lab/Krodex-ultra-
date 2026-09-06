/**
 * KRODEX web — public landing page.
 *
 * Premium animated marketing page for unauthenticated visitors.
 * Authenticated users are redirected to /dashboard.
 *
 * Design: KRODEX Living Learning System — dark editorial aesthetic.
 * All animations powered by Motion Framer (no CSS keyframes).
 * Three.js WebGL background for immersive 3D motion.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion, type Variants } from 'framer-motion';
import { isAuthenticated } from '../lib/auth-store';
import { PageShell } from '../components/page-shell';
import { Button } from '../components/button';
import styles from './landing.module.css';

/* ─── Dynamic imports (client-only) ──────────────────────── */
const THREECanvas = dynamic(() => import('../components/three-canvas'), { ssr: false });

/* ─── Shared spring configs ──────────────────────────────── */
const SPRING_FAST = { type: 'spring' as const, stiffness: 300, damping: 30 };
const SPRING_GENTLE = { type: 'spring' as const, stiffness: 100, damping: 16 };

/* ─── Stagger container variants ─────────────────────────── */
const STAGGER_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const FADE_UP: Variants = {
  hidden: { opacity: 0, y: 32 },
  show: { opacity: 1, y: 0, transition: SPRING_GENTLE },
};
const FADE_SCALE: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: SPRING_FAST },
};

/* ─── Sticky nav ─────────────────────────────────────────── */
function LandingNav(): JSX.Element {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      className={styles.nav}
      data-scrolled={scrolled}
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.navInner}>
        <div className={styles.navLogo}>
          <div className={styles.navLogoIcon}>
            <motion.div
              className={styles.navLogoDot}
              animate={{ opacity: [0.5, 1, 0.5], scale: [0.9, 1.15, 0.9] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
          <span className={styles.navLogoText}>KRODEX</span>
          <span className={styles.navBadge}>v1.0</span>
        </div>

        {/* Desktop nav */}
        <nav className={styles.navLinks} aria-label="Main navigation">
          <a href="#system">System</a>
          <a href="#interconnected">The Loop</a>
          <a href="#evidence">Evidence</a>
          <a href="#cta">Begin</a>
        </nav>

        <div className={styles.navCtas}>
          <Link href="/login" aria-label="Sign in to KRODEX">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/login?mode=signup" aria-label="Get started with KRODEX">
            <Button variant="primary" size="sm">Get started free</Button>
          </Link>
        </div>
      </div>
    </motion.header>
  );
}

/* ─── Floating ambient variables ──────────────────────────── */
const FLOAT_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: (i: number) => ({
    opacity: [0, 0.55, 0],
    y: [0, -14, 0],
    x: i % 2 === 0 ? [0, 8, 0] : [0, -6, 0],
    rotate: [0, 1.2, 0],
    transition: {
      duration: [10, 13, 11, 14][i % 4],
      repeat: Infinity,
      ease: 'easeInOut',
      delay: (i * 1.7) % 5,
    },
  }),
};

const FLOAT_FORMULAS = [
  { cls: 'fv1', text: 'ΔS_cognition = −k · ln Ω', i: 0 },
  { cls: 'fv2', text: 'λ_decay = 0.084 / day', i: 1 },
  { cls: 'fv3', text: 'P(Recall | t, S) = e^(−t/S)', i: 2 },
  { cls: 'fv4', text: 'E_error = ∫ (f_actual − f_model) dt', i: 3 },
  { cls: 'fv5', text: 'Entropy: 0.14 e.u. ⇄ Equilibrated', i: 4 },
];

function FloatingVariables(): JSX.Element {
  return (
    <div className={styles.floatingVars} aria-hidden="true">
      {FLOAT_FORMULAS.map((f) => (
        <motion.span
          key={f.cls}
          className={`${styles.floatingVar} ${styles[f.cls]}`}
          variants={FLOAT_VARIANTS}
          initial="initial"
          animate="animate"
          custom={f.i}
        >
          {f.text}
        </motion.span>
      ))}
    </div>
  );
}

/* ─── Orbital node data ─────────────────────────────────── */
const NODES = [
  { label: 'Syllabus', sub: 'Structural Knowledge Graph', n: '01', color: 'champagne' },
  { label: 'Tests & Probes', sub: 'Precision Benchmark', n: '02', color: 'sapphire' },
  { label: 'Error Book', sub: 'Cognitive Misconceptions', n: '03', color: 'lavender' },
  { label: 'Adaptive Reviews', sub: 'Memory Decay Defense', n: '04', color: 'emerald' },
  { label: 'Planner Vector', sub: 'Dynamic Real-Time Schedule', n: '05', color: 'sapphire' },
  { label: 'Student Insights', sub: 'Evolving Mental Model', n: '06', color: 'lavender' },
];

/* ─── Orbital diagram SVG ───────────────────────────────── */
const ORBITAL_RING_1: Variants = {
  animate: { rotate: 360, transition: { duration: 55, repeat: Infinity, ease: 'linear' } },
};
const ORBITAL_RING_2: Variants = {
  animate: { rotate: -360, transition: { duration: 40, repeat: Infinity, ease: 'linear' } },
};

const BEACON_PULSE: Variants = {
  animate: (i: number) => ({
    opacity: [0.15, 1, 0.15],
    scale: [1, 1.6, 1],
    transition: {
      duration: [2.4, 2.8, 2.1, 3.2][i],
      repeat: Infinity,
      ease: 'easeInOut',
      delay: [0, 0.5, 0.9, 1.3][i],
    },
  }),
};

function OrbitalStage(): JSX.Element {
  return (
    <div className={styles.orbitalStage}>
      <svg className={styles.orbitalSvg} viewBox="0 0 600 600" fill="none" aria-label="KRODEX interconnected learning system diagram">
        {/* Static orbit rings */}
        <circle cx="300" cy="300" r="230" stroke="rgba(230,204,160,0.1)" strokeDasharray="4 8" strokeWidth="1.2" />
        <circle cx="300" cy="300" r="150" stroke="rgba(162,155,254,0.12)" strokeWidth="1" />
        <circle cx="300" cy="300" r="80" stroke="rgba(56,189,248,0.22)" strokeWidth="1.5" />

        {/* Clockwise orbit ring 1 */}
        <motion.g variants={ORBITAL_RING_1} style={{ originX: '300px', originY: '300px' }}>
          <circle cx="300" cy="300" r="190" stroke="rgba(230,204,160,0.16)" strokeWidth="1" strokeDasharray="6 6" />
        </motion.g>

        {/* Counter-clockwise orbit ring 2 */}
        <motion.g variants={ORBITAL_RING_2} style={{ originX: '300px', originY: '300px' }}>
          <circle cx="300" cy="300" r="120" stroke="rgba(162,155,254,0.18)" strokeWidth="1" strokeDasharray="5 7" />
        </motion.g>

        {/* Animated flow lines */}
        <motion.line
          x1="300" y1="300" x2="160" y2="140"
          stroke="rgba(230,204,160,0.22)" strokeWidth="1.2" strokeDasharray="4 6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, ease: 'easeOut' }}
        />
        <motion.line
          x1="300" y1="300" x2="440" y2="150"
          stroke="rgba(56,189,248,0.22)" strokeWidth="1.2" strokeDasharray="4 6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, ease: 'easeOut', delay: 0.15 }}
        />
        <motion.line
          x1="300" y1="300" x2="480" y2="340"
          stroke="rgba(230,204,160,0.22)" strokeWidth="1.2" strokeDasharray="4 6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, ease: 'easeOut', delay: 0.3 }}
        />
        <motion.line
          x1="300" y1="300" x2="350" y2="480"
          stroke="rgba(16,185,129,0.22)" strokeWidth="1.2" strokeDasharray="4 6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, ease: 'easeOut', delay: 0.45 }}
        />
        <motion.line
          x1="300" y1="300" x2="140" y2="420"
          stroke="rgba(162,155,254,0.22)" strokeWidth="1.2" strokeDasharray="4 6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, ease: 'easeOut', delay: 0.6 }}
        />
        <motion.line
          x1="300" y1="300" x2="100" y2="280"
          stroke="rgba(56,189,248,0.22)" strokeWidth="1.2" strokeDasharray="4 6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, ease: 'easeOut', delay: 0.75 }}
        />

        <defs>
          <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e6cca0" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#a29bfe" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="lg2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#e6cca0" stopOpacity="0.2" />
          </linearGradient>
          <radialGradient id="rg1" cx="50%" cy="30%" r="60%">
            <stop offset="0%" stopColor="rgba(162,155,254,0.08)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* Static gradient lines */}
        <line x1="300" y1="300" x2="160" y2="140" stroke="url(#lg1)" strokeWidth="1.6" />
        <line x1="300" y1="300" x2="440" y2="150" stroke="url(#lg2)" strokeWidth="1.6" />
        <line x1="300" y1="300" x2="480" y2="340" stroke="url(#lg1)" strokeWidth="1.6" />
        <line x1="300" y1="300" x2="350" y2="480" stroke="url(#lg2)" strokeWidth="1.6" />
        <line x1="300" y1="300" x2="140" y2="420" stroke="url(#lg1)" strokeWidth="1.6" />
        <line x1="300" y1="300" x2="100" y2="280" stroke="url(#lg2)" strokeWidth="1.6" />

        {/* Animated signal beacons */}
        {[230, 370, 390, 325].map((cx, i) => {
          const cyArr = [220, 225, 320, 390];
          const colors = ['#e6cca0', '#38bdf8', '#a29bfe', '#10b981'];
          return (
            <motion.circle
              key={i}
              cx={cx} cy={cyArr[i]} r={i === 2 ? 4 : 3.5}
              fill={colors[i]}
              variants={BEACON_PULSE}
              initial="animate"
              animate="animate"
              custom={i}
            />
          );
        })}

        {/* Radial glow overlay */}
        <circle cx="300" cy="180" r="320" fill="url(#rg1)" />
      </svg>

      {/* Core hub */}
      <motion.div
        className={styles.coreHub}
        whileHover={{ scale: 1.12 }}
        transition={SPRING_FAST}
      >
        <span className={styles.coreHubLabel}>Living Core</span>
        <span className={styles.coreHubName}>KRODEX</span>
        <div className={styles.coreHubStatus}>
          <motion.span
            className={styles.coreHubDot}
            animate={{ opacity: [0.5, 1, 0.5], scale: [0.85, 1.15, 0.85] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className={styles.coreHubStatusText}>Synaptic Loop</span>
        </div>
        <span className={styles.coreHubNodes}>Σ_nodes: 6 active</span>
      </motion.div>
    </div>
  );
}

/* ─── Orbital node cards ───────────────────────────────── */
function OrbitalNodeCard({ node, index }: { node: typeof NODES[0]; index: number }): JSX.Element {
  return (
    <motion.div
      className={`${styles.orbitalNode} ${styles[`orbitalNode${index}`]}`}
      data-color={node.color}
      variants={FADE_UP}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      transition={{ delay: index * 0.1 }}
      whileHover={{ y: -5, transition: SPRING_FAST }}
    >
      <div className={styles.orbitalNodeInner}>
        <div className={styles.orbitalNodeNum}>{node.n}</div>
        <div>
          <div className={styles.orbitalNodeTitle}>{node.label}</div>
          <div className={styles.orbitalNodeSub}>{node.sub}</div>
        </div>
      </div>
      <div className={styles.orbitalNodeFooter}>
        <span>μ: {(80 + index * 1.7).toFixed(1)}%</span>
        <span className={styles.orbitalNodeStatus}>In Sync</span>
      </div>
    </motion.div>
  );
}

/* ─── Hero section ─────────────────────────────────────── */
function HeroSection(): JSX.Element {
  const heroVariants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1, delayChildren: 0.15 } },
  };

  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <motion.div
          className={styles.heroContent}
          variants={heroVariants}
          initial="hidden"
          animate="show"
        >
          <motion.div className={styles.heroBadge} variants={FADE_UP}>
            <motion.span
              className={styles.heroBadgeDot}
              animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            The Interconnected Learning Ecology — v1.0
          </motion.div>

          <motion.h1 className={styles.heroTitle} variants={FADE_UP}>
            Your syllabus, tests, errors,
            <br />
            <span className={styles.heroTitleAccent}>reviews — all connected.</span>
          </motion.h1>

          <motion.p className={styles.heroSubtitle} variants={FADE_UP}>
            KRODEX transforms fragmented study tools into one living, breathing system.
            Every mistake updates your plan. Every plan learns from your mistakes.
            Built for students who refuse to leave mastery to chance.
          </motion.p>

          <motion.div className={styles.heroTelemetry} variants={FADE_UP}>
            <motion.span
              className={styles.telemetryPill}
              data-color="champagne"
              whileHover={{ y: -2, transition: SPRING_FAST }}
            >
              <motion.span
                className={styles.telemetryDot}
                animate={{ backgroundColor: ['#e6cca0', '#d4a843', '#e6cca0'] }}
                transition={{ duration: 2.5, repeat: Infinity }}
              />
              <span>T_spacing = 48h optimal</span>
            </motion.span>
            <motion.span
              className={styles.telemetryPill}
              data-color="lavender"
              whileHover={{ y: -2, transition: SPRING_FAST }}
            >
              <span className={styles.telemetryDot} />
              <span>Prerequisite[Chem_102] ⇄ Linked</span>
            </motion.span>
            <motion.span
              className={styles.telemetryPill}
              data-color="sapphire"
              whileHover={{ y: -2, transition: SPRING_FAST }}
            >
              <motion.span
                className={styles.telemetryDot}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity }}
              />
              <span>δ_retention = 94.2%</span>
            </motion.span>
          </motion.div>

          <motion.div className={styles.heroCtas} variants={FADE_UP}>
            <Link href="/login?mode=signup">
              <Button variant="primary" size="lg">Begin your first study loop</Button>
            </Link>
            <Link href="#interconnected">
              <Button variant="secondary" size="lg">See how it works</Button>
            </Link>
          </motion.div>

          <motion.div className={styles.heroMeta} variants={FADE_UP}>
            <span>
              <motion.span
                className={styles.metaDot}
                data-color="sapphire"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              Zero fragmented notes
            </span>
            <span>
              <motion.span
                className={styles.metaDot}
                data-color="lavender"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2.4, repeat: Infinity }}
              />
              Closed learning loop
            </span>
            <span>
              <motion.span
                className={styles.metaDot}
                data-color="champagne"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.9, repeat: Infinity }}
              />
              Evidence-based mastery
            </span>
          </motion.div>
        </motion.div>

        {/* Orbital stage */}
        <div className={styles.heroOrbital}>
          <OrbitalStage />
          {NODES.map((node, i) => (
            <OrbitalNodeCard key={node.label} node={node} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Contrast section ─────────────────────────────────── */
function ContrastSection(): JSX.Element {
  return (
    <section className={styles.contrast} id="interconnected">
      <motion.div
        className={styles.sectionHeader}
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={SPRING_GENTLE}
      >
        <p className={styles.sectionEyebrow}>System Architectural Contrast</p>
        <h2 className={styles.sectionTitle}>One system. Not seven disconnected tools.</h2>
        <p className={styles.sectionSubtitle}>
          Most study methods fail because notes, flashcards, calendars, tests, and error analysis
          exist in isolated silos. KRODEX dissolves those boundaries into an interconnected living circuit.
        </p>
      </motion.div>

      <div className={styles.contrastGrid}>
        {/* Fragmented — the problem */}
        <motion.div
          className={styles.cardFragmented}
          variants={FADE_SCALE}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          <div className={styles.cardHeader}>
            <span className={styles.cardTag} data-variant="red">Entropy High</span>
          </div>
          <h3 className={styles.cardTitle}>Isolated Tools, Lost Evidence</h3>
          <p className={styles.cardBody}>
            You highlight a textbook. Days later you take a test. You miss question 14.
            The mistake stays in a paper margin. Your planner knows nothing about it.
            Your next study session ignores the failure entirely.
          </p>
          <div className={styles.fragmentedIcons}>
            <div className={styles.fragIcon}>
              <span>Syllabus PDF</span>
              <span className={styles.fragIconSub}>Static document</span>
            </div>
            <div className={styles.fragIcon}>
              <span>Paper Notebook</span>
              <span className={styles.fragIconSub}>Unindexed errors</span>
            </div>
            <div className={styles.fragIcon}>
              <span>Calendar App</span>
              <span className={styles.fragIconSub}>Blind to decay</span>
            </div>
          </div>
          <div className={styles.cardFooter}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
            </svg>
            Feedback loop broken at every juncture
          </div>
        </motion.div>

        {/* KRODEX — the solution */}
        <motion.div
          className={styles.cardKrodex}
          variants={FADE_SCALE}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          transition={{ delay: 0.15 }}
        >
          <div className={styles.cardHeader}>
            <span className={styles.cardTag} data-variant="green">Synchronous Flow</span>
          </div>
          <h3 className={styles.cardTitle}>Closed-Loop Learning Architecture</h3>
          <p className={styles.cardBody}>
            When you make a mistake in a practice test, KRODEX tags the conceptual flaw
            directly into your Error Book, recalibrates your next review date, and
            automatically adjusts your Planner in real time.
          </p>
          <div className={styles.pipeline}>
            <motion.div
              className={styles.pipelineStep}
              data-color="champagne"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={SPRING_GENTLE}
            >
              <motion.span
                className={styles.pipelineDot}
                animate={{ opacity: [0.6, 1, 0.6], scale: [0.85, 1.15, 0.85] }}
                transition={{ duration: 2.2, repeat: Infinity }}
              />
              <span>Syllabus Node Activated</span>
              <span className={styles.pipelineMeta}>Electromagnetism §4.2</span>
            </motion.div>

            {/* Animated tracer beam */}
            <div className={styles.pipelineTracer}>
              <motion.div
                className={styles.tracerLine}
                initial={{ scaleY: 0, originY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.3 }}
                style={{ originY: 0 }}
              >
                <motion.div
                  style={{
                    position: 'absolute',
                    top: 0, left: 0,
                    width: '3px',
                    height: '12px',
                    background: '#e6cca0',
                    borderRadius: '2px',
                  }}
                  animate={{ y: ['-100%', '500%'] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
                />
              </motion.div>
              <motion.span
                className={styles.tracerLabel}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
              >
                packet_id: #EB-948
              </motion.span>
            </div>

            <motion.div
              className={styles.pipelineStep}
              data-color="lavender"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ ...SPRING_GENTLE, delay: 0.12 }}
            >
              <motion.span
                className={styles.pipelineDot}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 2.2, repeat: Infinity }}
              />
              <span>Diagnostic Test &amp; Mistake Captured</span>
              <span className={styles.pipelineMeta}>Sign error on Lenz&apos;s Law</span>
            </motion.div>

            <div className={styles.pipelineTracer}>
              <motion.div
                className={styles.tracerLine}
                initial={{ scaleY: 0, originY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.6 }}
                style={{ originY: 0 }}
              >
                <motion.div
                  style={{
                    position: 'absolute',
                    top: 0, left: 0,
                    width: '3px',
                    height: '12px',
                    background: '#a29bfe',
                    borderRadius: '2px',
                  }}
                  animate={{ y: ['-100%', '500%'] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: 1.7 }}
                />
              </motion.div>
              <motion.span
                className={styles.tracerLabel}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.8 }}
              >
                recalibration: Δt = 48h
              </motion.span>
            </div>

            <motion.div
              className={styles.pipelineStep}
              data-color="emerald"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ ...SPRING_GENTLE, delay: 0.22 }}
            >
              <motion.span
                className={styles.pipelineDot}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 2.2, repeat: Infinity }}
              />
              <span>Adaptive Review &amp; Retest Slated</span>
              <span className={styles.pipelineMeta}>Prioritized in Planner for T+48h</span>
            </motion.div>
          </div>
          <div className={styles.cardFooter}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" />
            </svg>
            Zero information loss. Every mistake informs tomorrow&apos;s plan.
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Six surfaces section ─────────────────────────────── */
const SURFACES = [
  {
    color: 'champagne',
    tag: 'The Infinite Archivist',
    node: '01', abbr: 'SY',
    title: 'Syllabus Architecture',
    body: 'Transforms raw course requirements into a living topic hierarchy with real-time mastery depth mapping.',
    meta: [
      { label: 'Topic: Complex Analysis', value: 'Verified' },
      { label: 'Prerequisites', value: 'Node[BIO-401] ⇄ Synapse' },
    ],
  },
  {
    color: 'lavender',
    tag: 'The Forensic Analyst',
    node: '02', abbr: 'EB',
    title: 'Error Book Intelligence',
    body: 'Mistakes are categorized by cognitive fault type — conceptual, computation, or oversight — to prevent recurrence.',
    meta: [
      { label: 'Misconception Tagged', value: 'Cognitive Root' },
      { label: 'Fault Vector', value: 'Active: Sign Inversion' },
    ],
  },
  {
    color: 'sapphire',
    tag: 'The Relentless Mastery',
    node: '03', abbr: 'RV',
    title: 'Adaptive Reviews',
    body: 'Calculated revision intervals powered by individual error volatility rather than rigid generic schedules.',
    meta: [
      { label: 'Decay Curve Interval', value: 'Optimal Spacing' },
      { label: 'Function', value: 'λ = 0.084 / day' },
    ],
  },
  {
    color: 'emerald',
    tag: 'The Master Strategist',
    node: '04', abbr: 'PL',
    title: 'Responsive Planner',
    body: 'Plans that flex when life intervenes. Unfinished tasks roll over intelligently without moralizing pressure.',
    meta: [
      { label: 'Capacity Matching', value: 'Real Time' },
      { label: 'Allocation Matrix', value: 'T_spacing = 48h' },
    ],
  },
  {
    color: 'sapphire',
    tag: null,
    node: '05', abbr: 'TS',
    title: 'Diagnostic Tests',
    body: 'Formative assessments built directly from your current syllabus gaps and historical error clusters.',
    meta: [
      { label: 'Assessment Focus', value: 'High-Entropy Areas' },
      { label: 'Probe Status', value: 'θ_confidence > 0.90' },
    ],
  },
  {
    color: 'lavender',
    tag: null,
    node: '06', abbr: 'CM',
    title: 'Cognitive Model',
    body: 'True diagnostic understanding of where your knowledge holds firm and where structural support is required.',
    meta: [
      { label: 'Understanding Profile', value: 'Multi-variable' },
      { label: 'Thermodynamics', value: 'Entropy: 0.14 e.u.' },
    ],
  },
];

function SurfacesSection(): JSX.Element {
  return (
    <section className={styles.surfaces} id="surfaces">
      <motion.div
        className={styles.sectionHeader}
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={SPRING_GENTLE}
      >
        <p className={styles.sectionEyebrow} data-color="lavender">System Surfaces</p>
        <h2 className={styles.sectionTitle}>Six Living Nodes. One Coherent Mind.</h2>
        <p className={styles.sectionSubtitle}>Each component is an active organ inside your personal learning system.</p>
      </motion.div>

      <motion.ul
        className={styles.surfacesGrid}
        variants={STAGGER_CONTAINER}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.1 }}
      >
        {SURFACES.map((s, i) => (
          <motion.li
            key={s.title}
            className={styles.surfaceCard}
            data-color={s.color}
            variants={FADE_UP}
            whileHover={{ y: -5, transition: SPRING_FAST }}
          >
            {s.tag && (
              <div className={styles.surfaceTag} data-color={s.color}>
                <motion.span
                  className={styles.surfaceTagDot}
                  animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.3, 0.8] }}
                  transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.35 }}
                />
                {s.tag}
              </div>
            )}
            <div className={styles.surfaceCardTop}>
              <span className={styles.surfaceNode}>Node {s.node}</span>
              <span className={styles.surfaceAbbr} data-color={s.color}>{s.abbr}</span>
            </div>
            <h3 className={styles.surfaceTitle}>{s.title}</h3>
            <p className={styles.surfaceBody}>{s.body}</p>
            <div className={styles.surfaceMeta}>
              {s.meta.map((m) => (
                <div key={m.label} className={styles.surfaceMetaRow}>
                  <span>{m.label}</span>
                  <span data-color={s.color}>{m.value}</span>
                </div>
              ))}
            </div>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}

/* ─── Evidence section (ticker + 6-step chain) ─────────── */
const EVIDENCE_STEPS = [
  { n: '01', color: 'champagne', title: 'Study', subtitle: 'Concept Ingestion', body: 'Read, map ideas, and identify core theorems.', node: 'Node[BIO-401]' },
  { n: '02', color: 'sapphire', title: 'Practice', subtitle: 'Active Problem Solving', body: 'Put theorems against challenging exercises.', node: 'Probe_Run #42' },
  { n: '03', color: 'lavender', title: 'Mistake', subtitle: 'Error Isolation', body: 'Mistakes treated as high-value data signals.', node: 'Cognitive Δ isolated' },
  { n: '04', color: 'emerald', title: 'Review', subtitle: 'Targeted Correction', body: 'Deconstruct the misunderstanding deeply.', node: 'Decay offset: t+48h' },
  { n: '05', color: 'champagne', title: 'Retest', subtitle: 'Spaced Verification', body: 'Probe the exact same cognitive fault lines.', node: 'P(Recall) > 0.95' },
  { n: '06', color: 'champagne', title: 'Mastery', subtitle: 'Verified Insight', body: 'The loop closes with permanent mental models.', node: 'Integrated Model' },
];

function EvidenceSection(): JSX.Element {
  const TICKER_ITEMS = [
    { color: 'champagne', text: "[CAPTURED: Lenz's Law divergence]", pulse: true },
    { color: 'lavender', text: '[RECALIBRATED: Next review in 48h]', pulse: false },
    { color: 'sapphire', text: '[INGESTED: Syllabus Module 4 — Vector Fields]', pulse: false },
    { color: 'emerald', text: '[RESOLVED: Chemiosmosis Gradient Error]', pulse: true },
    { color: 'champagne', text: 'ΔS_system: -0.04 e.u.', pulse: false },
    { color: 'slate', text: '[PROBE: Eigenvalues §3.1 pass rate 92%]', pulse: false },
  ];

  return (
    <section className={styles.evidence} id="evidence">
      {/* Infinite cognitive telemetry marquee */}
      <div className={styles.ticker}>
        <div className={styles.tickerFadeLeft} />
        <motion.div
          className={styles.tickerTrack}
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 48, repeat: Infinity, ease: 'linear' }}
          style={{ display: 'flex', alignItems: 'center', gap: '24px', width: 'max-content' }}
        >
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i} className={styles.tickerItem} data-color={item.color}>
              <motion.span
                className={styles.tickerDot}
                animate={item.pulse ? { opacity: [0.4, 1, 0.4], scale: [0.8, 1.3, 0.8] } : {}}
                transition={item.pulse ? { duration: 1.8, repeat: Infinity } : {}}
              />
              {item.text}
            </span>
          ))}
        </motion.div>
        <div className={styles.tickerFadeRight} />
      </div>

      {/* Section header */}
      <motion.div
        className={styles.evidenceHeader}
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={SPRING_GENTLE}
      >
        <p className={styles.sectionEyebrow} data-color="champagne">Evidence Continuity</p>
        <h2 className={styles.evidenceTitle}>Every action leaves useful evidence.</h2>
        <p className={styles.evidenceSubtitle}>The complete cognitive progression through the KRODEX system.</p>
      </motion.div>

      {/* 6-step evidence chain */}
      <div className={styles.evidenceChain}>
        {EVIDENCE_STEPS.map((step, i) => (
          <motion.div
            key={step.n}
            className={styles.evidenceStep}
            data-color={step.color}
            initial={{ opacity: 0, y: 28, scale: 0.94 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ ...SPRING_GENTLE, delay: i * 0.08 }}
            whileHover={{ y: -5, transition: SPRING_FAST }}
          >
            <span className={styles.evidenceStepN}>{step.n} — {step.title}</span>
            <h4>{step.subtitle}</h4>
            <p>{step.body}</p>
            <span className={styles.evidenceStepNode}>{step.node}</span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ─── CTA section ─────────────────────────────────────── */
function CtaSection(): JSX.Element {
  return (
    <section className={styles.cta} id="cta">
      <motion.div
        className={styles.ctaCard}
        initial={{ opacity: 0, scale: 0.92 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={SPRING_GENTLE}
      >
        <motion.div
          className={styles.ctaBadge}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 3.5, repeat: Infinity }}
        >
          Ready to Begin
        </motion.div>
        <h2 className={styles.ctaTitle}>Turn studying into a system.</h2>
        <p className={styles.ctaSubtitle}>
          Step into a deliberate environment built for students who demand clarity,
          interconnected evidence, and genuine mastery — not just another study app.
        </p>
        <div className={styles.ctaActions}>
          <Link href="/login?mode=signup">
            <Button variant="primary" size="lg">Get started free — no credit card</Button>
          </Link>
          <Link href="/login">
            <Button variant="ghost" size="lg">Already a member? Sign in</Button>
          </Link>
        </div>
      </motion.div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────── */
function LandingFooter(): JSX.Element {
  return (
    <motion.footer
      className={styles.footer}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7 }}
    >
      <div className={styles.footerInner}>
        <div className={styles.footerLogo}>
          <span>KRODEX</span>
          <span className={styles.footerTagline}>The Interconnected Learning System — v1.0</span>
        </div>
        <nav className={styles.footerLinks}>
          <a href="#surfaces">Features</a>
          <a href="#interconnected">How it works</a>
          <a href="#evidence">Principles</a>
          <a href="/login">Sign in</a>
          <a href="/login?mode=signup">Get started</a>
        </nav>
        <p className={styles.footerCopy}>System Concept 01 — Living Learning System</p>
      </div>
    </motion.footer>
  );
}

/* ─── Page root ─────────────────────────────────────── */
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
      {/* Three.js WebGL background */}
      <THREECanvas />
      <LandingNav />
      <FloatingVariables />
      <main>
        <HeroSection />
        <ContrastSection />
        <SurfacesSection />
        <EvidenceSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
