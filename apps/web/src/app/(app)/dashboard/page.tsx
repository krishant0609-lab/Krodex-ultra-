'use client';
import React from 'react';
import { motion } from 'framer-motion';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './dashboard.module.css';

const STATS = [
  { label: 'Topics Mastered', value: '47', delta: '+3 this week', color: 'emerald' },
  { label: 'Error Resolution', value: '94.2%', delta: '↑ 2.1%', color: 'champagne' },
  { label: 'Reviews Due Today', value: '8', delta: 'Next in 2h', color: 'sapphire' },
  { label: 'Active Nodes', value: '6', delta: 'All synced', color: 'lavender' },
];

const RECENT_ERRORS = [
  { id: 'EB-948', topic: 'Lenz\'s Law', fault: 'Sign Inversion', resolved: false, age: '2d' },
  { id: 'EB-947', topic: 'Gauss\'s Theorem', fault: 'Boundary Condition', resolved: true, age: '5d' },
  { id: 'EB-946', topic: 'Capacitance', fault: 'Unit Error', resolved: true, age: '1w' },
];

const UPCOMING_REVIEWS = [
  { label: 'Thermodynamics §3', due: 'Today, 14:00', priority: 'high' },
  { label: 'Electromagnetism §4', due: 'Tomorrow, 09:00', priority: 'medium' },
  { label: 'Wave Mechanics', due: 'Sep 10, 11:00', priority: 'low' },
];

export default function DashboardPage() {
  return (
    <div className={styles.page}>
      <div className={styles.grid}>
        {STATS.map((s) => (
          <Surface key={s.label} variant="ink" className={styles.stat} padding="md">
            <span className={styles.statLabel}>{s.label}</span>
            <span className={styles.statValue} data-color={s.color}>{s.value}</span>
            <span className={styles.statDelta}>{s.delta}</span>
          </Surface>
        ))}
      </div>
      <div className={styles.panels}>
        <Surface variant="glass" className={styles.panel} padding="lg">
          <h2 className={styles.panelTitle}>Recent Errors</h2>
          {RECENT_ERRORS.map((e) => (
            <div key={e.id} className={styles.row}>
              <Badge variant={e.resolved ? 'emerald' : 'crimson'} dot>{e.id}</Badge>
              <span className={styles.rowTopic}>{e.topic}</span>
              <span className={styles.rowFault}>{e.fault}</span>
              <span className={styles.rowAge}>{e.age}</span>
            </div>
          ))}
        </Surface>
        <Surface variant="glass" className={styles.panel} padding="lg">
          <h2 className={styles.panelTitle}>Upcoming Reviews</h2>
          {UPCOMING_REVIEWS.map((r) => (
            <div key={r.label} className={styles.row}>
              <Badge variant={r.priority === 'high' ? 'crimson' : r.priority === 'medium' ? 'amber' : 'slate'}>{r.priority}</Badge>
              <span className={styles.rowTopic}>{r.label}</span>
              <span className={styles.rowDue}>{r.due}</span>
            </div>
          ))}
        </Surface>
      </div>
    </div>
  );
}
