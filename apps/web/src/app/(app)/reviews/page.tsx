'use client';

import Link from 'next/link';
import { PageShell } from '../../../components/page-shell';
import { useReviewSchedules } from '../../../hooks/use-reviews';

export default function ReviewsPage(): JSX.Element {
  const reviews = useReviewSchedules({ limit: 50 });

  return (
    <PageShell
      title="Reviews"
      description="Scheduled reviews of error entries."
      isLoading={reviews.isLoading}
      isError={reviews.isError}
      error={reviews.error}
      isEmpty={!reviews.isLoading && (reviews.data?.items.length ?? 0) === 0}
      emptyMessage="No reviews scheduled."
    >
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(reviews.data?.items ?? []).map((r) => (
          <li
            key={r.id}
            data-testid={`reviews-item-${r.id}`}
            style={{
              padding: '0.5rem 0',
              borderBottom: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <Link href={`/reviews/${r.id}`}>
              {r.error_id} · {r.state}
            </Link>
            <span style={{ color: '#888', fontSize: '0.875rem' }}>due {r.due_at}</span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
