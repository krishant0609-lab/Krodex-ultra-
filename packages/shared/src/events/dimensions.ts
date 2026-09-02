/**
 * KRODEX — analytics dimensions catalog.
 *
 * Per PHASE3_PLAN.md §7.1, this is the static list of measurable
 * dimensions the analytics read model knows about. Phase 3 ships
 * the list and the evidence-query endpoint; Phase 4 fills in the
 * rollup formulas.
 *
 * The dimension list is locked at 13 to match the union in
 * db/enums.ts (ProgressDimension) plus a "composite" placeholder
 * for the Phase 4 composite score. Once Phase 4 lands, this list
 * is append-only; existing keys keep their meaning.
 */

import type { ProgressDimension } from '../db/enums';

export type AnalyticsDimensionKey =
  | ProgressDimension
  | 'composite';

export interface AnalyticsDimensionDescriptor {
  key: AnalyticsDimensionKey;
  label: string;
  /** Maps to a `progress_evidence.dimension` value, or null if the dimension is composite/synthetic. */
  progressDimension: ProgressDimension | null;
  description: string;
  sourceTables: readonly string[];
}

export const ANALYTICS_DIMENSIONS: readonly AnalyticsDimensionDescriptor[] = [
  {
    key: 'syllabus_coverage',
    label: 'Syllabus coverage',
    progressDimension: 'syllabus_coverage',
    description: 'How much of the user\'s declared syllabus has been touched by evidence.',
    sourceTables: ['progress_evidence', 'syllabus_progress'],
  },
  {
    key: 'test_accuracy',
    label: 'Test accuracy',
    progressDimension: 'test_accuracy',
    description: 'Accuracy of submitted test attempts, weighted by attempt size.',
    sourceTables: ['progress_evidence', 'test_attempts', 'test_answers'],
  },
  {
    key: 'test_attempts',
    label: 'Test attempts',
    progressDimension: 'test_attempts',
    description: 'Raw attempt count. Phase 4 derives rate and consistency from this.',
    sourceTables: ['progress_evidence', 'test_attempts'],
  },
  {
    key: 'errors_created',
    label: 'Errors recorded',
    progressDimension: 'errors_created',
    description: 'New errors entered into the Error Bank.',
    sourceTables: ['progress_evidence', 'error_entries'],
  },
  {
    key: 'errors_resolved',
    label: 'Errors resolved',
    progressDimension: 'errors_resolved',
    description: 'Errors that reached the resolved lifecycle state.',
    sourceTables: ['progress_evidence', 'error_entries'],
  },
  {
    key: 'errors_reopened',
    label: 'Errors reopened',
    progressDimension: 'errors_reopened',
    description: 'Errors that recurred after a previous resolution.',
    sourceTables: ['progress_evidence', 'error_entries'],
  },
  {
    key: 'review_completed',
    label: 'Reviews completed',
    progressDimension: 'review_completed',
    description: 'Review outcomes recorded against a schedule.',
    sourceTables: ['progress_evidence', 'review_attempts', 'review_schedules'],
  },
  {
    key: 'planner_completion',
    label: 'Planner completion',
    progressDimension: 'planner_completion',
    description: 'Planner tasks completed vs planned per cycle.',
    sourceTables: ['progress_evidence', 'planner_tasks'],
  },
  {
    key: 'planner_backlog',
    label: 'Planner backlog pressure',
    progressDimension: 'planner_backlog',
    description: 'Backlog size and recovery rate. Backlog pressure is evidence, not a moral judgment.',
    sourceTables: ['progress_evidence', 'backlog_items', 'backlog_recoveries'],
  },
  {
    key: 'backlog_recovered',
    label: 'Backlog recovered',
    progressDimension: 'backlog_recovered',
    description: 'Backlog items the user successfully recovered.',
    sourceTables: ['progress_evidence', 'backlog_recoveries'],
  },
  {
    key: 'consistency',
    label: 'Consistency',
    progressDimension: 'consistency',
    description: 'Day-of-week spread of activity. Computed by Phase 4 from per-day evidence counts.',
    sourceTables: ['progress_evidence'],
  },
  {
    key: 'practice_volume',
    label: 'Practice volume',
    progressDimension: 'practice_volume',
    description: 'Total practice time. Phase 4 derives this from attempt and review durations.',
    sourceTables: ['progress_evidence', 'test_attempts', 'review_attempts'],
  },
  {
    key: 'composite',
    label: 'Composite score',
    progressDimension: null,
    description: 'Phase 4 composite. Decomposable into the dimensions above. Not backed by a single evidence row.',
    sourceTables: ['progress_evidence', 'student_model_snapshots'],
  },
] as const;

export const ANALYTICS_DIMENSION_KEYS: readonly AnalyticsDimensionKey[] =
  ANALYTICS_DIMENSIONS.map((d) => d.key);
