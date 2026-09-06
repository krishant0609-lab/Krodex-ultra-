'use client';
import React from 'react';
import { motion, type Variants } from 'framer-motion';
import styles from './planner.module.css';

/* ─── Static data ─────────────────────────────────────────── */
const CURRENT_DATE = 'Friday, Nov 15, 2024';
const EYE_BROW = 'Engine \xb7 Spaced Equilibrium Model';
const ZERO_GUILT_ACTIVE = true;

const SEGMENT_TABS = [
  { label: 'Day Timeline', badge: 'Nov 15', active: true },
  { label: 'Week Distribution', badge: 'Nov 15–21', active: false },
  { label: 'Recovery Buffer', badge: '1 Auto-Routed', active: false },
];

const SEGMENT_STATUS = 'Fluid Recalibration';
const TARGET = '330m';

const ZG_BANNER = {
  source: 'Yesterday // Ch. 11 Thermodynamics',
  subject: 'Thermodynamics: Heat Engines',
  duration: '45m',
  message: '1 session missed yesterday',
  detail:
    'System autonomously routed this block into Saturday morning’s open 90m buffer. Zero penalty recorded in velocity index.',
};

const TIMELINE_BLOCKS = [
  {
    id: 'TB-01',
    status: 'completed',
    timeStart: '08:00',
    timeEnd: '09:30',
    subject: 'Physics',
    chapter: 'Ch. 14 Electromagnetic Induction',
    title: 'Lenz’s Law & Induced EMF Derivations',
    desc: 'Rigorous calculation of circular loop flux changes with time-varying fields. Evaluated induced electric fields in non-conducting loops.',
    elapsed: '90m',
    errors: 2,
    retention: null,
    note: 'Review self-inductance geometric approximations before next block.',
    sessionStart: null,
    progress: null,
    items: null,
  },
  {
    id: 'TB-02',
    status: 'completed',
    timeStart: '10:00',
    timeEnd: '11:30',
    subject: 'Chemistry',
    chapter: 'Inorganic Ch. 09',
    title: 'Coordination Compounds & Crystal Field Theory',
    desc: 'Octahedral splitting energy (Δ₀), Jahn-Teller effect subtleties, and spectrochemical series retention drills.',
    elapsed: '85m',
    errors: null,
    retention: 'Clean retention',
    note: null,
    sessionStart: null,
    progress: null,
    items: null,
  },
  {
    id: 'TB-03',
    status: 'in_progress',
    timeStart: '13:30',
    timeEnd: '15:00',
    subject: 'Mathematics',
    chapter: 'Calculus Core Ch. 04',
    title: 'Definite Integrals: Leibniz Rule Applications',
    desc: 'Differentiation under the integral sign with variable limit parameters. Target set: Advanced practice set #3 (25 analytical problems).',
    elapsed: null,
    errors: null,
    retention: null,
    note: 'Cognitive state: Deep Analytical. Distraction dampening engaged.',
    sessionStart: '13:31',
    progress: 46,
    items: '11 of 25 items resolved',
    elapsedOf: '42m elapsed of 90m',
  },
  {
    id: 'TB-04',
    status: 'scheduled',
    timeStart: '15:30',
    timeEnd: '16:30',
    subject: 'Spaced Loop Engine',
    chapter: 'Error Book Autopsy',
    title: 'Electrostatics & Rotation Error Autopsy',
    desc: 'Scheduled retrieval rehearsal for 2 overdue concept errors. High priority recall before Friday diagnostic session.',
    elapsed: null,
    errors: null,
    retention: null,
    note: null,
    sessionStart: null,
    progress: null,
    items: null,
    tags: ['#EB-0420 Potential Barrier Dipoles', '#EB-0418 Pure Rolling Moment Instabilities'],
  },
  {
    id: 'TB-05',
    status: 'planned',
    timeStart: '17:00',
    timeEnd: '18:30',
    subject: 'Diagnostic Test',
    chapter: 'Timed Examination Condition',
    title: 'JEE Advanced Mock Probe 04: Full Section A',
    desc: 'Full sprint test environment. Real-time timer adherence. Requires desktop workspace clearance.',
    elapsed: null,
    errors: null,
    retention: null,
    note: null,
    sessionStart: null,
    progress: null,
    items: null,
    accuracyTarget: '>78% Accuracy',
  },
];

const CAPACITY = {
  max: '7.0h',
  planned: '5.5h',
  completed: '2.8h',
  buffer: '1.5h',
  plannedMin: 330,
  completedMin: 170,
  gaugeCompleted: 51,
  gaugeRemaining: 28,
  gaugeBuffer: 21,
  burnoutRisk: '12% (Minimal)',
  sleepProt: 'Verified',
};

const RECOVERY_BUFFER = {
  staging: 1,
  task: 'Thermodynamics: Carnot Efficiency & Clausius Inequality',
  effort: '45 min effort',
  reason: 'College laboratory session ran 50m over schedule yesterday.',
  recommendation: 'Saturday Morning Recovery',
};

/* ─── Framer Motion variants ───────────────────────────────── */
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

/* ─── Helpers ─────────────────────────────────────────────── */
function subjectClass(tag: string) {
  const map: Record<string, string> = {
    Physics: styles.tagPhysics as string,
    Chemistry: styles.tagChemistry as string,
    Mathematics: styles.tagMathematics as string,
    'Spaced Loop Engine': styles.tagSpaced as string,
    'Diagnostic Test': styles.tagDiagnostic as string,
  };
  return map[tag] ?? (styles.tagPhysics as string);
}

function statusPillClass(status: string) {
  const map: Record<string, string> = {
    completed: styles.pillCompleted as string,
    in_progress: styles.pillInProgress as string,
    scheduled: styles.pillScheduled as string,
    planned: styles.pillPlanned as string,
  };
  return map[status] ?? (styles.pillPlanned as string);
}

function statusLabel(status: string, extra?: string | null) {
  if (status === 'completed') return 'Completed';
  if (status === 'in_progress') return 'In Focus // Mathematics';
  if (status === 'scheduled') return `Scheduled Next (${extra ?? '60m'})`;
  if (status === 'planned') return `Planned (${extra ?? '90m'})`;
  return status;
}

/* ─── Sub-components ──────────────────────────────────────── */
function SegmentNav() {
  return (
    <div className={styles.segmentNav}>
      <div className={styles.segmentTabs}>
        {SEGMENT_TABS.map((tab) => (
          <button
            key={tab.label}
            className={`${styles.segmentTab} ${tab.active ? styles.segmentTabActive : ''}`}
          >
            <span>{tab.label}</span>
            <span className={styles.tabBadge}>{tab.badge}</span>
          </button>
        ))}
      </div>
      <div className={styles.segmentStatus}>
        <span className={styles.statusDot} />
        <span>{SEGMENT_STATUS}</span>
        <span>•</span>
        <span>Target: {TARGET}</span>
      </div>
    </div>
  );
}

function ZeroGuiltBanner() {
  return (
    <div className={styles.zeroGuiltBanner}>
      <div className={styles.bannerIcon}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="15" />
          <line x1="15" y1="9" x2="9" y2="15" />
        </svg>
      </div>
      <div className={styles.bannerContent}>
        <div className={styles.bannerTopRow}>
          <span className={styles.bannerTitle}>Zero-Guilt Redistribution Notice</span>
          <span className={styles.bannerSource}>{ZG_BANNER.source}</span>
        </div>
        <p className={styles.bannerMessage}>
          {ZG_BANNER.message}{' '}
          <span style={{ color: 'var(--kd-text-muted)', fontWeight: 400 }}>
            ({ZG_BANNER.subject}, {ZG_BANNER.duration})
          </span>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <p className={styles.bannerMessageSub}>{ZG_BANNER.detail}</p>
          <div className={styles.bannerActions}>
            <button className={styles.bannerAction}>View Buffer Slot</button>
            <button className={styles.bannerDismiss}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeBlock({ block }: { block: typeof TIMELINE_BLOCKS[0] }) {
  const isActive = block.status === 'in_progress';
  const isCompleted = block.status === 'completed';

  return (
    <motion.div
      className={`${styles.timeBlock} ${isActive ? styles.timeBlockActive : ''}`}
      variants={item}
    >
      <div className={styles.blockHeader}>
        <div className={styles.blockHeaderLeft}>
          <div className={`${styles.timeSlot} ${isActive ? styles.timeSlotActive : ''}`}>
            <span className={styles.timeSlotTime}>{block.timeStart}</span>
            <span className={styles.timeSlotLabel}>to</span>
            <span className={styles.timeSlotTime}>{block.timeEnd}</span>
            {isActive && <span className={styles.timeSlotLabel} style={{ color: 'var(--kd-champagne)', fontWeight: 700 }}>NOW</span>}
          </div>
          <div className={styles.blockInfo}>
            <div className={styles.blockMeta}>
              <span className={`${styles.subjectTag} ${subjectClass(block.subject)}`}>
                {block.subject}
              </span>
              <span className={styles.chapterLabel}>{block.chapter}</span>
            </div>
            <h2 className={styles.blockTitle}>{block.title}</h2>
            <p className={styles.blockDesc}>{block.desc}</p>
            {block.tags && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                {block.tags.map((t) => (
                  <span key={t} style={{
                    fontFamily: 'var(--kd-font-mono)',
                    fontSize: '10px',
                    color: '#CBD5E1',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(9, 13, 22, 0.8)',
                    border: '1px solid rgba(30, 41, 59, 1)',
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className={styles.blockHeaderRight}>
          <span className={`${styles.statusPill} ${statusPillClass(block.status)}`}>
            {isCompleted && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {statusLabel(block.status, block.status === 'scheduled' ? '60m' : block.status === 'planned' ? '90m' : undefined)}
          </span>
          {isCompleted && (
            <div className={styles.blockMetaRow}>
              <span>{block.elapsed} elapsed</span>
              <span className={styles.metaDot} />
              <span className={styles.errorCount}>{block.errors} errors logged</span>
            </div>
          )}
          {block.status === 'scheduled' && (
            <button style={{
              fontFamily: 'var(--kd-font-mono)',
              fontSize: '10px',
              color: 'var(--kd-sapphire)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}>
              Adjust Window
            </button>
          )}
          {block.status === 'planned' && block.accuracyTarget && (
            <span style={{ fontFamily: 'var(--kd-font-mono)', fontSize: '10px', color: 'var(--kd-text-muted)' }}>
              Target: {block.accuracyTarget}
            </span>
          )}
        </div>
      </div>

      {/* Active block: progress tracker + actions */}
      {isActive && block.progress != null && (
        <>
          <div className={styles.progressTracker}>
            <div className={styles.progressRow}>
              <span className={styles.progressActive}>
                <span className={styles.progressActiveDot} />
                Active Timer: {block.elapsedOf}
              </span>
              <span className={styles.progressItems}>{block.items}</span>
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${block.progress}%` }} />
            </div>
          </div>
          <div className={styles.blockActions}>
            <button className={styles.actionBtn}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
              Pause
            </button>
            <button className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Conclude
            </button>
          </div>
          {block.note && (
            <div className={styles.sessionNote}>
              <div className={styles.noteContent}>
                <svg className={styles.noteIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a4 4 0 1 1 4-4" />
                </svg>
                <span>{block.note}</span>
              </div>
              <button className={styles.noteLink}>Log Mid-Session Blocker +</button>
            </div>
          )}
        </>
      )}

      {/* Completed block: post-session note */}
      {isCompleted && block.note && (
        <div className={styles.sessionNote}>
          <div className={styles.noteContent}>
            <svg className={styles.noteIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>{block.note}</span>
          </div>
          <button className={styles.noteLink}>Inspect Error Logs</button>
        </div>
      )}
    </motion.div>
  );
}

function CapacityCard() {
  return (
    <div className={styles.telemetryCard}>
      <div className={styles.telemetryCardTitle}>
        <div className={styles.telemetryCardTitleText}>
          <svg className={styles.telemetryCardTitleIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Today&apos;s Capacity
        </div>
        <span className={styles.telemetryCardSub}>Max: {CAPACITY.max}</span>
      </div>
      <div className={styles.metricsGrid}>
        <div className={styles.metricCell}>
          <span className={styles.metricLabel}>Planned</span>
          <span className={styles.metricValue}>{CAPACITY.planned}</span>
          <span className={styles.metricUnit}>{CAPACITY.plannedMin} min</span>
        </div>
        <div className={styles.metricCell}>
          <span className={styles.metricLabel}>Completed</span>
          <span className={styles.metricValue} style={{ color: 'var(--kd-sapphire)' }}>{CAPACITY.completed}</span>
          <span className={styles.metricUnit}>{CAPACITY.completedMin} min</span>
        </div>
        <div className={styles.metricCell}>
          <span className={styles.metricLabel}>Buffer</span>
          <span className={styles.metricValue} style={{ color: 'var(--kd-champagne)' }}>{CAPACITY.buffer}</span>
          <span className={styles.metricUnit}>Slack space</span>
        </div>
      </div>
      <div className={styles.gaugeSection}>
        <div className={styles.gaugeHeader}>
          <span className={styles.gaugeLabel}>Workload Pressure</span>
          <span className={styles.gaugeBadge}>Balanced // Low Entropy</span>
        </div>
        <div className={styles.gauge}>
          <div className={`${styles.gaugeFill} ${styles.gaugeCompleted}`} style={{ width: `${CAPACITY.gaugeCompleted}%` }} />
          <div className={`${styles.gaugeFill} ${styles.gaugeRemaining}`} style={{ width: `${CAPACITY.gaugeRemaining}%` }} />
          <div className={`${styles.gaugeFill} ${styles.gaugeBuffer}`} style={{ width: `${CAPACITY.gaugeBuffer}%` }} />
        </div>
        <div className={styles.gaugeFooter}>
          <span className={styles.burnoutRisk}>Burnout Risk: {CAPACITY.burnoutRisk}</span>
          <span className={styles.sleepProt}>Sleep Protection: {CAPACITY.sleepProt}</span>
        </div>
      </div>
    </div>
  );
}

function RecoveryBufferCard() {
  return (
    <div className={styles.telemetryCard}>
      <div className={styles.bufferCardTitle}>
        <div className={styles.bufferCardTitleLeft}>
          <svg className={styles.bufferCardTitleIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          Zero-Guilt Buffer
        </div>
        <span className={styles.bufferBadge}>{RECOVERY_BUFFER.staging} Task in Staging</span>
      </div>
      <div className={styles.bufferDossier}>
        <div className={styles.bufferDossierHeader}>
          <span className={styles.bufferDossierLabel}>Autonomous Reassignment</span>
          <span className={styles.bufferDossierEffort}>{RECOVERY_BUFFER.effort}</span>
        </div>
        <h4 className={styles.bufferDossierTitle}>{RECOVERY_BUFFER.task}</h4>
        <div className={styles.bufferDossierNote}>
          <svg className={styles.bufferNoteIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Unscheduled reason: {RECOVERY_BUFFER.reason}</span>
        </div>
      </div>
      <div className={styles.bufferRecommendation}>
        <svg className={styles.recIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span>Recommendation: {RECOVERY_BUFFER.recommendation}</span>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────── */
export default function PlannerPage() {
  return (
    <motion.div
      className={styles.page}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Editorial header */}
      <motion.div variants={item}>
        <div className={styles.editorialHeader}>
          <div className={styles.headerTop}>
            <div className={styles.headerLeft}>
              <div className={styles.headerEyebrow}>
                <span className={styles.eyebrowDot} />
                <span>{EYE_BROW}</span>
                <span>•</span>
                <span style={{ color: 'var(--kd-champagne)' }}>Zero-Guilt Protocol Active</span>
              </div>
              <h1 className={styles.headerTitle}>Responsive Study Planner</h1>
              <p className={styles.headerDesc}>
                Adaptive scheduling grounded in actual cognitive capacity. Missed study blocks roll
                seamlessly into intelligent recovery buffers with zero moralizing guilt or compounding fatigue.
              </p>
            </div>
            <div className={styles.headerActions}>
              <div className={styles.dateNav}>
                <button className={styles.dateNavBtn}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className={styles.dateLabel}>{CURRENT_DATE}</span>
                <button className={styles.dateNavBtn}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
              <button className={styles.scheduleBtn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Schedule Block
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Segment nav */}
      <motion.div variants={item}>
        <SegmentNav />
      </motion.div>

      {/* Operating matrix */}
      <div className={styles.operatingMatrix}>
        {/* Left: timeline */}
        <motion.div variants={item}>
          {/* Zero-Guilt banner */}
          <motion.div variants={item} style={{ marginBottom: 'var(--kd-space-5)' }}>
            <ZeroGuiltBanner />
          </motion.div>

          {/* Timeline blocks */}
          <div className={styles.timeline}>
            {TIMELINE_BLOCKS.map((block, i) => (
              <React.Fragment key={block.id}>
                {i === 2 && (
                  <div className={styles.breakBuffer}>
                    <div className={styles.breakLine} />
                    <span className={styles.breakLabel}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
                      </svg>
                      Rest &amp; Digestion Buffer // 120m
                    </span>
                    <div className={styles.breakLine} />
                  </div>
                )}
                <TimeBlock block={block} />
              </React.Fragment>
            ))}
          </div>

          {/* Quick log strip */}
          <motion.div variants={item} style={{ marginTop: 'var(--kd-space-4)' }}>
            <div className={styles.quickLog}>
              <div className={styles.quickLogContent}>
                <svg className={styles.quickLogIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Finished an unscripted study sprint? Record ad-hoc work into today&apos;s ledger.</span>
              </div>
              <button className={styles.quickLogBtn}>+ Log Quick Effort</button>
            </div>
          </motion.div>
        </motion.div>

        {/* Right: telemetry sidebar */}
        <motion.div className={styles.telemetrySection} variants={item}>
          <CapacityCard />
          <RecoveryBufferCard />
        </motion.div>
      </div>
    </motion.div>
  );
}
