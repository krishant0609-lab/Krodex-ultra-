'use client';

/**
 * KRODEX web — syllabus tree (subjects → topics).
 *
 * Phase 7.5. Renders one SubjectGroup per subject. Each group
 * resolves its own topic list via `useTopics({ subject_id })`.
 * The result is a calm two-level tree:
 *
 *   Subject                          [code]
 *     ├ Topic A                       [Open]
 *     ├ Topic B                       [Open]
 *     └ …
 *
 * Per-group state machine is identical to the dashboard card
 * (loading / empty / error / populated). We never show a fake
 * "0 topics" populated state — empty is its own band.
 *
 * The tree does not pre-fetch sub-topics; sub-topics live on
 * the typed /syllabus/topic/[id] deep link.
 */

import Link from 'next/link';
import { useTopics } from '../../../hooks/use-syllabus';
import { ApiError } from '../../../lib/api-client';
import { Badge } from '../../../components/badge';
import styles from './syllabus.module.css';

export interface SubjectGroupProps {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  isActive: boolean;
}

export function SubjectGroup({
  subjectId,
  subjectCode,
  subjectName,
  isActive,
}: SubjectGroupProps): JSX.Element {
  const topics = useTopics({ subject_id: subjectId });
  const items = topics.data ?? [];
  const truncated = items.slice(0, 24);

  return (
    <section
      className={styles.subjectGroup}
      data-testid={`syllabus-subject-${subjectId}`}
      data-state={topics.isError ? 'error' : topics.isLoading ? 'loading' : items.length === 0 ? 'empty' : 'populated'}
    >
      <div className={styles.subjectHeader}>
        <div className={styles.subjectHeaderTitles}>
          <p className={styles.subjectEyebrow}>
            Subject{isActive ? '' : ' · archived'}
          </p>
          <h2 className={styles.subjectName}>
            <Link
              href={`/syllabus/subject/${subjectId}`}
              className={styles.subjectNameLink}
            >
              {subjectName}
            </Link>
          </h2>
        </div>
        <div className={styles.subjectMeta}>
          {subjectCode ? (
            <span className={styles.subjectCode}>{subjectCode}</span>
          ) : null}
          <Badge tone={isActive ? 'emerald' : 'neutral'} size="sm">
            {isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      {topics.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          data-testid={`syllabus-subject-${subjectId}-loading`}
          className={styles.stateBand}
        >
          <div className={styles.skeletonLine} aria-hidden="true" />
          <div
            className={`${styles.skeletonLine} ${styles.skeletonLineShort}`}
            aria-hidden="true"
          />
        </div>
      ) : null}

      {topics.isError ? (
        <div
          role="alert"
          data-testid={`syllabus-subject-${subjectId}-error`}
          className={styles.stateBand}
        >
          <p className={styles.stateBandTitle}>Couldn&apos;t load topics</p>
          <p className={styles.stateBandBody}>
            {describeTopicsError(topics.error)}
          </p>
        </div>
      ) : null}

      {!topics.isLoading && !topics.isError && items.length === 0 ? (
        <div
          data-testid={`syllabus-subject-${subjectId}-empty`}
          className={styles.stateBand}
        >
          <p className={styles.stateBandTitle}>No topics yet</p>
          <p className={styles.stateBandBody}>
            This subject has no published topics. Check back after the next
            syllabus update.
          </p>
        </div>
      ) : null}

      {!topics.isLoading && !topics.isError && items.length > 0 ? (
        <ul className={styles.topicList}>
          {truncated.map((topic) => (
            <li key={topic.id}>
              <Link
                href={`/syllabus/topic/${topic.id}`}
                className={styles.topicRow}
                data-testid={`syllabus-topic-${topic.id}`}
              >
                <span className={styles.topicTitle}>{topic.name}</span>
                <span className={styles.topicMeta}>
                  {topic.code ? <span>{topic.code}</span> : null}
                  <Badge tone="neutral" size="sm">
                    Open
                  </Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function describeTopicsError(err: unknown): string {
  if (err instanceof ApiError) return `${err.code} (${err.status})`;
  if (err instanceof Error) return err.message;
  return 'Unknown error.';
}
