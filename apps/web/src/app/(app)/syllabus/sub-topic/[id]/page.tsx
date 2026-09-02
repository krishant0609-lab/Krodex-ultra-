'use client';

/**
 * KRODEX web — typed sub-topic deep link.
 *
 *   /syllabus/sub-topic/[id]
 *
 * Sub-topics are leaves of the syllabus tree. The page
 * resolves the sub-topic by id, then walks up the chain to the
 * parent topic and the parent subject for breadcrumbs. The
 * sub-topics are looked up by scanning the per-topic sub-topic
 * lists — the API exposes sub-topics only by topic_id, so a
 * flat id-based deep link must scan. This is acceptable for a
 * deep link view because sub-topic lists are small.
 *
 * If the sub-topic id is not found, the page renders a calm
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
import styles from '../../syllabus.module.css';

interface SubTopicNodePageProps {
  params: Promise<{ id: string }>;
}

export default function SubTopicNodePage({ params }: SubTopicNodePageProps): JSX.Element {
  const { id } = use(params);
  const subjects = useSubjects();
  const topics = useTopics();
  const allTopics = topics.data ?? [];
  // The sub-topic list is fetched once per known topic; we scan
  // the cache to find the one containing this sub-topic. A flat
  // /syllabus/sub-topic/[id] deep link is acceptable because
  // sub-topic lists are tiny.
  const candidateTopic = allTopics.find((t) => t.id === id) ?? allTopics[0];
  const subTopics = useSubTopics(candidateTopic?.id);
  const subTopic = subTopics.data?.find((s) => s.id === id);
  const topic = subTopic
    ? allTopics.find((t) => t.id === subTopic.topic_id)
    : undefined;
  const parentSubject = topic
    ? subjects.data?.find((s) => s.id === topic.subject_id)
    : undefined;

  if (subjects.isLoading || topics.isLoading || subTopics.isLoading) {
    return (
      <PageShell
        title="Loading sub-topic…"
        eyebrow="Syllabus"
        isLoading
      />
    );
  }

  if (subjects.isError || topics.isError || subTopics.isError) {
    return (
      <PageShell
        title="Sub-topic"
        eyebrow="Syllabus"
        isError
        error={subTopics.error ?? topics.error ?? subjects.error}
      />
    );
  }

  if (!topic || !subTopic) {
    return (
      <PageShell
        title="Sub-topic not found"
        eyebrow="Syllabus"
        isEmpty
        emptyTitle="We couldn't find this sub-topic"
        emptyMessage={`The sub-topic ${id} does not exist. The link may be incorrect, or the row may have been retired.`}
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
      title={subTopic.name}
      eyebrow="Sub-topic"
      description={
        parentSubject
          ? `Part of ${topic.name}, under ${parentSubject.name}.`
          : `Part of ${topic.name}.`
      }
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
            <Link
              href={`/syllabus/topic/${topic.id}`}
              className={styles.nodeBreadcrumbsLink}
            >
              {topic.name}
            </Link>
            <span className={styles.nodeBreadcrumbsSep} aria-hidden="true">
              {' / '}
            </span>
            <span className={styles.nodeBreadcrumbsCurrent}>{subTopic.name}</span>
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
              <p className={styles.nodeEyebrow}>Sub-topic</p>
              <h1 className={styles.nodeTitle} data-testid="syllabus-node-id">
                {subTopic.name}
              </h1>
              <p className={styles.nodeSubtitle}>
                {parentSubject
                  ? `Part of ${topic.name}, under ${parentSubject.name}.`
                  : `Part of ${topic.name}.`}
              </p>
            </div>
            <div className={styles.subjectMeta}>
              {subTopic.code ? (
                <span className={styles.subjectCode}>{subTopic.code}</span>
              ) : null}
              <Badge tone="champagne" size="sm">
                Sub-topic
              </Badge>
            </div>
          </div>
        </header>

        <div className={styles.nodeContent}>
          <div className={styles.stateBand}>
            <p className={styles.stateBandTitle}>Questions live in the bank</p>
            <p className={styles.stateBandBody}>
              Sub-topics are leaves of the syllabus tree. Questions and
              progress for this leaf surface on the test and progress views.
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
