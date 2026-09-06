'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './backlog.module.css';

const ITEMS = [
  { id: 'BL-019', topic: 'Fluid Dynamics — Navier-Stokes', priority: 'medium', effort: '6h', status: 'queued' },
  { id: 'BL-018', topic: 'Quantum Tunneling', priority: 'high', effort: '4h', status: 'queued' },
  { id: 'BL-017', topic: 'Statistical Mechanics — Ensembles', priority: 'low', effort: '3h', status: 'queued' },
  { id: 'BL-016', topic: 'Wave Propagation in Media', priority: 'medium', effort: '5h', status: 'queued' },
];

export default function BacklogPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Backlog</h1>
        <p className={styles.subtitle}>Deferrable topics queued for future study cycles</p>
      </div>
      <div className={styles.items}>
        {ITEMS.map((item) => (
          <Surface key={item.id} variant="ink" className={styles.item} padding="md">
            <div className={styles.itemHead}>
              <span className={styles.itemId}>{item.id}</span>
              <Badge
                variant={item.priority === 'high' ? 'crimson' : item.priority === 'medium' ? 'amber' : 'slate'}
              >
                {item.priority}
              </Badge>
              <Badge variant="sapphire">{item.status}</Badge>
            </div>
            <span className={styles.itemTopic}>{item.topic}</span>
            <span className={styles.itemMeta}>Est. {item.effort}</span>
          </Surface>
        ))}
      </div>
    </div>
  );
}
