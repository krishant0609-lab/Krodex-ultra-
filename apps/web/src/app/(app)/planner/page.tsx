'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './planner.module.css';

const TASKS = [
  { id: 'PL-1', label: 'Review Electromagnetism §4.2', due: 'Today, 14:00', priority: 'high', status: 'pending' },
  { id: 'PL-2', label: 'Complete Problem Set 7', due: 'Today, 18:00', priority: 'high', status: 'in-progress' },
  { id: 'PL-3', label: 'Read Thermodynamics Chapter 5', due: 'Tomorrow, 09:00', priority: 'medium', status: 'pending' },
  { id: 'PL-4', label: 'Practice Wave Equations', due: 'Sep 10', priority: 'low', status: 'pending' },
];

export default function PlannerPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Responsive Planner</h1>
        <p className={styles.subtitle}>Dynamic schedule — adapts when life intervenes</p>
      </div>
      <div className={styles.tasks}>
        {TASKS.map((t) => (
          <Surface key={t.id} variant="ink" className={styles.task} padding="md">
            <div className={styles.taskRow}>
              <Badge variant={t.priority === 'high' ? 'crimson' : t.priority === 'medium' ? 'amber' : 'slate'}>
                {t.priority}
              </Badge>
              <span className={styles.taskLabel}>{t.label}</span>
              <Badge variant={t.status === 'in-progress' ? 'sapphire' : 'slate'}>
                {t.status}
              </Badge>
            </div>
            <span className={styles.taskDue}>{t.due}</span>
          </Surface>
        ))}
      </div>
    </div>
  );
}
