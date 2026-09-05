/**
 * KRODEX web — Stat primitive.
 *
 * A single labeled value with optional unit and delta. Used for
 * dashboard tiles and detail-page summary rows. Renders a
 * vertical stack by default; use `inline` for a horizontal
 * label/value pair.
 *
 * The `delta` direction is up | down | flat; the styling is
 * conventional (up = positive / green) — callers should pass
 * a tone only if they have a domain reason to invert it.
 */

'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import styles from './stat.module.css';
import { cls } from '../lib/classnames';

export type StatDeltaDirection = 'up' | 'down' | 'flat';

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: ReactNode;
  deltaDirection?: StatDeltaDirection;
  inline?: boolean;
}

function deltaClass(dir: StatDeltaDirection | undefined): string | undefined {
  if (dir === 'up') return styles.deltaUp;
  if (dir === 'down') return styles.deltaDown;
  return styles.deltaFlat;
}

function deltaArrow(dir: StatDeltaDirection | undefined): string {
  if (dir === 'up') return '↑';
  if (dir === 'down') return '↓';
  return '→';
}

export function Stat({
  label,
  value,
  unit,
  delta,
  deltaDirection,
  inline = false,
  className,
  ...rest
}: StatProps): JSX.Element {
  return (
    <div
      className={className}
      style={inline ? { display: 'inline-flex', alignItems: 'baseline', gap: 'var(--kd-space-3)' } : undefined}
      {...rest}
    >
      <span
        className={styles.label}
        style={inline ? { textTransform: 'none', letterSpacing: 0, fontSize: 'var(--kd-type-body-s-size)' } : undefined}
      >
        {label}
      </span>
      <span className={styles.stat} style={inline ? { flexDirection: 'row', alignItems: 'baseline', gap: 'var(--kd-space-2)' } : undefined}>
        <span className={styles.value}>
          {value}
          {unit ? <span className={styles.unit}>{unit}</span> : null}
        </span>
        {delta ? (
          <span className={cls([styles.delta, deltaClass(deltaDirection)])}>
            <span aria-hidden="true">{deltaArrow(deltaDirection)}</span>
            <span>{delta}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
