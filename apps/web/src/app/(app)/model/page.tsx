'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './model.module.css';

export default function ModelPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Model</h1>
        <p className={styles.subtitle}>Adaptive learning model parameters and current epistemic state</p>
      </div>
      <div className={styles.sections}>
        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>Epistemic State</h2>
          <div className={styles.params}>
            {[
              { label: 'Confidence Threshold', value: 'θ ≥ 0.75', desc: 'Minimum confidence to mark a node as "mastered"' },
              { label: 'Decay Rate', value: 'λ = 0.015/day', desc: 'Natural forgetting rate applied per topic' },
              { label: 'Error Volatility', value: 'σ = 0.22', desc: 'Standard deviation of per-topic error probability' },
              { label: 'Review Interval', value: 'τ ∈ [24h, 240h]', desc: 'Allowed review spacing range per topic' },
            ].map((p) => (
              <div key={p.label} className={styles.param}>
                <div className={styles.paramHead}>
                  <span className={styles.paramLabel}>{p.label}</span>
                  <span className={styles.paramValue}>{p.value}</span>
                </div>
                <p className={styles.paramDesc}>{p.desc}</p>
              </div>
            ))}
          </div>
        </Surface>
        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>Mastery Estimates</h2>
          <div className={styles.masteryGrid}>
            {[
              { topic: 'Electromagnetism', theta: 0.91, status: 'mastered' },
              { topic: 'Thermodynamics', theta: 0.74, status: 'active' },
              { topic: 'Classical Mechanics', theta: 0.88, status: 'active' },
              { topic: 'Quantum Mechanics', theta: 0.55, status: 'gapped' },
              { topic: 'Statistical Mechanics', theta: 0.63, status: 'gapped' },
            ].map((m) => (
              <div key={m.topic} className={styles.masteryItem}>
                <div className={styles.masteryHead}>
                  <span className={styles.masteryTopic}>{m.topic}</span>
                  <Badge
                    variant={m.status === 'mastered' ? 'emerald' : m.status === 'active' ? 'sapphire' : 'amber'}
                    dot
                  >
                    {m.status}
                  </Badge>
                </div>
                <div className={styles.masteryBar}>
                  <div className={styles.masteryFill} style={{ width: `${m.theta * 100}%` }} />
                </div>
                <span className={styles.masteryValue}>θ = {(m.theta * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}
