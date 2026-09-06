'use client';
import React, { useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import styles from './syllabus.module.css';

/* ─── Static data ─────────────────────────────────────────── */
const METRICS = [
  { label: 'Total Syllabus Scope', value: '208', meta: 'Topics / 3 Stems', icon: 'account_tree' },
  { label: 'Verified Mastery', value: '142', meta: '68.4%', pct: 68.4, icon: 'verified' },
  { label: 'Active Spaced Probes', value: '38', meta: 'In Decay Envelope', icon: 'cycle' },
  { label: 'Active Error Faults', value: '28', meta: 'Pending Error Book', icon: 'warning' },
];

const FILTERS = [
  { id: 'all', label: 'All Disciplines' },
  { id: 'physics', label: 'Physics (Adv)' },
  { id: 'chemistry', label: 'Chemistry' },
  { id: 'math', label: 'Math' },
];

const PHYSICS_CHAPTERS = [
  {
    id: 'ch12',
    name: 'Ch. 12: Rotational Mechanics',
    desc: 'Moment of Inertia, Torque Equilibria, Gyroscopic Motion',
    status: 'complete',
    progress: '8/8',
    topics: [
      { id: '12.1', name: 'Parallel & Perpendicular Axes Theorems', status: 'verified' },
      { id: '12.2', name: 'Angular Momentum & Fixed Axis Precession', status: 'verified' },
      { id: '12.3', name: 'Pure Rolling on Stepped Inclines', status: 'verified' },
    ],
  },
  {
    id: 'ch13',
    name: 'Ch. 13: Gravitation & Orbital Motion',
    desc: 'Central Forces, Keplerian Orbits, Escape Velocities',
    status: 'complete',
    progress: '6/6',
    topics: [
      { id: '13.1', name: 'Gravitational Potential of Extended Shells', status: 'verified' },
      { id: '13.2', name: 'Elliptical Orbit Energetics & Eccentricity', status: 'verified' },
    ],
  },
  {
    id: 'ch14',
    name: 'Ch. 14: Electromagnetic Induction & AC',
    desc: 'Time-varying fields, eddy fields, mutual coupling',
    status: 'active',
    progress: '6/10',
    faultCount: 2,
    topics: [
      { id: '14.1', name: 'Magnetic Flux & Faraday\'s Law', status: 'verified', meta: '96% · Spaced Retention: Normal' },
      { id: '14.2', name: 'Lenz\'s Law & Energy Balance', status: 'error', meta: 'EB-0421 · Requires Retest', tag: 'Active Vector' },
      { id: '14.3', name: 'Motional EMF & Eddy Dissipation', status: 'in_progress', meta: '2 Probes Attempted' },
      { id: '14.4', name: 'Self & Mutual Inductance Matrix', status: 'queued', meta: 'Scheduled Tomorrow' },
      { id: '14.5', name: 'AC Circuits: LCR Resonance & Q-Factor', status: 'locked', meta: 'Gated on Mastery of Node 14.4' },
    ],
  },
  {
    id: 'ch15',
    name: 'Ch. 15: Wave Optics & Interference',
    desc: 'Wavefront Coherence, Fresnel Diffraction',
    status: 'started',
    progress: '1/7',
    topics: [],
  },
];

const CONTEXT_CHAPTER = {
  corpus: 'CORE CORPUS',
  revision: 'REVISION TIER 2',
  weight: 'Weight: 8–12% in JEE Paper I/II',
  title: 'Electromagnetic Induction & Alternating Currents',
  quote: '"The dynamic generation of circulatory electromotive forces through non-conservative electric field curls, regulated by non-zero flux derivatives across open and closed topological boundaries."',
};

const PREREQUISITES = {
  prereq1: { name: 'Vector Calculus & Curl', source: 'Math Ch. 02 · Stokes\' Circulation', status: 'verified' },
  center: { name: 'Ch. 14: Induction & AC', desc: 'Faraday, Lenz, Maxwell-Ampere Bridge', flag: 'REQUIRES FOCUS' },
  unlock: { name: 'Maxwell\'s Wave Equations', source: 'Physics Ch. 16 · Displacement Current', status: 'locked' },
  lateral: { name: 'Ampère\'s Circuital Theorem (Ch. 11)', status: 'connected' },
};

const ERRORS = [
  { code: 'EB-0421', type: 'CONCEPTUAL SLIP', test: 'Test JEE-M-04', title: 'Incorrect sign inversion during Motional EMF closed loop integration', context: 'Lenz\'s law direction failure with perpendicular field shift' },
  { code: 'EB-0419', type: 'CALCULATION DRIFT', test: 'Spaced Probe #3', title: 'Mutual Inductance coefficient factor of 1/2 omitted', context: 'Concentric coplanar circular rings mutual flux calculation' },
];

const DIAGNOSTICS = [
  { name: 'Diagnostic Battery 01 (Foundational)', pct: 88, color: 'champagne' },
  { name: 'Diagnostic Battery 02 (Calculus & Fluctuation)', pct: 64, color: 'error' },
  { name: 'Timed Comprehensive Drill 03', pct: 70, color: 'sapphire' },
];

const FORMULAS = [
  { name: 'Maxwell-Faraday Formulation', expr: '∮ E · dl = − dΦ_B / dt', note: 'Induced electric field has non-zero circulation; conservative potential undefined.' },
  { name: 'LCR Quality Factor Factorization', expr: 'Q = (1/R) · √(L/C)', note: 'Sharpness of current resonance curve inversely proportional to resistive damping.' },
];

/* ─── Framer Motion variants ───────────────────────────────── */
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

/* ─── Icon helper ──────────────────────────────────────────── */
function iconSvg(name: string) {
  const icons: Record<string, string> = {
    account_tree: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
    verified: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    cycle: '<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    electric_bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    check_circle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    error_outline: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    schedule: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    lock_clock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/>',
    pending: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    chevron_right: '<polyline points="9 18 15 12 9 6"/>',
    menu_book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    add_task: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 10l2 2 4-4"/><path d="M6 2h12"/>',
    quiz: '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="12" r="10"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    bug_report: '<path d="M4 4h16v12H4z"/><path d="M4 16l4-8h8l4 8"/><line x1="8" y1="20" x2="8" y2="22"/><line x1="16" y1="20" x2="16" y2="22"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    ssid_chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    history: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 10"/>',
    arrow_forward: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    science: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
    calculate: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="14" x2="8" y2="18"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="8" y1="10" x2="16" y2="10"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    help_outline: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    done: '<polyline points="20 6 9 17 4 12"/>',
  };
  return icons[name] ?? '';
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
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
      dangerouslySetInnerHTML={{ __html: iconSvg(name) }}
    />
  );
}

/* ─── Sub-components ─────────────────────────────────────── */
function MetricCard({ metric }: { metric: typeof METRICS[0] }) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricTop}>
        <span className={styles.metricLabel}>{metric.label}</span>
        <span className={styles.metricIcon}>
          <Icon name={metric.icon} size={16} />
        </span>
      </div>
      <div>
        <span className={styles.metricValue}>{metric.value}</span>
        <span className={styles.metricMeta}> {metric.meta}</span>
      </div>
      {'pct' in metric && (
        <div className={styles.metricBar}>
          <div className={styles.metricBarFill} style={{ width: `${metric.pct}%` }} />
        </div>
      )}
    </div>
  );
}

/* ─── Component ──────────────────────────────────────────── */
export default function SyllabusPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openChapter, setOpenChapter] = useState<string | null>('ch14');
  const [selectedTopic, setSelectedTopic] = useState<string>('14.2');

  function toggleChapter(id: string) {
    setOpenChapter(openChapter === id ? null : id);
  }

  function pillClass(status: string) {
    const map: Record<string, string> = {
      complete: styles.pillComplete as string,
      active: styles.pillFaults as string,
      started: styles.pillStarted as string,
    };
    return map[status] ?? '';
  }

  function topicIconClass(status: string) {
    const map: Record<string, string> = {
      verified: styles.topicActiveIcon as string,
      error: styles.topicErrorIcon as string,
      in_progress: styles.topicProgressIcon as string,
      queued: styles.topicQueuedIcon as string,
      locked: styles.topicLockedIcon as string,
    };
    return map[status] ?? '';
  }

  function fillClass(color: string) {
    const map: Record<string, string> = {
      champagne: styles.fillChampagne as string,
      error: styles.fillError as string,
      sapphire: styles.fillSapphire as string,
    };
    return map[color] ?? '';
  }

  function tagClass(status: string) {
    const map: Record<string, string> = {
      verified: styles.tagVerified as string,
      error: styles.tagActive as string,
      in_progress: styles.tagInProgress as string,
      queued: styles.tagQueued as string,
    };
    return map[status] ?? '';
  }

  const activeChapter = PHYSICS_CHAPTERS.find((c) => c.id === 'ch14')!;

  return (
    <motion.div
      className={styles.page}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* ── Editorial Header ── */}
      <motion.div className={styles.editorialHeader} variants={item}>
        <div className={styles.headerTop}>
          <div className={styles.headerLeft}>
            <div className={styles.headerEyebrow}>
              <span>Corpus Curriculum</span>
              <span>{'//'}</span>
              <span>Diagnostic Master Map</span>
            </div>
            <h1 className={styles.title}>Syllabus Knowledge Atlas</h1>
            <p className={styles.subtitle}>
              Hierarchical prerequisite lattices across Physics, Chemistry, and Mathematics. Every node tracks empirical diagnostic mastery, decay curves, and active error vectors.
            </p>
          </div>
          <div className={styles.controlsRow}>
            <div className={styles.searchBox}>
              <span className={styles.searchIcon}><Icon name="search" size={14} /></span>
              <input
                className={styles.searchInput}
                placeholder="Search concepts, error codes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className={styles.filterTabs}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`${styles.filterTab} ${activeFilter === f.id ? styles.filterTabActive : ''}`}
                  onClick={() => setActiveFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Metrics Ribbon ── */}
      <motion.div className={styles.metricsRibbon} variants={item}>
        {METRICS.map((m) => (
          <MetricCard key={m.label} metric={m} />
        ))}
      </motion.div>

      {/* ── Operating Matrix ── */}
      <div className={styles.operatingMatrix}>
        {/* LEFT: Discipline Lattice */}
        <motion.div className={styles.leftPane} variants={item}>
          <div className={styles.latticeHeader}>
            <div className={styles.latticeLabel}>
              <span className={styles.latticeLabelText}>Discipline Lattice</span>
              <span className={styles.badgeTier}>JEE ADVANCED</span>
            </div>
            <button className={styles.expandAllBtn} onClick={() => setOpenChapter(null)}>
              Expand All Nodes
            </button>
          </div>

          <div className={styles.physicsTree}>
            {/* Subject header */}
            <div className={styles.subjectHeader}>
              <div className={styles.subjectLeft}>
                <span className={styles.subjectIcon}><Icon name="electric_bolt" size={18} /></span>
                <span className={styles.subjectTitle}>Physics: Field & Particle Dynamics</span>
              </div>
              <span className={styles.subjectCount}>32 / 44 Nodes</span>
            </div>

            {/* Chapters */}
            {PHYSICS_CHAPTERS.map((chapter) => {
              const isOpen = openChapter === chapter.id;
              const isActive = chapter.id === 'ch14';
              return (
                <div
                  key={chapter.id}
                  className={`${styles.chapterNode} ${isActive ? styles.chapterNodeActive : ''}`}
                >
                  <button className={styles.chapterToggle} onClick={() => toggleChapter(chapter.id)}>
                    <div className={styles.chapterToggleLeft}>
                      <span className={`${styles.chevronIcon} ${isOpen ? styles.chevronOpen : ''}`}>
                        <Icon name="chevron_right" size={16} />
                      </span>
                      <div className={styles.chapterInfo}>
                        <span className={styles.chapterName}>{chapter.name}</span>
                        <span className={styles.chapterDesc}>{chapter.desc}</span>
                      </div>
                    </div>
                    <div className={styles.chapterRight}>
                      {'faultCount' in chapter && chapter.faultCount ? (
                        <span className={`${styles.statusPill} ${styles.pillFaults}`}>
                          {chapter.faultCount} Faults
                        </span>
                      ) : (
                        <span className={`${styles.statusPill} ${pillClass(chapter.status)}`}>
                          {chapter.progress}
                        </span>
                      )}
                      {chapter.status === 'complete' && <span className={styles.dotComplete} />}
                    </div>
                  </button>

                  {isOpen && chapter.topics.length > 0 && (
                    <div className={styles.chapterTopics}>
                      {chapter.topics.map((topic) => (
                        <div
                          key={topic.id}
                          className={`${styles.topicItem} ${topic.status === 'error' ? styles.topicError : ''} ${topic.status === 'locked' ? styles.topicLocked : ''} ${selectedTopic === topic.id ? styles.topicActive : ''}`}
                          onClick={() => topic.status !== 'locked' && setSelectedTopic(topic.id)}
                        >
                          <div className={styles.topicLeft}>
                            <span className={`${styles.topicIcon} ${topicIconClass(topic.status)}`}>
                              {topic.status === 'verified' && <Icon name="check_circle" size={16} />}
                              {topic.status === 'error' && <Icon name="error_outline" size={16} />}
                              {topic.status === 'in_progress' && <Icon name="pending" size={16} />}
                              {topic.status === 'queued' && <Icon name="schedule" size={16} />}
                              {topic.status === 'locked' && <Icon name="lock" size={16} />}
                            </span>
                            <div className={styles.topicDetails}>
                              <span className={styles.topicName}>
                                {topic.id} {topic.name}
                              </span>
                              {'meta' in topic && (
                                <span className={styles.topicMeta}>{topic.meta}</span>
                              )}
                            </div>
                          </div>
                          <div className={styles.topicStatus}>
                            {topic.status !== 'locked' && (
                              <span className={`${styles.statusTag} ${tagClass(topic.status)}`}>
                                {topic.status === 'verified' ? 'Verified' :
                                 topic.status === 'error' ? ('tag' in topic ? topic.tag : 'Active Vector') :
                                 topic.status === 'in_progress' ? 'In Progress' :
                                 topic.status === 'queued' ? 'Queued' : ''}
                              </span>
                            )}
                            {topic.status === 'locked' && (
                              <Icon name="lock_clock" size={14} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Compact discipline cards */}
          <div className={styles.disciplineCards}>
            <div className={styles.disciplineCard}>
              <div className={styles.disciplineLeft}>
                <Icon name="science" size={16} />
                <span className={styles.disciplineName}>Physical Chemistry</span>
              </div>
              <span className={styles.disciplineCount}>54 / 72 Verified</span>
            </div>
            <div className={styles.disciplineCard}>
              <div className={styles.disciplineLeft}>
                <Icon name="calculate" size={16} />
                <span className={styles.disciplineName}>Mathematics: Advanced Calculus</span>
              </div>
              <span className={styles.disciplineCount}>56 / 92 Verified</span>
            </div>
          </div>
        </motion.div>

        {/* RIGHT: Chapter Workbench */}
        <motion.div className={styles.rightPane} variants={item}>
          {/* Chapter context */}
          <div className={styles.contextCard}>
            <div className={styles.contextCardInner}>
              <div className={styles.contextTags}>
                <span className={`${styles.contextTag} ${styles.tagCore}`}>{CONTEXT_CHAPTER.corpus}</span>
                <span className={`${styles.contextTag} ${styles.tagRevision}`}>{CONTEXT_CHAPTER.revision}</span>
                <span className={styles.contextWeight}>{CONTEXT_CHAPTER.weight}</span>
              </div>
              <h2 className={styles.contextTitle}>{CONTEXT_CHAPTER.title}</h2>
              <p className={styles.contextQuote}>{CONTEXT_CHAPTER.quote}</p>
              <div className={styles.actionButtons}>
                <button className={`${styles.actionBtn} ${styles.btnPrimary}`}>
                  <Icon name="add_task" size={12} />
                  Plan Study Session
                </button>
                <button className={`${styles.actionBtn} ${styles.btnSecondary}`}>
                  <Icon name="quiz" size={12} />
                  Generate Diagnostic Test
                </button>
                <button className={`${styles.actionBtn} ${styles.btnError}`}>
                  <Icon name="bug_report" size={12} />
                  View 2 Mistakes in Error Book
                </button>
              </div>
            </div>
          </div>

          {/* Prerequisite topology */}
          <div className={styles.topologyCard}>
            <div className={styles.topologyHeader}>
              <div className={styles.topologyTitle}>
                <Icon name="account_tree" size={14} />
                Prerequisite &amp; Succession Topology
              </div>
              <span className={styles.topologySubtitle}>Strict Axiomatic Ordering</span>
            </div>
            <div className={styles.topologyGrid}>
              <div className={styles.prereqCard}>
                <div className={styles.prereqLabel}>
                  <span>Prerequisite 01</span>
                  <Icon name="verified" size={12} />
                </div>
                <div className={styles.prereqName}>{PREREQUISITES.prereq1.name}</div>
                <div className={styles.prereqSource}>{PREREQUISITES.prereq1.source}</div>
                <div className={styles.prereqStatus}>{PREREQUISITES.prereq1.status.toUpperCase()} (98%)</div>
              </div>

              <div className={styles.centerNode}>
                <div className={styles.centerNodeLabel}>
                  <span>Current Study Pivot</span>
                  <span className={styles.centerNodeDot} />
                </div>
                <div className={styles.centerNodeName}>{PREREQUISITES.center.name}</div>
                <div className={styles.centerNodeDesc}>{PREREQUISITES.center.desc}</div>
                <div className={styles.centerNodeTag}>{PREREQUISITES.center.flag}</div>
              </div>

              <div className={styles.prereqCard}>
                <div className={styles.prereqLabel}>
                  <span>Unlocks Future</span>
                  <Icon name="lock" size={12} />
                </div>
                <div className={styles.prereqName}>{PREREQUISITES.unlock.name}</div>
                <div className={styles.prereqSource}>{PREREQUISITES.unlock.source}</div>
                <div className={`${styles.prereqStatus} ${styles.prereqStatusLocked}`}>
                  LOCKED UNTIL CH.14 COMPLETE
                </div>
              </div>
            </div>

            <div className={styles.connectorCard} style={{ marginTop: 'var(--kd-space-sm)' }}>
              <div className={styles.connectorLabel}>
                <Icon name="link" size={12} />
                <span>Secondary Lateral Link: <strong>{PREREQUISITES.lateral.name}</strong></span>
              </div>
              <span className={`${styles.connectorStatus} ${styles.connectorStatus}`}>
                {PREREQUISITES.lateral.status === 'connected' ? 'Connected & Audited ✓' : ''}
              </span>
            </div>
          </div>

          {/* Evidence deck */}
          <div className={styles.evidenceDeck}>
            {/* Error vectors */}
            <div className={styles.evidenceCard}>
              <div className={styles.evidenceHeader}>
                <div className={styles.evidenceTitle}>
                  <Icon name="warning" size={18} />
                  <span className={styles.evidenceTitleText}>Active Error Vectors</span>
                </div>
                <span className={`${styles.evidenceTag} ${styles.tagActive}`} style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--kd-error)' }}>
                  2 CRITICAL
                </span>
              </div>
              <p className={styles.evidenceDesc}>
                Targeted anomalies registered from recent simulated diagnostics. Resolving these unlocks subsequent calculus pathways.
              </p>
              <div className={styles.errorList}>
                {ERRORS.map((e) => (
                  <div key={e.code} className={styles.errorItem}>
                    <div className={styles.errorMeta}>
                      <span className={styles.errorCode}>{e.code} &middot; {e.type}</span>
                      <span className={styles.errorTest}>{e.test}</span>
                    </div>
                    <span className={styles.errorTitle}>{e.title}</span>
                    <span className={styles.errorContext}>{e.context}</span>
                  </div>
                ))}
              </div>
              <a href="/errors" className={styles.errorBookLink}>
                <span>Open Error Book Diagnostic Ledger</span>
                <Icon name="arrow_forward" size={12} />
              </a>
            </div>

            {/* Diagnostic history */}
            <div className={styles.evidenceCard}>
              <div className={styles.evidenceHeader}>
                <div className={styles.evidenceTitle}>
                  <Icon name="ssid_chart" size={18} />
                  <span className={styles.evidenceTitleText}>Diagnostic History</span>
                </div>
                <span style={{ fontFamily: 'var(--kd-font-mono)', fontSize: '10px', color: 'var(--kd-champagne)' }}>
                  3 Probes Recorded
                </span>
              </div>
              <p className={styles.evidenceDesc}>
                Current chapter performance index is at <strong style={{ color: 'var(--kd-champagne)' }}>74.0%</strong>. Next scheduled Ebbinghaus consolidation cycle: in 28 hours.
              </p>
              <div className={styles.diagnosticList}>
                {DIAGNOSTICS.map((d) => (
                  <div key={d.name} className={styles.diagnosticItem}>
                    <div className={styles.diagnosticRow}>
                      <span className={styles.diagnosticName}>{d.name}</span>
                      <span className={styles.diagnosticPct} style={{ color: d.color === 'error' ? 'var(--kd-error)' : d.color === 'champagne' ? 'var(--kd-champagne)' : 'var(--kd-sapphire)' }}>
                        {d.pct}%
                      </span>
                    </div>
                    <div className={styles.diagnosticBar}>
                      <div className={`${styles.diagnosticFill} ${fillClass(d.color)}`} style={{ width: `${d.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.diagnosticFooter}>
                <div className={styles.diagnosticLast}>
                  <Icon name="history" size={12} />
                  <span>Last Evaluated: 12 Nov, 18:30</span>
                </div>
                <span className={styles.diagnosticDue}>4 Probes Due</span>
              </div>
            </div>
          </div>

          {/* Formula compendium */}
          <div className={styles.formulaCompendium}>
            <div className={styles.formulaHeader}>
              <div className={styles.formulaTitle}>
                <Icon name="menu_book" size={16} />
                Standard Formulation Footnotes
              </div>
              <span style={{ fontFamily: 'var(--kd-font-mono)', fontSize: '10px', color: 'var(--kd-champagne)', opacity: 0.8 }}>
                Canonical Standard
              </span>
            </div>
            <div className={styles.formulaGrid}>
              {FORMULAS.map((f) => (
                <div key={f.name} className={styles.formulaCard}>
                  <div className={styles.formulaName}>{f.name}</div>
                  <div className={styles.formulaExpression}>{f.expr}</div>
                  <div className={styles.formulaNote}>{f.note}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
