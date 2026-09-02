'use client';

/**
 * KRODEX web — typed topic deep link.
 *
 *   /syllabus/topic/[id]
 *
 * The id is known to be a topic. The page resolves it against
 * the full topic list (`useTopics()` with no filter — the API
 * returns all topics when no subject_id is provided), then
 * looks up the parent subject and the sub-topics under it.
 *
 * If the topic id is not found, the page renders a calm
 * unresolved state — never a fabricated row.
 */

import { use } from '../../../../../lib/react-async';
import Link from 'next/link';
import { PageShell } from '../../../../../components/page-shell';
import { Badge } from '../../../../../components/badge';
import {
  useSubjects,
  useSubTopics,
  useTopics,
} from '../../../../../hooks/use-syllabus';
import { ApiError } from '../../../../../lib/api-client';
import styles from '../../syllabus.module.css';

interface TopicNodePageProps {
  params: Promise<{ id: string }>;
}

export default function TopicNodePage({ params }: TopicNodePageProps): JSX.Element {
  const { id } = use(params);
  const subjects = useSubjects();
  const topics = useTopics();
  const topic = topics.data?.find((t) => t.id === id);
  const parentSubject = topic
    ? subjects.data?.find((s) => s.id === topic.subject_id)
    : undefined;
  const subTopics = useSubTopics(topic?.id);

  if (subjects.isLoading || topics.isLoading) {
    return (
      <PageShell
        title="Loading topic…"
        eyebrow="Syllabus"
        isLoading
      />
    );
  }

  if (subjects.isError) {
    return (
      <PageShell
        title="Topic"
        eyebrow="Syllabus"
        isError
        error={subjects.error}
      />
    );
  }

  if (topics.isError) {
    return (
      <PageShell
        title="Topic"
        eyebrow="Syllabus"
        isError
        error={topics.error}
      />
    );
  }

  if (!topic) {
    return (
      <PageShell
        title="Topic not found"
        eyebrow="Syllabus"
        isEmpty
        emptyTitle="We couldn't find this topic"
        emptyMessage={`No topic matches the id ${id}. It may have been retired, or the link may be incorrect.`}
        emptyAction={
          <Link href="/syllabus" style={{ color: 'var(--kd-color-text-link)' }}>
            Back to syllabus
          </Link>
        }
      />
    );
  }

  const subItems = subTopics.data ?? [];

  return (
    <PageShell
      title={topic.name}
      eyebrow="Topic"
      description={parentSubject ? `Part of ${parentSubject.name}.` : 'Part of a subject.'}
    >
      <div className={styles.page}>
        <header className={styles.nodeHeader}>
          <p className={styles.nodeBreadcrumbs}>
            <Link href="/syllabus" className={styles.nodeBreadcrumbsLink}>
              Syllabus
            </Link>
            <span className={styles.nodeBreadcrumbsSep} aria-hidden="true">
              {' / '}
            </span>
            {parentSubject ? (
              <>
                <Link
                  href={`/syllabus/subject/${parentSubject.id}`}
                  className={styles.nodeBreadcrumbsLink}
                >
                  {parentSubject.name}
                </Link>
                <span className={styles.nodeBreadcrumbsSep} aria-hidden="true">
                  {' / '}
                </span>
              </>
            ) : null}
            <span className={styles.nodeBreadcrumbsCurrent}>{topic.name}</span>
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--kd-space-3)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kd-space-1)' }}>
              <p className={styles.nodeEyebrow}>Topic</p>
              <h1 className={styles.nodeTitle} data-testid="syllabus-node-id">
                {topic.name}
              </h1>
              <p className={styles.nodeSubtitle}>
                {parentSubject
                  ? `Part of ${parentSubject.name}.`
                  : 'Part of a subject in the syllabus.'}
              </p>
            </div>
            <div className={styles.subjectMeta}>
              {topic.code ? (
                <span className={styles.subjectCode}>{topic.code}</span>
              ) : null}
              {topic.syllabus_scope ? (
                <Badge tone="lavender" size="sm">
                  {topic.syllabus_scope}
                </Badge>
              ) : null}
            </div>
          </div>
        </header>

        <div className={styles.nodeContent}>
          <h2
            style={{
              fontSize: 'var(--kd-type-heading-s-size)',
              fontWeight: 'var(--kd-type-heading-s-weight)',
              color: 'var(--kd-color-text-primary)',
              margin: 0,
            }}
          >
            Sub-topics
          </h2>

          {subTopics.isLoading ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="topic-sub-topics-loading"
              className={styles.stateBand}
            >
              <div className={styles.skeletonLine} aria-hidden="true" />
              <div
                className={`${styles.skeletonLine} ${styles.skeletonLineShort}`}
                aria-hidden="true"
              />
            </div>
          ) : null}

          {subTopics.isError ? (
            <div
              role="alert"
              data-testid="topic-sub-topics-error"
              className={styles.stateBand}
            >
              <p className={styles.stateBandTitle}>Couldn&apos;t load sub-topics</p>
              <p className={styles.stateBandBody}>
                {subTopics.error instanceof ApiError
                  ? `${subTopics.error.code} (${subTopics.error.status})`
                  : subTopics.error instanceof Error
                    ? subTopics.error.message
                    : 'Unknown error.'}
              </p>
            </div>
          ) : null}

          {!subTopics.isLoading && !subTopics.isError && subItems.length === 0 ? (
            <div
              data-testid="topic-sub-topics-empty"
              className={styles.stateBand}
            >
              <p className={styles.stateBandTitle}>No sub-topics yet</p>
              <p className={styles.stateBandBody}>
                This topic has no published sub-topics. Questions for this
                topic live on the question bank.
              </p>
            </div>
          ) : null}

          {!subTopics.isLoading && !subTopics.isError && subItems.length > 0 ? (
            <ul
              data-testid="topic-sub-topics-list"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {subItems.map((sub) => (
                <li key={sub.id}>
                  <Link
                    href={`/syllabus/sub-topic/${sub.id}`}
                    className={styles.subTopicRow}
                    data-testid={`topic-sub-topic-${sub.id}`}
                  >
                    <span className={styles.subTopicTitle}>{sub.name}</span>
                    <span className={styles.subTopicMeta}>{sub.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
