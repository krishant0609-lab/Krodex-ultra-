'use client';

import { PageShell } from '../../../components/page-shell';
import {
  useAnalyticsDimensions,
  useAnalyticsOverview,
} from '../../../hooks/use-analytics';

export default function InsightsPage(): JSX.Element {
  const overview = useAnalyticsOverview();
  const dimensions = useAnalyticsDimensions();

  return (
    <PageShell
      title="Insights"
      description="Aggregated dashboards. Raw evidence is on the progress page."
      isLoading={overview.isLoading}
      isError={overview.isError}
      error={overview.error}
      isEmpty={
        !overview.isLoading && !overview.data
      }
      emptyMessage="No analytics yet."
    >
      <section>
        <h2 style={{ fontSize: '1.125rem', margin: '0 0 0.5rem' }}>Overview</h2>
        <pre
          data-testid="insights-overview"
          style={{
            background: '#fafafa',
            padding: '0.75rem',
            border: '1px solid #eee',
            borderRadius: '0.25rem',
            overflow: 'auto',
          }}
        >
          {JSON.stringify(overview.data, null, 2)}
        </pre>
      </section>

      <section>
        <h2 style={{ fontSize: '1.125rem', margin: '0 0 0.5rem' }}>Dimensions</h2>
        {dimensions.isLoading ? (
          <p style={{ color: '#555' }}>Loading dimensions…</p>
        ) : dimensions.isError ? (
          <p role="alert" style={{ color: '#842029' }}>
            Could not load dimensions.
          </p>
        ) : (
          <pre
            data-testid="insights-dimensions"
            style={{
              background: '#fafafa',
              padding: '0.75rem',
              border: '1px solid #eee',
              borderRadius: '0.25rem',
              overflow: 'auto',
            }}
          >
            {JSON.stringify(dimensions.data, null, 2)}
          </pre>
        )}
      </section>
    </PageShell>
  );
}
