'use client';

/**
 * KRODEX web — typed subject deep link.
 *
 *   /syllabus/subject/[id]
 *
 * The id is known to be a subject. The page reads the cached
 * `useSubjects()` list, finds the row, and renders the topics
 * for that subject. The list is shared with the index page via
 * `queryKeys.subjects()` so opening a typed deep link is
 * instant on a warm cache.
 *
 * If the id is not found, the page renders a calm unresolved
 * state — never a fabricated row.
 */

import { use, type ReactNode } from '../../../../../lib/react-async';
import Link from 'next/link';
import { PageShell } from '../../../../../components/page-shell';
import { Badge } from '../../../../../components/badge';
import { useSubjects, useTopics } from '../../../../../hooks/use-syllabus';
import styles from '../../syllabus.module.css';

interface SubjectNodePageProps {
  params: Promise<{ id: string }>;
}

export default function SubjectNodePage({ params }: SubjectNodePageProps): JSX.Element {
  const { id } = use(params);
  const subjects = useSubjects();
  const subject = subjects.data?.find((s) => s.id === id);
  const topics = useTopics(subject ? { subject_id: subject.id } : undefined);
  const topicItems = topics.data ?? [];

  if (subjects.isLoading) {
    return (
      <PageShell
        title="Loading subject…"
        eyebrow="Syllabus"
        isLoading
      />
    );
  }

  if (subjects.isError) {
    return (
      <PageShell
        title="Subject"
        eyebrow="Syllabus"
        isError
        error={subjects.error}
      />
    );
  }

  if (!subject) {
    return (
      <PageShell
        title="Subject not found"
        eyebrow="Syllabus"
        isEmpty
        emptyTitle="We couldn't find this subject"
        emptyMessage={`No subject matches the id ${id}. It may have been retired, or the link may be incorrect.`}
        emptyAction={
          <Link href="/syllabus" style={{ color: 'var(--kd-color-text-link)' }}>
            Back to syllabus
          </Link>
        }
      />
    );
  }

  return (
    <PageShell
      title={subject.name}
      eyebrow="Subject"
      description={
        subject.is_active
          ? 'Active subject. Topics below are the live curriculum.'
          : 'Archived subject. Topics below are read-only.'
      }
    >
      <div className={styles.page}>
        <NodeHeader
          breadcrumbs={[
            { label: 'Syllabus', href: '/syllabus' },
            { label: subject.name },
          ]}
          eyebrow="Subject"
          title={subject.name}
          subtitle={
            subject.is_active
              ? 'Active subject. Topics below are the live curriculum.'
              : 'Archived subject. Topics below are read-only.'
          }
          meta={
            <>
              {subject.code ? (
                <span className={styles.subjectCode}>{subject.code}</span>
              ) : null}
              <Badge tone={subject.is_active ? 'emerald' : 'neutral'} size="sm">
                {subject.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </>
          }
        />

        <div className={styles.nodeContent}>
          <h2
            style={{
              fontSize: 'var(--kd-type-heading-s-size)',
              fontWeight: 'var(--kd-type-heading-s-weight)',
              color: 'var(--kd-color-text-primary)',
              margin: 0,
            }}
          >
            Topics
          </h2>

          {topics.isLoading ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="subject-topics-loading"
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
              data-testid="subject-topics-error"
              className={styles.stateBand}
            >
              <p className={styles.stateBandTitle}>Couldn&apos;t load topics</p>
              <p className={styles.stateBandBody}>
                The topic list for this subject could not be reached. Try
                returning to the syllabus index and re-opening this subject.
              </p>
            </div>
          ) : null}

          {!topics.isLoading && !topics.isError && topicItems.length === 0 ? (
            <div
              data-testid="subject-topics-empty"
              className={styles.stateBand}
            >
              <p className={styles.stateBandTitle}>No topics yet</p>
              <p className={styles.stateBandBody}>
                This subject has no published topics. Check back after the next
                syllabus update.
              </p>
            </div>
          ) : null}

          {!topics.isLoading && !topics.isError && topicItems.length > 0 ? (
            <ul className={styles.topicList}>
              {topicItems.map((topic) => (
                <li key={topic.id}>
                  <Link
                    href={`/syllabus/topic/${topic.id}`}
                    className={styles.topicRow}
                    data-testid={`subject-topic-${topic.id}`}
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
        </div>
      </div>
    </PageShell>
  );
}

interface NodeHeaderProps {
  breadcrumbs: ReadonlyArray<{ label: string; href?: string }>;
  eyebrow: string;
  title: string;
  subtitle: string;
  meta?: ReactNode;
}

function NodeHeader({ breadcrumbs, eyebrow, title, subtitle, meta }: NodeHeaderProps): JSX.Element {
  return (
    <header className={styles.nodeHeader}>
      <p className={styles.nodeBreadcrumbs}>
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={`${crumb.label}-${i}`}>
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className={styles.nodeBreadcrumbsLink}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={
                    isLast ? styles.nodeBreadcrumbsCurrent : styles.nodeBreadcrumbsLink
                  }
                >
                  {crumb.label}
                </span>
              )}
              {!isLast ? (
                <span className={styles.nodeBreadcrumbsSep} aria-hidden="true">
                  {' / '}
                </span>
              ) : null}
            </span>
          );
        })}
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
          <p className={styles.nodeEyebrow}>{eyebrow}</p>
          <h1 className={styles.nodeTitle} data-testid="syllabus-node-id">
            {title}
          </h1>
          <p className={styles.nodeSubtitle}>{subtitle}</p>
        </div>
        {meta ? <div className={styles.subjectMeta}>{meta}</div> : null}
      </div>
    </header>
  );
}
