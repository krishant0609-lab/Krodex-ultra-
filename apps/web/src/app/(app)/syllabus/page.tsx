'use client';
import React from 'react';
import { motion } from 'framer-motion';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './syllabus.module.css';

const TOPICS = [
  { id: 'T-01', name: 'Classical Mechanics', progress: 78, prerequisites: [], status: 'active' },
  { id: 'T-02', name: 'Electromagnetism', progress: 54, prerequisites: ['T-01'], status: 'active' },
  { id: 'T-03', name: 'Thermodynamics', progress: 91, prerequisites: ['T-01'], status: 'mastered' },
  { id: 'T-04', name: 'Wave Mechanics', progress: 32, prerequisites: ['T-02'], status: 'gapped' },
  { id: 'T-05', name: 'Quantum Foundations', progress: 18, prerequisites: ['T-02', 'T-03'], status: 'locked' },
];

export default function SyllabusPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Syllabus Architecture</h1>
        <p className={styles.subtitle}>Living topic hierarchy — mastery depth mapped in real-time</p>
      </div>
      <div className={styles.topics}>
        {/* eslint-disable-next-line react-hooks/exhaustive-deps */}
        {TOPICS.map((t) => (
          <Surface key={t.id} variant="ink" className={styles.topic} padding="md">
            <div className={styles.topicHead}>
              <span className={styles.topicId}>{t.id}</span>
              <span className={styles.topicName}>{t.name}</span>
              <Badge variant={t.status === 'mastered' ? 'emerald' : t.status === 'gapped' ? 'amber' : t.status === 'locked' ? 'slate' : 'sapphire'}>
                {t.status}
              </Badge>
            </div>
            <div className={styles.progress}>
              <div className={styles.progressBar}>
                <motion.div
                  className={styles.progressFill}
                  initial={{ width: 0 }}
                  animate={{ width: t.progress + '%' }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <span className={styles.progressLabel}>{t.progress}%</span>
            </div>
            {t.prerequisites.length > 0 && (
              <div className={styles.prereqs}>
                <span className={styles.prereqLabel}>Requires:</span>
                {t.prerequisites.map((p) => (
                  <Badge key={p} variant="slate">{p}</Badge>
                ))}
              </div>
            )}
          </Surface>
        ))}
      </div>
    </div>
  );
}
