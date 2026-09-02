'use client';

import { use } from 'react';
import { PageShell } from '../../../../components/page-shell';
import {
  useRecordReviewAttempt,
  useReviewSchedule,
  useUpdateReviewSchedule,
} from '../../../../hooks/use-reviews';

interface ReviewDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ReviewDetailPage({ params }: ReviewDetailPageProps): JSX.Element {
  const { id } = use(params);
  const schedule = useReviewSchedule(id);
  const update = useUpdateReviewSchedule(id);
  const record = useRecordReviewAttempt(id);

  return (
    <PageShell
      title="Review"
      description={`Review ${id}.`}
      isLoading={schedule.isLoading}
      isError={schedule.isError}
      error={schedule.error}
      isEmpty={!schedule.isLoading && !schedule.data}
      emptyMessage="Review not found."
      actions={
        schedule.data ? (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() =>
                update.mutate({ state: 'completed', outcome: 'passed' })
              }
              disabled={update.isPending}
              data-testid="review-mark-passed"
              style={{
                padding: '0.4rem 0.75rem',
                border: '1px solid #111',
                background: '#111',
                color: '#fff',
                borderRadius: '0.25rem',
              }}
            >
              Mark passed
            </button>
            <button
              type="button"
              onClick={() => {
                if (!schedule.data) return;
                record.mutate({
                  schedule_id: id,
                  question_id: schedule.data.error_id,
                  outcome: 'failed',
                  selected_option_ids: [],
                });
              }}
              disabled={record.isPending}
              data-testid="review-mark-failed"
              style={{
                padding: '0.4rem 0.75rem',
                border: '1px solid #111',
                background: '#fff',
                color: '#111',
                borderRadius: '0.25rem',
              }}
            >
              Record failed attempt
            </button>
          </div>
        ) : null
      }
    >
      {schedule.data ? (
        <dl style={{ display: 'grid', gridTemplateColumns: '8rem 1fr', gap: '0.25rem 0.5rem' }}>
          <dt>State</dt>
          <dd style={{ margin: 0 }}>{schedule.data.state}</dd>
          <dt>Strategy</dt>
          <dd style={{ margin: 0 }}>{schedule.data.strategy}</dd>
          <dt>Due</dt>
          <dd style={{ margin: 0 }}>{schedule.data.due_at}</dd>
        </dl>
      ) : null}
    </PageShell>
  );
}
