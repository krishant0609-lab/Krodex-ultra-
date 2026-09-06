'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './tests.module.css';

const PROBES = [
  { id: 'PR-042', focus: 'Electromagnetism §4.1-4.3', questions: 15, status: 'available', score: null },
  { id: 'PR-041', focus: 'Thermodynamics §2', questions: 20, status: 'completed', score: 87 },
  { id: 'PR-040', focus: 'Classical Mechanics Review', questions: 25, status: 'completed', score: 91 },
];

export default function TestsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Diagnostic Tests</h1>
        <p className={styles.subtitle}>Formative assessments built from syllabus gaps and historical error clusters</p>
      </div>
      <div className={styles.probes}>
        {PROBES.map((p) => (
          <Surface key={p.id} variant="ink" className={styles.probe} padding="lg">
            <div className={styles.probeHead}>
              <span className={styles.probeId}>{p.id}</span>
              <Badge variant={p.status === 'available' ? 'emerald' : 'slate'}>
                {p.status}
              </Badge>
              {p.score !== null && (
                <Badge variant={p.score >= 90 ? 'emerald' : p.score >= 70 ? 'amber' : 'crimson'}>
                  {p.score}%
                </Badge>
              )}
            </div>
            <span className={styles.probeFocus}>{p.focus}</span>
            <span className={styles.probeMeta}>{p.questions} questions · Estimated 20 min</span>
          </Surface>
        ))}
      </div>
    </div>
  );
}
