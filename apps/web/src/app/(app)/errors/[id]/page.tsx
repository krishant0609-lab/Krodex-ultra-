'use client';

import { use } from 'react';
import { PageShell } from '../../../../components/page-shell';
import { useErrorEntry, useUpdateErrorEntry } from '../../../../hooks/use-errors';

interface ErrorDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ErrorDetailPage({ params }: ErrorDetailPageProps): JSX.Element {
  const { id } = use(params);
  const entry = useErrorEntry(id);
  const update = useUpdateErrorEntry(id);

  return (
    <PageShell
      title="Error entry"
      description={`Error ${id}.`}
      isLoading={entry.isLoading}
      isError={entry.isError}
      error={entry.error}
      isEmpty={!entry.isLoading && !entry.data}
      emptyMessage="Error entry not found."
      actions={
        entry.data?.status !== 'resolved' ? (
          <button
            type="button"
            onClick={() => update.mutate({ status: 'resolved' })}
            disabled={update.isPending}
            data-testid="error-mark-resolved"
            style={{
              padding: '0.4rem 0.75rem',
              border: '1px solid #111',
              background: '#fff',
              color: '#111',
              borderRadius: '0.25rem',
            }}
          >
            {update.isPending ? 'Saving…' : 'Mark resolved'}
          </button>
        ) : null
      }
    >
      {entry.data ? (
        <dl style={{ display: 'grid', gridTemplateColumns: '10rem 1fr', gap: '0.25rem 0.5rem' }}>
          <dt>Mistake type</dt>
          <dd style={{ margin: 0 }}>{entry.data.mistake_type ?? 'unknown'}</dd>
          <dt>Status</dt>
          <dd style={{ margin: 0 }}>{entry.data.status}</dd>
          <dt>Recurrence</dt>
          <dd style={{ margin: 0 }}>{entry.data.recurrence_count}</dd>
          <dt>Remark</dt>
          <dd style={{ margin: 0 }}>{entry.data.remark ?? '—'}</dd>
        </dl>
      ) : null}
      {update.isError ? (
        <p role="alert" style={{ color: '#842029' }}>
          Update failed.
        </p>
      ) : null}
    </PageShell>
  );
}
