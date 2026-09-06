'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './reviews.module.css';

const REVIEWS = [
  { label: 'Lenz\'s Law', scheduled: 'Today, 14:00', interval: '48h', status: 'due', confidence: 0.72 },
  { label: 'Gauss\'s Theorem', scheduled: 'Sep 10, 09:00', interval: '96h', status: 'scheduled', confidence: 0.88 },
  { label: 'Capacitance Networks', scheduled: 'Sep 12, 11:00', interval: '72h', status: 'scheduled', confidence: 0.65 },
  { label: 'Thermodynamic Entropy', scheduled: 'Sep 08, 16:00', interval: '120h', status: 'overdue', confidence: 0.81 },
];

export default function ReviewsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Adaptive Reviews</h1>
        <p className={styles.subtitle}>Spaced repetition powered by individual error volatility</p>
      </div>
      <div className={styles.reviews}>
        {REVIEWS.map((r) => (
          <Surface key={r.label} variant="ink" className={styles.review} padding="md">
            <div className={styles.reviewHead}>
              <span className={styles.reviewLabel}>{r.label}</span>
              <Badge
                variant={r.status === 'due' ? 'crimson' : r.status === 'overdue' ? 'crimson' : r.status === 'scheduled' ? 'sapphire' : 'slate'}
                dot
              >
                {r.status}
              </Badge>
            </div>
            <div className={styles.reviewMeta}>
              <span>Next: {r.scheduled}</span>
              <span>λ = {r.interval}</span>
              <span>θ = {Math.round(r.confidence * 100)}%</span>
            </div>
          </Surface>
        ))}
      </div>
    </div>
  );
}
