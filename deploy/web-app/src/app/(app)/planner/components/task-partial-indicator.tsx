'use client';

/**
 * KRODEX web — Task partial indicator (Phase 11).
 *
 * A small caption that surfaces `partial_count` so the
 * student knows how often a task has been marked partial
 * before. We deliberately do not use this to drive a
 * score; partial is informational, not penal.
 */

import styles from './task-partial-indicator.module.css';

interface Props {
  partialCount: number;
}

export function TaskPartialIndicator({ partialCount }: Props): JSX.Element | null {
  if (!Number.isFinite(partialCount) || partialCount <= 0) return null;
  return (
    <span
      className={styles.chip}
      data-testid="task-partial-indicator"
      title={`Marked partial ${partialCount} time${partialCount === 1 ? '' : 's'}`}
    >
      partial × {partialCount}
    </span>
  );
}
