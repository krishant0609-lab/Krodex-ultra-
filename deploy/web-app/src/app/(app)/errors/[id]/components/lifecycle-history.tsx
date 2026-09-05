/**
 * KRODEX web — Lifecycle history (Phase 9).
 *
 * Renders the immutable state-transition history for an error
 * entry, newest first. The list is an audit trail: every status
 * change the entry has gone through (open → in_review → resolved
 * → reopened → archived) shows up here with the trigger, the
 * reason, and the timestamp.
 *
 * The history is INSERT-only on the server (TRD §11). The UI
 * therefore treats it as a read-only ledger — there is no
 * "edit" or "delete" affordance.
 *
 * Empty state: a brand-new error entry (just created) will have
 * no transitions yet if creation didn't write a baseline event.
 * (The orchestrator does write a baseline `active` event on the
 * capture path, but manually-created entries may not.) When the
 * list is empty we render a quiet placeholder rather than a
 * misleading "no history" header.
 */

'use client';

import type { ReactNode } from 'react';
import type { ErrorEntryStatus, ErrorLifecycleEventRow, LifecycleTrigger } from '@krodex/shared';
import { useErrorLifecycle } from '../../../../../hooks/use-error-evidence';
import { formatLongDate, formatShortDate } from '../../../../../lib/format-date';
import styles from './lifecycle-history.module.css';

const TRIGGER_LABELS: Record<LifecycleTrigger, string> = {
  student_review: 'You marked',
  ai_suggestion: 'AI suggested',
  manual: 'Edited manually',
  system: 'System updated',
};

const STATUS_LABELS: Record<ErrorEntryStatus, string> = {
  active: 'active',
  in_review: 'in review',
  resolved: 'resolved',
  reopened: 'reopened',
  archived: 'archived',
};

interface LifecycleHistoryProps {
  errorId: string;
}

export function LifecycleHistory({ errorId }: LifecycleHistoryProps): ReactNode {
  const list = useErrorLifecycle(errorId);

  if (list.isLoading) {
    return (
      <section className={styles.section} aria-label="Lifecycle history">
        <h2 className={styles.heading}>Lifecycle</h2>
        <p className={styles.placeholder} data-testid="lifecycle-loading">
          Loading history…
        </p>
      </section>
    );
  }

  if (list.isError) {
    return (
      <section className={styles.section} aria-label="Lifecycle history">
        <h2 className={styles.heading}>Lifecycle</h2>
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="lifecycle-error"
        >
          We couldn&apos;t load the lifecycle history.
        </p>
      </section>
    );
  }

  // Defensive: the fixture/legacy backend may return an object
  // (e.g. `{ items: [...] }`) or `null` instead of a plain
  // array. Coerce to an array so the page never crashes on
  // `items.map`; if the shape is unexpected, render the empty
  // state instead of the lifecycle list.
  const raw = list.data;
  const items: readonly ErrorLifecycleEventRow[] = Array.isArray(raw)
    ? raw
    : [];

  return (
    <section className={styles.section} aria-label="Lifecycle history">
      <h2 className={styles.heading}>Lifecycle</h2>
      {items.length === 0 ? (
        <p className={styles.placeholder} data-testid="lifecycle-empty">
          No transitions have been recorded yet. This entry is in its
          original state.
        </p>
      ) : (
        <ol className={styles.list} data-testid="lifecycle-list">
          {items.map((event) => (
            <li
              key={event.id}
              className={styles.item}
              data-testid="lifecycle-event"
            >
              <div className={styles.itemHeader}>
                <span className={styles.trigger}>
                  {TRIGGER_LABELS[event.trigger] ?? event.trigger}
                </span>
                <span className={styles.transition}>
                  {event.from_status
                    ? `${STATUS_LABELS[event.from_status] ?? event.from_status} → ${
                        STATUS_LABELS[event.to_status] ?? event.to_status
                      }`
                    : `→ ${STATUS_LABELS[event.to_status] ?? event.to_status}`}
                </span>
                <time
                  className={styles.timestamp}
                  dateTime={event.created_at}
                  title={formatLongDate(event.created_at) ?? undefined}
                >
                  {formatShortDate(event.created_at)}
                </time>
              </div>
              {event.reason ? (
                <p className={styles.reason} data-testid="lifecycle-event-reason">
                  {event.reason}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
