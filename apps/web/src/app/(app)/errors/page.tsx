'use client';
import React, { useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import styles from './errors.module.css';

/* ─── Static Data ─────────────────────────────────────────── */
const EYE_BROW = 'Cognitive Forensics Engine \xb7 Module 04';
const INDEX_STATUS = 'Index Verified';
const PAGE_TITLE = 'The Diagnostic Error Book';
const PAGE_SUBTITLE =
  "Mistakes are evidence, not failure. KRODEX isolates cognitive fault vectors, tracks recurrent neuro-probes, and schedules targeted counter-drills until verified conceptual resolution.";

const METRICS = [
  { icon: 'fingerprint', value: '28', label: 'Cataloged Traps', iconColor: 'default' },
  { icon: 'published_with_changes', value: '3', label: 'High Recurrence (≥3×)', iconColor: 'error' },
  { icon: 'model_training', value: '74%', label: 'Post-Drill Recovery', iconColor: 'sapphire' },
  { icon: 'schedule', value: '4 Due', label: 'Spaced Retest Window', iconColor: 'tertiary' },
];

const FILTERS = [
  { label: 'All Mistakes', count: 28, value: 'all' },
  { label: 'Conceptual', count: 9, value: 'conceptual' },
  { label: 'Calculation', count: 6, value: 'calculation' },
  { label: 'Careless / Silly', count: 5, value: 'careless' },
  { label: 'Interpretation', count: 4, value: 'interpretation' },
  { label: 'Time Pressure', count: 4, value: 'time' },
];

const ERRORS = [
  {
    id: 'EB-0421',
    topic: 'Physics / Induction & Lenz\'s Law',
    category: 'conceptual',
    typeLabel: 'Conceptual / Sign Inversion',
    pillClass: 'pillConceptual',
    desc: 'Lorentz cross-product vector direction inversion when integrating eddy current streamlines inside varying flux.',
    age: 'Nov 13, 14:15',
    occurrence: '2nd Occurrence',
    recurrenceClass: 'errorRowFooterItemError',
    pill: 'pillOpen',
    pillText: 'Open',
    pillDot: true,
    statusText: 'Counter-probe active',
    statusPill: 'pillOpen',
    selected: true,
    idClass: 'idChampagne',
  },
  {
    id: 'EB-0420',
    topic: 'Mathematics / Definite Integrals',
    category: 'calculation',
    typeLabel: 'Calculation / Arithmetic Slip',
    pillClass: 'pillCalculation',
    desc: 'Parity mistake in King\'s Property application leading to redundant factor of 2 in numerator.',
    age: 'Nov 12, 09:40',
    occurrence: '1st Occurrence',
    recurrenceClass: '',
    pill: 'pillUnderReview',
    pillText: 'Under Review',
    pillDot: false,
    statusText: 'Day 7 Scheduled',
    statusPill: 'pillScheduled',
    selected: false,
    idClass: 'idMuted',
  },
  {
    id: 'EB-0418',
    topic: 'Chemistry / Equilibrium (Le Chatelier)',
    category: 'interpretation',
    typeLabel: 'Interpretation / Vol vs Press',
    pillClass: 'pillInterpretation',
    desc: "Confounded inert gas addition at constant pressure with addition at constant volume for dissociation reaction.",
    age: 'Nov 10, 18:22',
    occurrence: '3rd Occurrence (Critical)',
    recurrenceClass: 'errorRowFooterItemError',
    pill: 'pillUnresolved',
    pillText: 'Unresolved',
    pillDot: false,
    statusText: 'Needs Syllabus Reinforcement',
    statusPill: 'pillUnresolved',
    selected: false,
    idClass: 'idError',
  },
  {
    id: 'EB-0419',
    topic: 'Physics / Capacitance & Dielectrics',
    category: 'conceptual',
    typeLabel: 'Conceptual / Boundary Condition',
    pillClass: 'pillConceptual',
    desc: 'Misapplied dielectric polarization boundary condition at conductor-dielectric interface, leading to wrong effective capacitance.',
    age: 'Nov 8, 11:30',
    occurrence: '1st Occurrence',
    recurrenceClass: '',
    pill: 'pillUnderReview',
    pillText: 'Under Review',
    pillDot: false,
    statusText: 'Day 5 Scheduled',
    statusPill: 'pillScheduled',
    selected: false,
    idClass: 'idMuted',
  },
];

const DOSSIER = {
  id: 'EB-0421',
  domain: 'Physics \xb7 Rotational Induction',
  title: "Lenz Counter-Torque & Lorentz Sign Polarity",
  lifecycle: [
    { label: 'Captured', done: true, active: false },
    { label: 'Classified', done: true, active: false },
    { label: 'Active Review', done: true, active: false },
    { label: 'Retest Due', done: false, active: true },
    { label: 'Resolved', done: false, active: false },
  ],
  artifactRef: 'Exam Artifact #JEE-21-P1-Q14',
  question: '"Determine direction of induced eddy currents and net retarding torque in a thin conducting copper disc rotating with angular frequency ω in a non-uniform transverse magnetic field B(r) = B₀(1 − r/R)…"',
  misstep: "Student applied right-hand curl rule to mobile electron drift vector directly instead of conventional positive charge flux, effectively flipping the sign of the cross-product (v × B) and arriving at spontaneous flux acceleration instead of Lenz dissipation.",
  causes: [
    { label: 'Fault Taxonomy', val: 'Conceptual Inversion', desc: 'Persistent sign polarity misattribution under rotational frames.' },
    { label: 'Misconception Vector', val: 'Right-Hand Ambiguity', desc: 'Conflation of Lorentz force on electron vs current element I dl.' },
  ],
  lineage: [
    { icon: 'account_tree', iconClass: 'lineageIconSapphire', text: 'Physics › Electrodynamics › Chapter 14: Faraday & Lenz › ', strong: 'Topic 14.3 (Eddy Currents)' },
    { icon: 'menu_book', iconClass: 'lineageIconDefault', text: 'Exam Source: JEE Advanced 2021 Paper 1, Problem #14', strong: null },
    { icon: 'repeat', iconClass: 'lineageIconError', text: 'Observed in: Sept Diagnostic Test (#F-22) → Repeated Nov Practice Mock (#M-04)', strong: null },
  ],
  marginalia: {
    title: 'Tactile Rule for Verification',
    text: 'Whenever evaluating magnetic braking on moving bulk conductors: first identify the change in enclosed flux ΔΦ. The induced current MUST generate an opposed field. Do not start with electron sign conventions unless microscopic current density J = σ(E + v × B) is explicitly required.',
  },
};

/* ─── Framer Motion variants ──────────────────────────────── */
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

/* ─── Helpers ─────────────────────────────────────────────── */
function iconSvg(name: string) {
  const icons: Record<string, string> = {
    fingerprint: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
    published_with_changes: '<path d="M9 12l2 2 4-4"/><path d="M21 12c0 4-4.5 8-9.5 8s-8-3.5-9.5-8c1-4.5 4.5-8 9.5-8s8.5 3.5 9.5 8z"/>',
    model_training: '<path d="M12 2a4 4 0 0 1 4 4c0 1.1-.45 2.1-1.17 2.83L12 12l-2.83-3.17A4 4 0 0 1 12 2z"/><path d="M8 21a4 4 0 0 1-4-4c0-1.1.45-2.1 1.17-2.83L8 11l2.83 3.17A4 4 0 0 1 8 21z"/><path d="M21 21a4 4 0 0 1-4-4c0-1.1.45-2.1 1.17-2.83L16 11l2.83 3.17A4 4 0 0 1 21 21z"/><circle cx="12" cy="11" r="3"/>',
    schedule: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    calendar_today: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    check_circle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    history: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 10"/>',
    csv: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    done: '<polyline points="20 6 9 17 4 12"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    task_alt: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    tune: '<path d="M4 21V14"/><path d="M4 10V3"/><path d="M12 21V12"/><path d="M12 8V3"/><path d="M20 21V16"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
    account_tree: '<path d="M22 12H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    menu_book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    add_circle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    folder_open: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
  };
  return icons[name] ?? '';
}

function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      dangerouslySetInnerHTML={{ __html: iconSvg(name) }}
    />
  );
}

/* ─── Metric Card ─────────────────────────────────────────── */
function MetricCard({ icon, value, label, iconColor }: {
  icon: string; value: string; label: string; iconColor: string;
}) {
  const iconClass = {
    default: styles.metricIconDefault,
    error: styles.metricIconError,
    sapphire: styles.metricIconSapphire,
    tertiary: styles.metricIconTertiary,
  }[iconColor] ?? styles.metricIconDefault;

  return (
    <div className={styles.metricCard}>
      <div className={`${styles.metricIcon} ${iconClass}`}>
        <Icon name={icon} size={18} />
      </div>
      <div>
        <div className={styles.metricValue}>{value}</div>
        <div className={styles.metricLabel}>{label}</div>
      </div>
    </div>
  );
}

/* ─── Component ─────────────────────────────────────────── */
export default function ErrorsPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('EB-0421');
  const [searchQuery, setSearchQuery] = useState('');

  const selectedError = ERRORS.find((e) => e.id === selectedId) ?? ERRORS[0]!;

  const filteredErrors = ERRORS.filter((e) => {
    if (activeFilter !== 'all' && e.category !== activeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        e.topic.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <motion.div
      className={styles.page}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* ── Editorial Header ── */}
      <motion.div className={styles.editorialHeader} variants={item}>
        <div className={styles.headerLeft}>
          <div className={styles.headerEyebrow}>
            <span className={styles.eyebrowDot} />
            <span className={styles.eyebrowText}>{EYE_BROW}</span>
            <span className={styles.eyebrowSep}>&middot;</span>
            <span className={styles.eyebrowStatus}>{INDEX_STATUS}</span>
          </div>
          <h1 className={styles.title}>{PAGE_TITLE}</h1>
          <p className={styles.subtitle}>{PAGE_SUBTITLE}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnRetest}>
            <div className={styles.btnRetestIcon}>
              <Icon name="model_training" size={18} />
            </div>
            <div className={styles.btnRetestInfo}>
              <span className={styles.btnRetestLabel}>Generate Error-Based Test</span>
              <span className={styles.btnRetestSub}>6 Unresolved Electromagnetism items</span>
            </div>
          </button>
          <button className={styles.btnCapture}>
            <Icon name="add_circle" size={16} />
            Capture New Error
          </button>
        </div>
      </motion.div>

      {/* ── Metric Strip ── */}
      <motion.div variants={item}>
        <div className={styles.metricStrip}>
          {METRICS.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>
      </motion.div>

      {/* ── Filter & Search Row ── */}
      <motion.div className={styles.filterRow} variants={item}>
        <div className={styles.filterTabs}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={`${styles.filterTab} ${activeFilter === f.value ? styles.filterTabActive : ''}`}
              onClick={() => setActiveFilter(f.value)}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}><Icon name="search" size={16} /></span>
          <input
            className={styles.searchInput}
            placeholder="Filter by token, formula, topic or source..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className={styles.searchKbd}>/</span>
        </div>
      </motion.div>

      {/* ── Main Operating Matrix ── */}
      <div className={styles.operatingMatrix}>

        {/* LEFT PANE */}
        <motion.div className={styles.leftPane} variants={item}>
          {/* Archive Card */}
          <div className={styles.archiveCard}>
            <div className={styles.archiveHeader}>
              <span className={styles.archiveTitle}>
                Incident Archive &middot; {filteredErrors.length} Displayed of {ERRORS.length}
              </span>
              <div className={styles.archiveMeta}>
                <span className={styles.archiveMetaDot} />
                <span>Sorted by Diagnostic Priority</span>
              </div>
            </div>
            <div className={styles.archiveList}>
              {filteredErrors.map((e) => (
                <div
                  key={e.id}
                  className={`${styles.errorRow} ${selectedId === e.id ? styles.errorRowSelected : ''}`}
                  onClick={() => setSelectedId(e.id)}
                >
                  <div
                    className={`${styles.errorRowLeftBorder} ${
                      selectedId === e.id ? styles.borderChampagne : styles.borderTransparent
                    }`}
                  />
                  <div className={styles.errorRowInner}>
                    <div className={styles.errorRowTop}>
                      <div className={styles.errorRowIdSubject}>
                        <span className={`${styles.errorId} ${styles[e.idClass as keyof typeof styles] as string}`}>
                          {e.id}
                        </span>
                        <span className={styles.errorSubject}>{e.topic}</span>
                      </div>
                      <span className={`${styles.errorTypePill} ${styles[e.pillClass as keyof typeof styles] as string}`}>
                        {e.typeLabel}
                      </span>
                    </div>
                    <p className={styles.errorDesc}>{e.desc}</p>
                    <div className={styles.errorRowFooter}>
                      <div className={styles.errorRowFooterLeft}>
                        <span className={styles.errorRowFooterItem}>
                          <span className={styles.errorRowFooterItemIcon}><Icon name="calendar_today" size={12} /></span>
                          {e.age}
                        </span>
                        <span className={`${styles.errorRowFooterItem} ${styles[e.recurrenceClass as keyof typeof styles] as string}`}>
                          <span className={styles.errorRowFooterItemIcon}><Icon name={e.recurrenceClass ? 'error' : 'check_circle'} size={12} /></span>
                          {e.occurrence}
                        </span>
                      </div>
                      <div className={styles.errorRowFooterRight}>
                        <span className={`${styles.statusPill} ${styles[e.statusPill as keyof typeof styles] as string}`}>
                          {e.pillDot && <span className={styles.pillOpenDot} />}
                          {e.statusText}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.archiveFooter}>
              <div className={styles.archiveFooterLeft}>
                <span className={styles.archiveFooterIcon}><Icon name="info" size={14} /></span>
                <span>Spaced Retest Interval Engine: Fibonacci Scale (1, 2, 5, 12, 30 days)</span>
              </div>
              <button className={styles.loadMoreBtn}>Load Full 28 Entries &rarr;</button>
            </div>
          </div>

          {/* Fault Distribution Chart Card */}
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <span className={styles.chartTitle}>Fault Class Distribution // Last 30 Days</span>
              <span className={styles.chartMeta}>N = 43 Observed Vector Events</span>
            </div>
            {/* SVG sparkline */}
            <svg className={styles.chartSvg} viewBox="0 0 600 72" preserveAspectRatio="none" fill="none">
              <line className={styles.chartGridLine} x1="0" y1="20" x2="600" y2="20" />
              <line className={styles.chartGridLine} x1="0" y1="40" x2="600" y2="40" />
              <line className={styles.chartGridLine} x1="0" y1="60" x2="600" y2="60" />
              <path
                className={styles.chartPath}
                d="M 10 55 C 60 58, 100 50, 150 36 C 200 22, 250 42, 300 32 C 350 22, 400 16, 450 28 C 500 38, 550 14, 590 12"
              />
              <circle className={styles.chartDot} cx="150" cy="36" r="3.5" />
              <circle className={styles.chartDot} cx="300" cy="32" r="3.5" />
              <circle className={styles.chartDot} cx="450" cy="28" r="3.5" />
              <circle className={styles.chartDotCritical} cx="590" cy="12" r="4.5" />
            </svg>
            <div className={styles.chartBuckets}>
              <div className={styles.chartBucket}>
                <span className={styles.chartBucketVal}>Sign Flipping (32%)</span>
                <span className={styles.chartBucketLabel}>Dominant Physics fault</span>
              </div>
              <div className={styles.chartBucket}>
                <span className={styles.chartBucketVal}>Algebraic Pace (24%)</span>
                <span className={styles.chartBucketLabel}>Math Q3 speed slump</span>
              </div>
              <div className={styles.chartBucket}>
                <span className={styles.chartBucketVal}>Boundary Check (18%)</span>
                <span className={styles.chartBucketLabel}>Equilibrium endpoints</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* RIGHT PANE: Forensic Dossier */}
        <motion.div className={styles.rightPane} variants={item}>
          <div className={styles.dossierCard}>
            {/* Titlebar */}
            <div className={styles.dossierTitlebar}>
              <div className={styles.dossierTitlebarTop}>
                <span className={styles.dossierLabel}>
                  <span className={styles.dossierLabelIcon}><Icon name="csv" size={14} /></span>
                  Forensic Dossier #{selectedError.id.replace('EB-', '')}
                </span>
                <span className={styles.dossierTag}>{DOSSIER.domain}</span>
              </div>
              <h2 className={styles.dossierTitle}>{DOSSIER.title}</h2>
              {/* Lifecycle tracker */}
              <div className={styles.lifecycleTracker}>
                <div className={styles.lifecycleSteps}>
                  {DOSSIER.lifecycle.map((step, i) => (
                    <React.Fragment key={step.label}>
                      <div className={styles.lifecycleStep}>
                        <div className={styles.lifecycleStepLabel}>
                          {step.done ? (
                            <span className={`${styles.lifecycleStepLabelIcon} ${styles.lifecycleStepDone}`}>
                              <Icon name="done" size={10} />
                            </span>
                          ) : step.active ? (
                            <span className={`${styles.lifecycleStepLabelIcon} ${styles.lifecycleStepActive}`}>
                              <span className={`${styles.lifecycleDot} ${styles.dotActive}`} />
                            </span>
                          ) : (
                            <span className={`${styles.lifecycleDot} ${styles.dotPending}`} />
                          )}
                          {step.label}
                        </div>
                      </div>
                      {i < DOSSIER.lifecycle.length - 1 && (
                        <div style={{ flex: 0.5 }} />
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <div className={styles.lifecycleBar}>
                  <div className={`${styles.lifecycleBarSeg} ${styles.barChampagne}`} />
                  <div className={`${styles.lifecycleBarSeg} ${styles.barChampagne}`} />
                  <div className={`${styles.lifecycleBarSeg} ${styles.barChampagne}`} />
                  <div className={`${styles.lifecycleBarSeg} ${styles.barSapphire}`} />
                  <div className={`${styles.lifecycleBarSeg} ${styles.barEmpty}`} />
                </div>
              </div>
            </div>

            {/* Dossier body */}
            <div className={styles.dossierBody}>
              {/* Section 1: Question & Misstep */}
              <div className={styles.dossierSection}>
                <div className={styles.dossierSectionLabel}>
                  <span className={styles.dossierSectionTitle}>1. Question &amp; Evidence Artifact</span>
                  <span className={styles.dossierSectionRef}>{DOSSIER.artifactRef}</span>
                </div>
                <div className={styles.questionCard}>{DOSSIER.question}</div>
                <div className={styles.misstepCard}>
                  <div className={styles.misstepHeader}>
                    <span className={styles.misstepIcon}><Icon name="error" size={14} /></span>
                    Recorded Cognitive Misstep
                  </div>
                  <p
                    className={styles.misstepText}
                    dangerouslySetInnerHTML={{
                      __html: DOSSIER.misstep.replace(
                        '(v × B)',
                        '<code>(v × B)</code>'
                      ),
                    }}
                  />
                </div>
              </div>

              {/* Section 2: Root Cause */}
              <div className={styles.dossierSection}>
                <span className={styles.dossierSectionTitle}>2. Cognitive Root Cause Isolation</span>
                <div className={styles.causeGrid}>
                  {DOSSIER.causes.map((c) => (
                    <div key={c.label} className={styles.causeCard}>
                      <span className={styles.causeCardLabel}>{c.label}</span>
                      <span className={styles.causeCardVal}>{c.val}</span>
                      <span
                        className={styles.causeCardDesc}
                        dangerouslySetInnerHTML={{
                          __html: c.desc.replace(
                            'I dl',
                            '<code>I dl</code>'
                          ),
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 3: Diagram */}
              <div className={styles.dossierSection}>
                <span className={styles.dossierSectionTitle}>3. Forensic Apparatus Schematic</span>
                <div className={styles.diagramCard}>
                  <div className={styles.diagramPlaceholder}>
                    <span className={styles.diagramPlaceholderIcon}>
                      <Icon name="account_tree" size={28} />
                    </span>
                    <span className={styles.diagramPlaceholderText}>Fig 14.3: Induced Lorentz Torque Vector Analysis</span>
                  </div>
                  <div className={styles.diagramOverlay}>
                    <div className={styles.diagramOverlayLeft}>
                      <span className={styles.diagramFigLabel}>Fig 14.3: Induced Lorentz Torque Vector Analysis</span>
                      <span className={styles.diagramVerified}>Verified Proof</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 4: Linked Lineage */}
              <div className={styles.dossierSection}>
                <span className={styles.dossierSectionTitle}>4. Linked Curricular Lineage</span>
                <div className={styles.lineageCard}>
                  {DOSSIER.lineage.map((row, i) => (
                    <div key={i} className={styles.lineageRow}>
                      <span className={`${styles.lineageIcon} ${styles[row.iconClass as keyof typeof styles] as string}`}>
                        <Icon name={row.icon} size={14} />
                      </span>
                      <span>
                        {row.text}
                        {row.strong && (
                          <strong className={styles.lineageTextStrong}>{row.strong}</strong>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 5: Action Deck */}
              <div className={styles.dossierSection}>
                <div className={styles.actionDeck}>
                  <button className={styles.btnLaunchDrill}>
                    <Icon name="bolt" size={16} />
                    Launch Isomorphic Counter-Drill (3 Items)
                  </button>
                  <div className={styles.btnRow}>
                    <button className={styles.btnSecondary}>
                      <span className={`${styles.btnSecondaryIcon} ${styles.btnSecondaryTertiary}`}>
                        <Icon name="task_alt" size={14} />
                      </span>
                      Mark Remediated
                    </button>
                    <button className={styles.btnSecondary}>
                      <span className={styles.btnSecondaryIcon}>
                        <Icon name="tune" size={14} />
                      </span>
                      Adjust Cadence
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Marginalia Card */}
          <div className={styles.marginaliaCard}>
            <span className={styles.marginaliaIcon}>
              <Icon name="lightbulb" size={22} />
            </span>
            <div className={styles.marginaliaContent}>
              <span className={styles.marginaliaTitle}>{DOSSIER.marginalia.title}</span>
              <p
                className={styles.marginaliaText}
                dangerouslySetInnerHTML={{
                  __html: DOSSIER.marginalia.text.replace(
                    /J = σ\(E \+ v × B\)/g,
                    '<code>J = σ(E + v × B)</code>'
                  ),
                }}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
