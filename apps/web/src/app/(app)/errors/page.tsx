'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './errors.module.css';

const ERRORS = [
  { id: 'EB-948', topic: 'Lenz\'s Law', fault: 'Sign Inversion', type: 'computation', resolved: false, age: '2d' },
  { id: 'EB-947', topic: 'Gauss\'s Theorem', fault: 'Boundary Condition', type: 'conceptual', resolved: true, age: '5d' },
  { id: 'EB-946', topic: 'Capacitance', fault: 'Unit Error', type: 'oversight', resolved: true, age: '1w' },
  { id: 'EB-945', topic: 'Inductance', fault: 'Sign Error', type: 'computation', resolved: false, age: '3d' },
];

export default function ErrorsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Error Book</h1>
        <p className={styles.subtitle}>Cognitive misconceptions — categorized by fault type</p>
      </div>
      <div className={styles.errors}>
        {ERRORS.map((e) => (
          <Surface key={e.id} variant="ink" className={styles.error} padding="md">
            <div className={styles.errorHead}>
              <span className={styles.errorId}>{e.id}</span>
              <Badge variant={e.resolved ? 'emerald' : 'crimson'} dot>{e.resolved ? 'Resolved' : 'Active'}</Badge>
              <Badge variant="lavender">{e.type}</Badge>
            </div>
            <span className={styles.errorTopic}>{e.topic}</span>
            <span className={styles.errorFault}>{e.fault}</span>
            <span className={styles.errorAge}>Captured {e.age} ago</span>
          </Surface>
        ))}
      </div>
    </div>
  );
}
