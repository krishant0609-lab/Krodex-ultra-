/**
 * KRODEX web — Badge primitive.
 *
 * Inline label with semantic or accent tint. Use `dot` to add a
 * small status indicator at the leading edge.
 *
 * Tones map to the shared primitive tints in
 * primitives.module.css so colors stay consistent across the app.
 */

'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import styles from './badge.module.css';
import tints from './primitives.module.css';
import { cls } from '../lib/classnames';

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'lavender'
  | 'sapphire'
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'champagne';

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  children?: ReactNode;
}

function toneClass(tone: BadgeTone): string | undefined {
  switch (tone) {
    case 'info':
      return tints.tintInfo;
    case 'success':
      return tints.tintSuccess;
    case 'warning':
      return tints.tintWarning;
    case 'danger':
      return tints.tintDanger;
    case 'lavender':
      return tints.tintLavender;
    case 'sapphire':
      return tints.tintSapphire;
    case 'emerald':
      return tints.tintEmerald;
    case 'rose':
      return tints.tintRose;
    case 'amber':
      return tints.tintAmber;
    case 'champagne':
      return tints.tintChampagne;
    case 'neutral':
    default:
      return tints.tintNeutral;
  }
}

export function Badge({
  tone = 'neutral',
  size = 'md',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cls([
        styles.badge,
        toneClass(tone),
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        className,
      ])}
      {...rest}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
