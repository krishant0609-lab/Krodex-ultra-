'use client';

import { PageShell } from '../../../components/page-shell';
import { useStudentModel } from '../../../hooks/use-student-model';

export default function StudentModelPage(): JSX.Element {
  const model = useStudentModel(28);

  // 404 (no snapshot yet) is the cold-start empty state.
  const isEmpty =
    !model.isLoading &&
    (model.error
      ? String((model.error as { code?: string }).code ?? '') === 'NOT_FOUND'
      : !model.data);

  return (
    <PageShell
      title="Student model"
      description="Advisory snapshot, recomputed by the orchestrator. Read-only here."
      isLoading={model.isLoading}
      isError={
        !isEmpty && !model.isLoading && model.error !== null && model.error !== undefined
      }
      error={isEmpty ? undefined : model.error}
      isEmpty={isEmpty}
      emptyMessage="No student-model snapshot yet. The orchestrator writes the first one on the next cycle."
    >
      {model.data ? (
        <pre
          data-testid="student-model-snapshot"
          style={{
            background: '#fafafa',
            padding: '0.75rem',
            border: '1px solid #eee',
            borderRadius: '0.25rem',
            overflow: 'auto',
          }}
        >
          {JSON.stringify(model.data, null, 2)}
        </pre>
      ) : null}
    </PageShell>
  );
}
