'use client';

/**
 * KRODEX web — Backlog recovery panel (Phase 11).
 *
 * Renders the recovery suggestions returned by
 * `GET /planner/backlog/recovery-suggestions`. Each row
 * shows the suggested action (reschedule / complete /
 * dismiss) with a reason, and exposes confirm/dismiss
 * controls that POST to /planner/backlog/recover/:id.
 *
 * Reschedule requires a new due date — we ask for one
 * inline via a small date input that becomes visible
 * when the user clicks the primary action.
 */

import { useState } from 'react';
import { Badge } from '../../../../components/badge';
import {
  useRecoverPlannerBacklog,
  useRecoverySuggestions,
  type RecoveryAction,
  type RecoverySuggestion,
} from '../../../../hooks/use-planner-automation';
import { ApiError } from '../../../../lib/api-client';
import { formatShortDate } from '../../../../lib/format-date';
import styles from './backlog-recovery.module.css';

const ACTION_TONES: Record<RecoveryAction, 'lavender' | 'success' | 'rose'> = {
  reschedule: 'lavender',
  complete: 'success',
  dismiss: 'rose',
  split: 'lavender',
};

function todayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

function RescheduleForm({
  suggestion,
  onCancel,
  onSuccess,
}: {
  suggestion: RecoverySuggestion;
  onCancel: () => void;
  onSuccess: () => void;
}): JSX.Element {
  const recover = useRecoverPlannerBacklog(suggestion.backlogItemId);
  const [newDueAt, setNewDueAt] = useState<string>(todayIso());

  const submit = (): void => {
    recover.mutate(
      { action: 'reschedule', newDueAt: `${newDueAt}T00:00:00.000Z` },
      { onSuccess },
    );
  };

  return (
    <div className={styles.form} data-testid={`recovery-form-${suggestion.backlogItemId}`}>
      <label className={styles.formLabel}>
        Reschedule to
        <input
          type="date"
          className={styles.formInput}
          value={newDueAt}
          onChange={(e) => setNewDueAt(e.target.value)}
          disabled={recover.isPending}
          data-testid={`recovery-date-${suggestion.backlogItemId}`}
        />
      </label>
      <div className={styles.formActions}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
          onClick={submit}
          disabled={recover.isPending || !newDueAt}
          data-testid={`recovery-confirm-${suggestion.backlogItemId}`}
        >
          {recover.isPending ? 'Saving…' : 'Confirm reschedule'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={onCancel}
          disabled={recover.isPending}
        >
          Cancel
        </button>
      </div>
      {recover.isError ? (
        <p className={styles.errorMeta} role="status">
          {recover.error instanceof ApiError
            ? `${recover.error.code} (${recover.error.status})`
            : 'Recovery failed.'}
        </p>
      ) : null}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  onAction,
}: {
  suggestion: RecoverySuggestion;
  onAction: (s: RecoverySuggestion) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const recover = useRecoverPlannerBacklog(suggestion.backlogItemId);
  const tone = ACTION_TONES[suggestion.suggestedAction];

  const handleClick = (): void => {
    if (suggestion.suggestedAction === 'reschedule') {
      setOpen((v) => !v);
      return;
    }
    recover.mutate(
      { action: suggestion.suggestedAction },
      { onSuccess: () => onAction(suggestion) },
    );
  };

  return (
    <li
      className={styles.item}
      data-testid={`recovery-suggestion-${suggestion.backlogItemId}`}
    >
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <div className={styles.rowMeta}>
            <Badge tone={tone} size="sm">
              {suggestion.suggestedAction}
            </Badge>
            <span className={styles.rowAge}>
              {suggestion.ageDays} day{suggestion.ageDays === 1 ? '' : 's'} old
            </span>
          </div>
          <p className={styles.rowReason}>{suggestion.reason}</p>
          {open ? (
            <RescheduleForm
              suggestion={suggestion}
              onCancel={() => setOpen(false)}
              onSuccess={() => {
                setOpen(false);
                onAction(suggestion);
              }}
            />
          ) : null}
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleClick}
            disabled={recover.isPending}
            data-testid={`recovery-action-${suggestion.backlogItemId}`}
          >
            {suggestion.suggestedAction === 'reschedule'
              ? open
                ? 'Close'
                : 'Reschedule'
              : suggestion.suggestedAction === 'complete'
                ? 'Mark complete'
                : 'Dismiss'}
          </button>
        </div>
      </div>
    </li>
  );
}

export function BacklogRecoveryPanel(): JSX.Element | null {
  const suggestions = useRecoverySuggestions();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  if (suggestions.isLoading) {
    return (
      <section
        className={styles.panel}
        data-testid="backlog-recovery-loading"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Backlog recovery</h2>
          <p className={styles.description}>
            Looking for backlog items that need a recovery action…
          </p>
        </header>
      </section>
    );
  }
  if (suggestions.isError) {
    return (
      <section
        className={styles.panel}
        data-testid="backlog-recovery-error"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Backlog recovery</h2>
          <p className={styles.errorMeta} role="status">
            {suggestions.error instanceof ApiError
              ? `${suggestions.error.code} (${suggestions.error.status})`
              : 'Could not load recovery suggestions.'}
          </p>
        </header>
      </section>
    );
  }

  const all: readonly RecoverySuggestion[] = suggestions.data?.suggestions ?? [];
  const visible = all.filter((s) => !removed.has(s.backlogItemId));

  if (visible.length === 0) {
    return null;
  }

  return (
    <section className={styles.panel} data-testid="backlog-recovery-panel">
      <header className={styles.header}>
        <h2 className={styles.title}>Backlog recovery</h2>
        <p className={styles.description}>
          {visible.length} backlog item
          {visible.length === 1 ? '' : 's'} would benefit from a recovery
          action. {formatShortDate(new Date().toISOString()) ? 'Reviewed on' : ''}{' '}
          {formatShortDate(new Date().toISOString())}.
        </p>
      </header>
      <ol className={styles.list}>
        {visible.map((s) => (
          <SuggestionRow
            key={s.backlogItemId}
            suggestion={s}
            onAction={(row) =>
              setRemoved((prev) => {
                const next = new Set(prev);
                next.add(row.backlogItemId);
                return next;
              })
            }
          />
        ))}
      </ol>
    </section>
  );
}
