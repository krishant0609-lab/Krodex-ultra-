'use client';

import { PageShell } from '../../../components/page-shell';
import { useBacklogItems } from '../../../hooks/use-backlog';

export default function BacklogPage(): JSX.Element {
  const backlog = useBacklogItems({ state: 'open', limit: 50 });

  return (
    <PageShell
      title="Backlog"
      description="Open missed items you can recover or drop."
      isLoading={backlog.isLoading}
      isError={backlog.isError}
      error={backlog.error}
      isEmpty={!backlog.isLoading && (backlog.data?.items.length ?? 0) === 0}
      emptyMessage="No backlog items."
    >
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(backlog.data?.items ?? []).map((b) => (
          <li
            key={b.id}
            data-testid={`backlog-item-${b.id}`}
            style={{
              padding: '0.5rem 0',
              borderBottom: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{b.source_task_id}</span>
            <span style={{ color: '#888', fontSize: '0.875rem' }}>
              {b.reason} · opened {b.created_at}
            </span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
