/**
 * KRODEX web — Phase 8 Classification Suggestion card.
 *
 * Rendered on the Error detail page when the entry has no
 * `mistake_type` set (or its category is "unknown"). The card
 * asks the AI assistant for a non-authoritative classification
 * suggestion. Per Phase 8 plan §6, the AI never writes the
 * database — this component:
 *
 *   1. On first mount, fetches a suggestion from
 *      `POST /errors/:id/classification-suggest` via the
 *      `useClassificationSuggest` hook.
 *   2. Displays the suggestion with the rationale and a
 *      confidence badge.
 *   3. On "Accept" calls the existing `useUpdateErrorEntry`
 *      hook (Phase 2 mutation) with the suggested category —
 *      the source is recorded as `student` because the
 *      student is the one who confirmed. (Phase 7 stores
 *      `classification_source` on the row.)
 *   4. On "Set manually" shows an inline category selector
 *      and writes through the same update hook.
 *   5. On AI unavailability (DEPENDENCY_UNAVAILABLE / 503
 *      or AI_OUTPUT_INVALID / 422) renders the manual
 *      selector immediately and a quiet "AI classification
 *      unavailable — set manually" note.
 *
 * Invariant: the AI is non-authoritative. The component never
 * accepts a suggestion without an explicit click; the database
 * write always goes through the existing error-update path.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MistakeType } from '@krodex/shared';
import { useClassificationSuggest } from '../../../../hooks/use-classification-suggest';
import { useUpdateErrorEntry } from '../../../../hooks/use-errors';
import { ApiError } from '../../../../lib/api-client';
import styles from './classification-suggest-card.module.css';

const CATEGORIES: ReadonlyArray<{ value: MistakeType; label: string }> = [
  { value: 'concept', label: 'Concept gap' },
  { value: 'calculation', label: 'Calculation slip' },
  { value: 'misread', label: 'Misread the question' },
  { value: 'time_pressure', label: 'Time pressure' },
  { value: 'careless', label: 'Careless slip' },
  { value: 'method', label: 'Wrong method' },
  { value: 'unknown', label: 'Other / unknown' },
];

interface ClassificationSuggestCardProps {
  errorId: string;
  /**
   * The currently-set category (may be null/unknown). When this
   * is already a real category, the card is hidden — the entry
   * is classified and there is nothing to suggest.
   */
  currentCategory: MistakeType | null | undefined;
}

export function ClassificationSuggestCard({
  errorId,
  currentCategory,
}: ClassificationSuggestCardProps): JSX.Element | null {
  // Hide entirely once the entry is classified with a real
  // category. The card is for unclassified entries only.
  const isClassified =
    !!currentCategory && currentCategory !== 'unknown';

  const suggest = useClassificationSuggest(isClassified ? null : errorId);
  const update = useUpdateErrorEntry(errorId);

  const [mode, setMode] = useState<'suggested' | 'manual' | 'accepted'>('suggested');
  const [manualCategory, setManualCategory] = useState<MistakeType>('concept');

  // Auto-fetch a suggestion on mount when the entry is
  // unclassified. The hook is `enabled: false` once the entry
  // is classified so this is a one-time fire per error id.
  useEffect(() => {
    if (isClassified) return;
    if (suggest.isIdle) {
      // `mutateAsync` returns the promise; `mutate` is void.
      // We use mutateAsync so we can swallow the error here
      // — the hook surfaces the error state via `isError`.
      suggest.mutateAsync().catch(() => undefined);
    }
    // We only want to fire on entry id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorId, isClassified]);

  const aiUnavailable = useMemo(() => {
    if (!suggest.isError) return false;
    const err = suggest.error;
    if (err instanceof ApiError) {
      return (
        err.code === 'DEPENDENCY_UNAVAILABLE' ||
        err.code === 'AI_OUTPUT_INVALID' ||
        err.status >= 500
      );
    }
    return true;
  }, [suggest.isError, suggest.error]);

  if (isClassified) return null;

  const onAccept = (): void => {
    if (!suggest.data) return;
    const category = suggest.data.suggestion.suggestedCategory;
    update.mutate(
      { mistake_type: category },
      {
        onSuccess: () => {
          setMode('accepted');
        },
      },
    );
  };

  const onManualSave = (): void => {
    update.mutate(
      { mistake_type: manualCategory },
      {
        onSuccess: () => {
          setMode('accepted');
        },
      },
    );
  };

  return (
    <aside
      className={styles.card}
      aria-label="AI classification suggestion"
      data-testid="classification-suggest-card"
      data-mode={mode}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>AI assist</p>
        <h2 className={styles.title}>Suggest a classification</h2>
        <p className={styles.subtitle}>
          The assistant can look at this entry and your own error history to
          suggest a category. You confirm — the assistant never writes your
          records on its own.
        </p>
      </header>

      {mode === 'accepted' ? (
        <p className={styles.accepted} data-testid="classification-accepted">
          Saved. You can change the category anytime from the error book.
        </p>
      ) : aiUnavailable ? (
        <div
          className={styles.unavailable}
          data-testid="classification-unavailable"
        >
          <p className={styles.unavailableText}>
            AI classification is unavailable right now. Set the category
            manually — the suggestion will return when the assistant is
            back.
          </p>
          <fieldset className={styles.manualFieldset}>
            <legend className={styles.manualLegend}>Set category</legend>
            <div className={styles.radioRow}>
              {CATEGORIES.map((c) => (
                <label key={c.value} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name={`classify-${errorId}`}
                    value={c.value}
                    checked={manualCategory === c.value}
                    onChange={() => setManualCategory(c.value)}
                    data-testid={`classification-manual-${c.value}`}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={onManualSave}
              disabled={update.isPending}
              data-testid="classification-manual-save"
            >
              {update.isPending ? 'Saving…' : 'Save category'}
            </button>
          </fieldset>
        </div>
      ) : suggest.isPending || (suggest.isIdle && !suggest.data) ? (
        <p
          className={styles.loading}
          data-testid="classification-loading"
          aria-live="polite"
        >
          Getting suggestion…
        </p>
      ) : mode === 'manual' ? (
        <fieldset className={styles.manualFieldset}>
          <legend className={styles.manualLegend}>Set category</legend>
          <div className={styles.radioRow}>
            {CATEGORIES.map((c) => (
              <label key={c.value} className={styles.radioLabel}>
                <input
                  type="radio"
                  name={`classify-${errorId}`}
                  value={c.value}
                  checked={manualCategory === c.value}
                  onChange={() => setManualCategory(c.value)}
                  data-testid={`classification-manual-${c.value}`}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onManualSave}
            disabled={update.isPending}
            data-testid="classification-manual-save"
          >
            {update.isPending ? 'Saving…' : 'Save category'}
          </button>
        </fieldset>
      ) : suggest.data ? (
        <div
          className={styles.suggestion}
          data-testid="classification-suggestion"
        >
          <div className={styles.suggestionRow}>
            <span className={styles.suggestionLabel}>Suggested category</span>
            <span
              className={styles.suggestionValue}
              data-testid="classification-suggestion-category"
            >
              {labelFor(suggest.data.suggestion.suggestedCategory)}
            </span>
          </div>
          <div className={styles.suggestionRow}>
            <span className={styles.suggestionLabel}>Why</span>
            <span
              className={styles.suggestionValue}
              data-testid="classification-suggestion-rationale"
            >
              {suggest.data.suggestion.rationale}
            </span>
          </div>
          <div className={styles.suggestionRow}>
            <span className={styles.suggestionLabel}>Confidence</span>
            <span
              className={styles.confidence}
              data-testid="classification-suggestion-confidence"
            >
              {Math.round(suggest.data.suggestion.confidence * 100)}%
            </span>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={onAccept}
              disabled={update.isPending}
              data-testid="classification-accept"
            >
              {update.isPending ? 'Saving…' : 'Accept suggestion'}
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => setMode('manual')}
              data-testid="classification-set-manually"
            >
              Set manually
            </button>
          </div>
        </div>
      ) : null}

      {update.isError ? (
        <p
          className={styles.errorMeta}
          role="alert"
          data-testid="classification-save-error"
        >
          {update.error instanceof ApiError
            ? `Save failed: ${update.error.code}`
            : 'Save failed.'}
        </p>
      ) : null}
    </aside>
  );
}

function labelFor(category: MistakeType): string {
  return CATEGORIES.find((c) => c.value === category)?.label ?? category;
}
