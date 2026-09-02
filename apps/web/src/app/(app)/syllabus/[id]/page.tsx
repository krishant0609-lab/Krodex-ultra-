'use client';

/**
 * KRODEX web — legacy syllabus deep link.
 *
 *   /syllabus/[id]
 *
 * Phase 7.5 keeps this as a graceful fallback. The id is opaque
 * and we don't have a `/syllabus/nodes/:id` endpoint. The page
 * scans the cached `useSubjects()` list (cheap) and, if the id
 * matches a subject, surfaces a link to the typed
 * `/syllabus/subject/[id]` view.
 *
 * Otherwise it renders a calm unresolved state. We never
 * fabricate a row from the raw id.
 */

import { use } from '../../../../lib/react-async';
import Link from 'next/link';
import { PageShell } from '../../../../components/page-shell';
import { useSubjects } from '../../../../hooks/use-syllabus';

interface NodePageProps {
  params: Promise<{ id: string }>;
}

export default function SyllabusNodePage({ params }: NodePageProps): JSX.Element {
  const { id } = use(params);
  const subjects = useSubjects();
  const subject = subjects.data?.find((s) => s.id === id);

  if (subjects.isLoading) {
    return (
      <PageShell
        title="Syllabus node"
        eyebrow="Syllabus"
        isLoading
      />
    );
  }

  if (subjects.isError) {
    return (
      <PageShell
        title="Syllabus node"
        eyebrow="Syllabus"
        isError
        error={subjects.error}
      />
    );
  }

  if (subject) {
    return (
      <PageShell
        title={subject.name}
        eyebrow="Syllabus"
        description="Subject deep link."
        actions={
          <Link
            href={`/syllabus/subject/${subject.id}`}
            style={{ color: 'var(--kd-color-text-link)' }}
          >
            Open subject
          </Link>
        }
      >
        <p style={{ margin: 0 }}>
          <code data-testid="syllabus-node-id">{id}</code>
        </p>
        <p style={{ color: 'var(--kd-color-text-secondary)' }}>
          The typed subject view is at /syllabus/subject/{subject.id}.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Syllabus node"
      eyebrow="Syllabus"
      isEmpty
      emptyTitle="Unresolved syllabus node"
      emptyMessage={`The id ${id} did not match a subject, a topic, or a sub-topic. Open the syllabus index to find your way.`}
      emptyAction={
        <Link
          href="/syllabus"
          style={{ color: 'var(--kd-color-text-link)' }}
        >
          Back to syllabus
        </Link>
      }
    >
      <p style={{ margin: 0 }}>
        <code data-testid="syllabus-node-id">{id}</code>
      </p>
      <p style={{ color: 'var(--kd-color-text-secondary)' }}>
        Use a typed deep link: /syllabus/subject/&lt;id&gt;, /syllabus/topic/&lt;id&gt;,
        or /syllabus/sub-topic/&lt;id&gt;.
      </p>
    </PageShell>
  );
}
