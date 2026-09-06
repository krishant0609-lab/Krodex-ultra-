'use client';
import React from 'react';
import { motion, type Variants } from 'framer-motion';
import styles from './dashboard.module.css';

/* ─── Static data ─────────────────────────────────────────── */
const CYCLE_DAY = 'CYCLE 14 \xb7 DAY 3';
const GREETING = 'A fresh morning to consolidate';
const PRIORITY_COUNT = 5;
const PRIORITY_LABEL = 'priority items';

const STUDY_BLOCKS = [
  {
    status: 'completed',
    label: 'Completed',
    items: [
      { time: '07:00', subject: 'Quantum Mechanics \xa72', tag: 'physics' },
      { time: '07:48', subject: 'Organic Synthesis', tag: 'chemistry' },
    ],
  },
  {
    status: 'in_progress',
    label: 'In Progress',
    items: [
      { time: '09:00', subject: 'Electromagnetism \xa74', tag: 'physics' },
      { time: '09:40', subject: 'Thermodynamics Review', tag: 'chemistry' },
    ],
  },
  {
    status: 'due_today',
    label: 'Due Today',
    items: [
      { time: '14:00', subject: 'Fluid Dynamics Quiz', tag: 'physics' },
      { time: '16:30', subject: 'Inorganic Chemistry', tag: 'chemistry' },
    ],
  },
  {
    status: 'planned',
    label: 'Planned',
    items: [
      { time: 'Tomorrow', subject: 'Linear Algebra \xa76', tag: 'mathematics' },
      { time: 'Sep 8', subject: 'Biochemistry Review', tag: 'biology' },
    ],
  },
];

const LOOP_STEPS = [
  { label: 'Ingest', active: false },
  { label: 'Diagnose', active: true },
  { label: 'Log Error', active: false },
  { label: 'Spaced 48h', active: false },
  { label: 'Retest', active: false },
];

const COGNITIVE_FOCUS = {
  subject: 'Quantum Mechanics',
  timer: '25:00',
};

const STATS_MINI = [
  { value: '47', label: 'Topics Mastered', color: 'emerald' },
  { value: '94%', label: 'Error Resolution', color: 'champagne' },
  { value: '8', label: 'Reviews Due', color: 'sapphire' },
  { value: '6', label: 'Active Nodes', color: 'lavender' },
];

const UPCOMING_REVIEWS = [
  { label: 'Thermodynamics \xa73', due: 'Today, 14:00', priority: 'high' },
  { label: 'Electromagnetism \xa74', due: 'Tomorrow, 09:00', priority: 'medium' },
  { label: 'Wave Mechanics', due: 'Sep 10, 11:00', priority: 'low' },
  { label: 'Organic Chemistry', due: 'Sep 11, 10:00', priority: 'synced' },
];

const RECENT_ERRORS = [
  { id: 'EB-948', topic: 'Lenz’s Law', age: '2d', open: true },
  { id: 'EB-947', topic: 'Gauss’s Theorem', age: '5d', open: false },
  { id: 'EB-946', topic: 'Capacitance', age: '1w', open: false },
  { id: 'EB-945', topic: 'Wave Interference', age: '1w', open: false },
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

function badgeClass(status: string) {
  const map: Record<string, string> = {
    completed: styles.badgeCompleted as string,
    in_progress: styles.badgeInProgress as string,
    due_today: styles.badgeDueToday as string,
    planned: styles.badgePlanned as string,
  };
  return map[status] ?? '';
}

function tagClass(tag: string) {
  const map: Record<string, string> = {
    physics: styles.tagPhysics as string,
    chemistry: styles.tagChemistry as string,
    mathematics: styles.tagMathematics as string,
    biology: styles.tagBiology as string,
  };
  return map[tag] ?? '';
}

function priorityClass(p: string) {
  const map: Record<string, string> = {
    high: styles.pillHigh as string,
    medium: styles.pillMedium as string,
    low: styles.pillLow as string,
    synced: styles.pillSynced as string,
  };
  return map[p] ?? '';
}

/* ─── Component ──────────────────────────────────────────── */
export default function DashboardPage() {
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
            <span className={styles.cycleTag}>{CYCLE_DAY}</span>
          </div>
          <h1 className={styles.greeting}>{GREETING}</h1>
          <p className={styles.priorityItems}>
            <span className={styles.priorityCount}>{PRIORITY_COUNT}</span>{' '}
            {PRIORITY_LABEL} awaiting your command.
          </p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.syncBadge}>
            <div className={styles.syncDot} />
            <span className={styles.syncText}>System Synced \xb7 48h Spaced Loop Active</span>
          </div>
        </div>
      </motion.div>

      {/* ── Main operating matrix ── */}
      <div className={styles.operatingMatrix}>
        {/* Left: study blocks */}
        <motion.div className={styles.studySection} variants={item}>
          <p className={styles.studySectionTitle}>Today&apos;s Operating Matrix</p>
          <div className={styles.blocksGrid}>
            {STUDY_BLOCKS.map((block) => (
              <motion.div key={block.status} className={styles.block} variants={item}>
                <div className={styles.blockHeader}>
                  <h3 className={styles.blockTitle}>{block.label}</h3>
                  <span className={`${styles.blockBadge} ${badgeClass(block.status)}`}>
                    {block.items.length}
                  </span>
                </div>
                <div className={styles.blockItems}>
                  {block.items.map((it) => (
                    <div key={it.subject} className={styles.blockItem}>
                      <span className={styles.itemTime}>{it.time}</span>
                      <span className={styles.itemSubject}>{it.subject}</span>
                      <span className={`${styles.itemTag} ${tagClass(it.tag)}`}>
                        {it.tag}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Right: telemetry */}
        <motion.div className={styles.telemetrySection} variants={item}>
          {/* Cognitive Focus */}
          <div className={styles.telemetryCard}>
            <div className={styles.focusBanner}>
              <div className={styles.focusIcon}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className={styles.focusInfo}>
                <div className={styles.focusLabel}>Active Cognitive Focus</div>
                <div className={styles.focusTimer}>{COGNITIVE_FOCUS.timer}</div>
              </div>
              <button className={styles.focusBtn}>Start</button>
            </div>
            <div className={styles.statsGrid}>
              {STATS_MINI.map((s) => (
                <div key={s.label} className={styles.statMini}>
                  <div
                    className={styles.statMiniValue}
                    style={{ color: `var(--kd-${s.color})` }}
                  >
                    {s.value}
                  </div>
                  <div className={styles.statMiniLabel}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Spaced Reinforcement Loop */}
          <div className={styles.loopCard}>
            <h3 className={styles.loopTitle}>Spaced Reinforcement Loop</h3>
            <div className={styles.loopCircuit}>
              {LOOP_STEPS.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div className={styles.loopStep}>
                    <div
                      className={`${styles.loopNode} ${step.active ? styles.loopNodeActive : ''}`}
                    >
                      {i + 1}
                    </div>
                    <span className={styles.loopLabel}>{step.label}</span>
                  </div>
                  {i < LOOP_STEPS.length - 1 && (
                    <div className={styles.loopArrow}>&#8594;</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Upcoming Reviews */}
          <div className={styles.telemetryCard}>
            <h3 className={styles.telemetryCardTitle}>Upcoming Reviews</h3>
            <div className={styles.reviewList}>
              {UPCOMING_REVIEWS.map((r) => (
                <div key={r.label} className={styles.reviewItem}>
                  <div className={styles.reviewItemLeft}>
                    <span className={styles.reviewLabel}>{r.label}</span>
                    <span className={styles.reviewDue}>{r.due}</span>
                  </div>
                  <span className={`${styles.reviewPill} ${priorityClass(r.priority)}`}>
                    {r.priority === 'synced' ? 'synced' : r.priority}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Errors */}
          <div className={styles.telemetryCard}>
            <h3 className={styles.telemetryCardTitle}>Recent Errors</h3>
            <div className={styles.errorList}>
              {RECENT_ERRORS.map((e) => (
                <div key={e.id} className={styles.errorItem}>
                  <span className={styles.errorCode}>{e.id}</span>
                  <span className={styles.errorTopic}>{e.topic}</span>
                  <div className={styles.errorMeta}>
                    <span className={`${styles.reviewPill} ${e.open ? styles.pillHigh : styles.pillSynced}`}>
                      {e.open ? 'open' : 'ok'}
                    </span>
                    <span className={styles.errorAge}>{e.age}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
