/**
 * KRODEX web — Spinner primitive.
 *
 * Used as a visual indicator only — every stateful primitive
 * has its own loading style. Spinner is intended for
 * inline/in-component fallbacks where PageShell's skeleton is
 * too large.
 */

'use client';

import type { HTMLAttributes } from 'react';
import styles from './spinner.module.css';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({ size = 'md', label = 'Loading', className, ...rest }: SpinnerProps): JSX.Element {
  const sizeClass = size === 'sm' ? styles.sizeSm : size === 'lg' ? styles.sizeLg : styles.sizeMd;
  return (
    <span
      role="status"
      aria-label={label}
      className={[styles.spinner, sizeClass, className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
