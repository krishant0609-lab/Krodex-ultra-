'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import styles from './insights.module.css';

export default function InsightsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Insights</h1>
        <p className={styles.subtitle}>Aggregate learning analytics — error patterns, retention rates, and mastery trajectories</p>
      </div>
      <div className={styles.grid}>
        <Surface variant="ink" padding="lg" className={styles.card}>
          <span className={styles.metric}>87%</span>
          <span className={styles.metricLabel}>Overall Retention</span>
        </Surface>
        <Surface variant="ink" padding="lg" className={styles.card}>
          <span className={styles.metric}>12</span>
          <span className={styles.metricLabel}>Topics Mastered</span>
        </Surface>
        <Surface variant="ink" padding="lg" className={styles.card}>
          <span className={styles.metric}>4.2d</span>
          <span className={styles.metricLabel}>Avg. Error Half-Life</span>
        </Surface>
        <Surface variant="ink" padding="lg" className={styles.card}>
          <span className={styles.metric}>3</span>
          <span className={styles.metricLabel}>Active Gaps</span>
        </Surface>
        <Surface variant="glass" padding="lg" className={styles.chartCard}>
          <span className={styles.chartLabel}>Error Rate by Topic</span>
          <div className={styles.bars}>
            {[
              { label: 'EM', value: 0.18 },
              { label: 'Thermo', value: 0.12 },
              { label: 'Mech', value: 0.07 },
              { label: 'QM', value: 0.22 },
              { label: 'Stats', value: 0.09 },
            ].map((b) => (
              <div key={b.label} className={styles.barRow}>
                <span className={styles.barLabel}>{b.label}</span>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${b.value * 100}%` }} />
                </div>
                <span className={styles.barValue}>{(b.value * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </Surface>
        <Surface variant="glass" padding="lg" className={styles.chartCard}>
          <span className={styles.chartLabel}>Weekly Review Load</span>
          <div className={styles.bars}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <div key={d} className={styles.barRow}>
                <span className={styles.barLabel}>{d}</span>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${[40, 60, 35, 80, 55, 20, 10][i]}%` }} />
                </div>
                <span className={styles.barValue}>{[40, 60, 35, 80, 55, 20, 10][i]}</span>
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}
