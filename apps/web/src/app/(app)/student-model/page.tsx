'use client';

/**
 * KRODEX web — Student model (index).
 *
 *   /student-model
 *
 * Phase 7.10 visual layer:
 *  - Eyebrow "Advisory", title "Student model", and a
 *    calm description that names the read-only nature
 *    of the page (the orchestrator is the only writer).
 *  - Reads the latest `StudentModelSnapshotPayload` and
 *    renders each feature as a row: feature name, score
 *    (0..1), direction (improving / declining / stable /
 *    insufficient_data), confidence (limited / moderate /
 *    strong), and the sample size.
 *  - 7-state contract honored: loading, empty (NOT_FOUND
 *    from the cold-start case), error, populated.
 *  - The empty state is honest: "No student-model
 *    snapshot yet" — the page does not fabricate scores.
 *
 * Hooks used (no new server state):
 *  - useStudentModel(28)
 *
 * The page is read-only. There is no client-side mutation;
 * the orchestrator is the only writer (PRD §25).
 */

import { PageShell } from '../../../components/page-shell';
import { Badge } from '../../../components/badge';
import { useStudentModel } from '../../../hooks/use-student-model';
import { ApiError } from '../../../lib/api-client';
import type { StudentModelFeatureValue } from '@krodex/shared';
import styles from './student-model.module.css';

interface FeatureRow {
  key: string;
  label: string;
  value: StudentModelFeatureValue;
}

const FEATURE_LABELS: Record<string, string> = {
  consistency_score: 'consistency',
  procrastination_score: 'procrastination',
  recovery_score: 'recovery',
  error_recurrence_score: 'error recurrence',
  review_compliance_score: 'review compliance',
  workload_pressure_score: 'workload pressure',
  learning_trajectory: 'learning trajectory',
};

const DIRECTION_TONES = {
  improving: 'success',
  declining: 'rose',
  stable: 'lavender',
  insufficient_data: 'lavender',
} as const;

const CONFIDENCE_TONES = {
  limited: 'champagne',
  moderate: 'lavender',
  strong: 'success',
} as const;

const OVERALL_CONFIRMATION_TONES = {
  limited: 'champagne',
  moderate: 'lavender',
  strong: 'success',
} as const;

type DirectionTone = (typeof DIRECTION_TONES)[keyof typeof DIRECTION_TONES];
type ConfidenceTone = (typeof CONFIDENCE_TONES)[keyof typeof CONFIDENCE_TONES];

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return score.toFixed(2);
}

function isFeatureValue(v: unknown): v is StudentModelFeatureValue {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['score'] === 'number' &&
    typeof o['direction'] === 'string' &&
    typeof o['confidence'] === 'string' &&
    typeof o['sampleSize'] === 'number' &&
    typeof o['evidenceWindowDays'] === 'number'
  );
}

export default function StudentModelPage(): JSX.Element {
  const model = useStudentModel(28);

  const errorCode =
    model.error instanceof ApiError ? model.error.code : undefined;
  const isNotFound = !model.isLoading && errorCode === 'NOT_FOUND';
  const isEmpty = !model.isLoading && (isNotFound || !model.data);
  const isError =
    !isEmpty && !model.isLoading && model.error !== null && model.error !== undefined;

  const data = model.data?.snapshot;
  const features: FeatureRow[] = [];
  if (data) {
    const feats = data.features;
    for (const [key, value] of Object.entries(feats)) {
      if (isFeatureValue(value)) {
        features.push({
          key,
          label: FEATURE_LABELS[key] ?? key,
          value,
        });
      }
    }
  }

  const directionTone = (direction: string): DirectionTone =>
    DIRECTION_TONES[direction as keyof typeof DIRECTION_TONES] ?? 'lavender';
  const confidenceTone = (confidence: string): ConfidenceTone =>
    CONFIDENCE_TONES[confidence as keyof typeof CONFIDENCE_TONES] ?? 'lavender';

  return (
    <PageShell
      title="Student model"
      eyebrow="Advisory"
      description="Snapshot computed by the orchestrator from progress evidence. Read-only here — the page never writes back."
      isLoading={model.isLoading}
      isError={isError}
      error={isError ? model.error : undefined}
      isEmpty={isEmpty}
      emptyTitle="No student-model snapshot yet"
      emptyMessage="The orchestrator writes the first snapshot on its next cycle. Until then, this page is intentionally empty."
    >
      {data ? (
        <article className={styles.detail} data-testid="student-model-snapshot">
          <header className={styles.header}>
            <p className={styles.eyebrow}>Snapshot</p>
            <h1 className={styles.title}>
              {data.userId} · {data.evidenceWindowDays}-day window
            </h1>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Computed at</span>
              <span className={styles.metaMono}>{data.computedAt}</span>
              {data.overallConfidence ? (
                <Badge
                  tone={
                    OVERALL_CONFIRMATION_TONES[
                      data.overallConfidence as keyof typeof OVERALL_CONFIRMATION_TONES
                    ] ?? 'lavender'
                  }
                  size="sm"
                >
                  overall: {data.overallConfidence}
                </Badge>
              ) : null}
            </div>
            <p className={styles.subtitle}>
              Seven features, one confidence ladder. Each row below is the
              latest deterministic value the orchestrator wrote — no live
              scoring, no client-side recompute.
            </p>
          </header>

          <ol className={styles.featureList} data-testid="student-model-features">
            {features.map((f) => (
              <li
                key={f.key}
                className={styles.featureRow}
                data-testid={`student-model-feature-${f.key}`}
              >
                <div className={styles.featureMain}>
                  <div className={styles.featureMeta}>
                    <span className={styles.featureLabel}>{f.label}</span>
                    <span className={styles.featureKey}>{f.key}</span>
                  </div>
                  <p className={styles.featureDescription}>
                    Sample size {f.value.sampleSize} over{' '}
                    {f.value.evidenceWindowDays} days.
                  </p>
                </div>
                <div className={styles.featureAside}>
                  <div className={styles.featureScoreRow}>
                    <span className={styles.featureScoreLabel}>Score</span>
                    <span className={styles.featureScoreValue}>
                      {formatScore(f.value.score)}
                    </span>
                  </div>
                  <div className={styles.featureToneRow}>
                    <Badge tone={directionTone(f.value.direction)} size="sm">
                      {f.value.direction}
                    </Badge>
                    <Badge tone={confidenceTone(f.value.confidence)} size="sm">
                      confidence: {f.value.confidence}
                    </Badge>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </article>
      ) : null}
    </PageShell>
  );
}
