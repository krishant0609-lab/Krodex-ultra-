'use client';

import Link from 'next/link';
import { PageShell } from '../../../components/page-shell';
import { useErrorEntries } from '../../../hooks/use-errors';

export default function ErrorsPage(): JSX.Element {
  const errors = useErrorEntries({ limit: 50 });

  return (
    <PageShell
      title="Error bank"
      description="Mistakes you've recorded. Click a row to open its detail."
      isLoading={errors.isLoading}
      isError={errors.isError}
      error={errors.error}
      isEmpty={!errors.isLoading && (errors.data?.items.length ?? 0) === 0}
      emptyMessage="No errors recorded yet."
    >
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(errors.data?.items ?? []).map((entry) => (
          <li
            key={entry.id}
            data-testid={`errors-item-${entry.id}`}
            style={{
              padding: '0.5rem 0',
              borderBottom: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <Link href={`/errors/${entry.id}`}>
              {entry.mistake_type ?? 'unknown'} · {entry.status}
            </Link>
            <span style={{ color: '#888', fontSize: '0.875rem' }}>
              recurrences: {entry.recurrence_count}
            </span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
