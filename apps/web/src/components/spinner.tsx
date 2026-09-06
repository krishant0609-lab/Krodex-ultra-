import React from 'react';
import styles from './spinner.module.css';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'champagne' | 'sapphire' | 'lavender' | 'white';
  label?: string;
  className?: string;
}

export function Spinner({
  size = 'md',
  color = 'champagne',
  label = 'Loading…',
  className = '',
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={[styles.spinner, styles[size], styles[color], className].filter(Boolean).join(' ')}
    />
  );
}
