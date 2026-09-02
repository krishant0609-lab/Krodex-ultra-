'use client';

/**
 * KRODEX web — syllabus index.
 *
 * Phase 7.5 editorial layout. Subjects are surfaced as a single
 * column of cards; each card resolves its own topic list via
 * `useTopics({ subject_id })`. We do not pre-fetch all topics
 * upfront — the per-subject query is cached by queryKeys.topics()
 * so navigating into a subject is instant.
 *
 * No fake data. Empty subjects render a calm dashed band, not a
 * spinner or a fabricated "0 topics" populated state.
 */

import { useMemo } from 'react';
import { PageShell } from '../../../components/page-shell';
import { useSubjects } from '../../../hooks/use-syllabus';
import { SubjectGroup } from './syllabus-tree';
import styles from './syllabus.module.css';

export default function SyllabusPage(): JSX.Element {
  const subjects = useSubjects();
  const items = subjects.data ?? [];

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const ao = a.display_order;
        const bo = b.display_order;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      }),
    [items],
  );

  const totalSubjects = sorted.length;
  const activeSubjects = sorted.filter((s) => s.is_active).length;
  const subtitle = useMemo(() => {
    if (totalSubjects === 0) {
      return 'The syllabus is empty. Subjects appear here once they are published.';
    }
    if (totalSubjects === 1) {
      return 'One subject is available. Open it to see its topics.';
    }
    return `${totalSubjects} subjects available${
      activeSubjects !== totalSubjects ? ` · ${activeSubjects} active` : ''
    }. Open a subject to see its topics.`;
  }, [totalSubjects, activeSubjects]);

  return (
    <PageShell
      title="Syllabus"
      eyebrow="Curriculum"
      isLoading={subjects.isLoading}
      isError={subjects.isError}
      error={subjects.error}
      isEmpty={!subjects.isLoading && totalSubjects === 0}
      emptyTitle="No subjects published"
      emptyMessage="The curriculum has not been published yet. Check back after the next syllabus update."
    >
      <div className={styles.page}>
        <header className={styles.heroStrip}>
          <div className={styles.heroDate}>
            <p className={styles.heroEyebrow}>Syllabus</p>
            <h1 className={styles.heroTitle}>Subjects &amp; topics</h1>
            <p className={styles.heroSubtitle}>{subtitle}</p>
          </div>
        </header>

        <div data-testid="syllabus-tree" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kd-space-10)' }}>
          {sorted.map((subject) => (
            <SubjectGroup
              key={subject.id}
              subjectId={subject.id}
              subjectCode={subject.code}
              subjectName={subject.name}
              isActive={subject.is_active}
            />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
