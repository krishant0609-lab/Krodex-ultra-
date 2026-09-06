import React from 'react';
import styles from './badge.module.css';

export type BadgeVariant = 'champagne' | 'sapphire' | 'lavender' | 'emerald' | 'amber' | 'crimson' | 'slate';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({ variant = 'slate', children, className = '', dot = false }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[variant], className].filter(Boolean).join(' ')}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}
