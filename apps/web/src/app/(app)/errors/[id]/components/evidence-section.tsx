/**
 * KRODEX web — Evidence section (Phase 9).
 *
 * Renders the per-error-entry list of ErrorEvidence rows. The
 * list itself is cheap (no signed URLs); the per-row snapshot
 * binary is fetched lazily — only when the student clicks the
 * "View snapshot" toggle. That keeps the page-load budget
 * honest: a popular error with 30+ recurrences shouldn't fire
 * 30 signed-URL requests on mount.
 *
 * Each row shows:
 *   - the timestamp + classification badge
 *   - the student's answer and the expected answer (the same
 *     fallback surface the EvidenceViewer uses when no snapshot
 *     is available, so the UI is consistent whether or not the
 *     snapshot is online)
 *   - a collapsible snapshot viewer (rendered on demand)
 *
 * Empty state: an error entry with no evidence rows yet (manual
 * entry, or capture pipeline not yet exercised) shows a quiet
 * "no snapshots recorded" line.
 */

'use client';

import { useState, type ReactNode } from 'react';
import type { ErrorEvidenceRow } from '@krodex/shared';
import { Badge } from '../../../../../components/badge';
import { EvidenceViewer } from '../../../../../components/evidence-viewer';
import {
  useErrorEntryEvidence,
  useErrorEvidence,
} from '../../../../../hooks/use-error-evidence';
import { formatLongDate, formatShortDate } from '../../../../../lib/format-date';
import styles from './evidence-section.module.css';

const CLASSIFICATION_TONES = {
  pending: 'lavender',
  suggested: 'champagne',
  confirmed: 'success',
  student_override: 'rose',
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  concept: 'Concept gap',
  calculation: 'Calculation slip',
  misread: 'Misread',
  time_pressure: 'Time pressure',
  careless: 'Careless',
  method: 'Wrong method',
  unknown: 'Unknown',
};

interface EvidenceSectionProps {
  errorId: string;
}

export function EvidenceSection({ errorId }: EvidenceSectionProps): ReactNode {
  const list = useErrorEntryEvidence(errorId);

  if (list.isLoading) {
    return (
      <section className={styles.section} aria-label="Evidence history">
        <h2 className={styles.heading}>Evidence history</h2>
        <p className={styles.placeholder} data-testid="evidence-loading">
          Loading evidence history…
        </p>
      </section>
    );
  }

  if (list.isError) {
    return (
      <section className={styles.section} aria-label="Evidence history">
        <h2 className={styles.heading}>Evidence history</h2>
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="evidence-error"
        >
          We couldn&apos;t load the evidence history for this entry.
        </p>
      </section>
    );
  }

  // Defensive: the fixture/legacy backend may return an object
  // (e.g. `{ items: [...] }`) or `null` instead of a plain
  // array. Coerce to an array so the page never crashes on
  // `items.map`; if the shape is unexpected, render the empty
  // state instead of the evidence list.
  const raw = list.data;
  const items: readonly ErrorEvidenceRow[] = Array.isArray(raw)
    ? raw
    : [];

  return (
    <section className={styles.section} aria-label="Evidence history">
      <h2 className={styles.heading}>Evidence history</h2>
      {items.length === 0 ? (
        <p
          className={styles.placeholder}
          data-testid="evidence-empty"
        >
          No snapshots have been recorded for this error yet. Future wrong
          answers on this question will show up here automatically.
        </p>
      ) : (
        <ol className={styles.list} data-testid="evidence-list">
          {items.map((row) => (
            <EvidenceRow key={row.id} row={row} />
          ))}
        </ol>
      )}
    </section>
  );
}

interface EvidenceRowProps {
  row: ErrorEvidenceRow;
}

function EvidenceRow({ row }: EvidenceRowProps): ReactNode {
  const [open, setOpen] = useState(false);
  const detail = useErrorEvidence(open ? row.id : null);
  const snapshot = open ? detail.data?.snapshot ?? null : null;
  const isDetailLoading = open && detail.isLoading;
  const detailError = open && detail.isError
    ? detail.error instanceof Error
      ? detail.error.message
      : "We couldn't load this snapshot."
    : null;

  const statusTone =
    CLASSIFICATION_TONES[row.classification_status] ?? 'lavender';
  const categoryLabel = row.classification_category
    ? CATEGORY_LABELS[row.classification_category] ??
      row.classification_category
    : 'Unclassified';

  return (
    <li className={styles.row} data-testid="evidence-row">
      <div className={styles.rowHeader}>
        <div className={styles.rowMeta}>
          <span className={styles.rowDate} title={formatLongDate(row.created_at) ?? undefined}>
            {formatShortDate(row.created_at)}
          </span>
          <Badge tone={statusTone} size="sm">
            {row.classification_status.replace(/_/g, ' ')}
          </Badge>
          <span className={styles.rowCategory}>{categoryLabel}</span>
          {row.attempt_id ? (
            <span className={styles.rowAttempt} title="Source attempt">
              from {row.attempt_id.slice(0, 8)}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={`evidence-snapshot-${row.id}`}
          onClick={() => setOpen((v) => !v)}
          data-testid="evidence-toggle"
        >
          {open ? 'Hide snapshot' : 'View snapshot'}
        </button>
      </div>

      {open ? (
        <div
          id={`evidence-snapshot-${row.id}`}
          className={styles.viewer}
          data-testid="evidence-viewer-wrapper"
        >
          <EvidenceViewer
            snapshot={snapshot}
            studentAnswer={row.student_answer}
            expectedAnswer={row.expected_answer}
            isLoading={isDetailLoading}
            errorMessage={detailError}
          />
        </div>
      ) : null}
    </li>
  );
}
