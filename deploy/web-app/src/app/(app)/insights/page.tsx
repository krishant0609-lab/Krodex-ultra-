'use client';

/**
 * KRODEX web — Insights (index).
 *
 *   /insights
 *
 * Phase 7.10 visual layer:
 *  - Eyebrow "Analytics", title "Insights", and a calm
 *    description that names the purpose without fabrication.
 *  - Two editorial sections: Overview and Dimensions. Each
 *    renders the data the API actually returned, formatted
 *    for reading. No JSON dumps, no fabricated insights.
 *  - 7-state contract honored: loading, empty, error,
 *    populated. The empty state is honest: "No analytics
 *    yet" — we do not invent aggregate numbers.
 *  - The aggregate-only page is paired with a footnote that
 *    names the raw-evidence sibling (progress evidence) so
 *    the user knows the source of truth, per Engineering
 *    Support §24.
 *
 * Hooks used (no new server state):
 *  - useAnalyticsOverview()
 *  - useAnalyticsDimensions()
 *
 * The page does not invent values when the API returns a
 * payload it cannot interpret. It renders key/value rows
 * for known shapes, otherwise an honest "no data" note.
 */

import { PageShell } from '../../../components/page-shell';
import { ApiError } from '../../../lib/api-client';
import {
  useAnalyticsDimensions,
  useAnalyticsOverview,
} from '../../../hooks/use-analytics';
import styles from './insights.module.css';

type AnalyticsOverview = Record<string, unknown> | null | undefined;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (isFiniteNumber(v)) {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(3);
  }
  if (isString(v)) return v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (isRecord(v)) return `${Object.keys(v).length} fields`;
  return '—';
}

interface KeyValueProps {
  label: string;
  value: string;
  testId?: string;
}

function KeyValue({ label, value, testId }: KeyValueProps): JSX.Element {
  return (
    <div className={styles.kvRow} data-testid={testId}>
      <span className={styles.kvLabel}>{label}</span>
      <span className={styles.kvValue}>{value}</span>
    </div>
  );
}

function OverviewBlock({ data }: { data: AnalyticsOverview }): JSX.Element {
  if (!isRecord(data)) {
    return (
      <p className={styles.muted}>
        The overview endpoint returned no payload.
      </p>
    );
  }

  const rows: { label: string; value: unknown; testId: string }[] = [];
  for (const [k, v] of Object.entries(data)) {
    rows.push({ label: k, value: v, testId: `insights-overview-${k}` });
  }

  if (rows.length === 0) {
    return (
      <p className={styles.muted}>
        The overview has no rows to show.
      </p>
    );
  }

  return (
    <dl className={styles.kvList} aria-label="Overview metrics">
      {rows.map((r) => (
        <KeyValue
          key={r.label}
          label={r.label}
          value={formatScalar(r.value)}
          testId={r.testId}
        />
      ))}
    </dl>
  );
}

function DimensionsBlock({
  data,
}: {
  data: unknown;
}): JSX.Element {
  if (data === null || data === undefined) {
    return (
      <p className={styles.muted}>
        The dimensions endpoint returned no payload.
      </p>
    );
  }

  if (!isRecord(data) && !Array.isArray(data)) {
    return (
      <p className={styles.muted}>
        Dimensions payload was not a recognized shape.
      </p>
    );
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <p className={styles.muted}>No dimensions registered.</p>;
    }
    return (
      <ul className={styles.dimensionList} data-testid="insights-dimensions-list">
        {data.map((entry, idx) => {
          if (!isRecord(entry)) return null;
          const key = isString(entry['key'])
            ? (entry['key'] as string)
            : `dimension-${idx}`;
          const label = isString(entry['label'])
            ? (entry['label'] as string)
            : isString(entry['name'])
              ? (entry['name'] as string)
              : key;
          return (
            <li
              key={key}
              className={styles.dimensionItem}
              data-testid={`insights-dimension-${key}`}
            >
              <span className={styles.dimensionKey}>{key}</span>
              <span className={styles.dimensionLabel}>{label}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  // Object shape: key → metadata.
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className={styles.muted}>No dimensions registered.</p>;
  }
  return (
    <ul className={styles.dimensionList} data-testid="insights-dimensions-list">
      {entries.map(([key, value]) => {
        const label = isRecord(value) && isString(value['label'])
          ? (value['label'] as string)
          : key;
        return (
          <li
            key={key}
            className={styles.dimensionItem}
            data-testid={`insights-dimension-${key}`}
          >
            <span className={styles.dimensionKey}>{key}</span>
            <span className={styles.dimensionLabel}>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function InsightsPage(): JSX.Element {
  const overview = useAnalyticsOverview();
  const dimensions = useAnalyticsDimensions();

  const overviewHasData = isRecord(overview.data);
  const dimensionsHasData = dimensions.data !== null && dimensions.data !== undefined;
  const isEmpty =
    !overview.isLoading &&
    !overview.isError &&
    !overviewHasData &&
    !dimensions.isLoading &&
    !dimensions.isError &&
    !dimensionsHasData;

  return (
    <PageShell
      title="Insights"
      eyebrow="Analytics"
      description="Aggregated dashboards over progress evidence. The numbers below come from the API; the raw evidence is on the progress page."
      isLoading={overview.isLoading || dimensions.isLoading}
      isError={overview.isError || dimensions.isError}
      error={overview.error ?? dimensions.error}
      isEmpty={isEmpty}
      emptyTitle="No analytics yet"
      emptyMessage="Once the orchestrator has evidence to aggregate, the overview and dimensions will appear here."
    >
      <section className={styles.section} aria-label="Overview">
        <h2 className={styles.sectionHeading}>Overview</h2>
        {overview.isError ? (
          <p className={styles.errorMeta} role="status">
            {overview.error instanceof ApiError
              ? `${overview.error.code} (${overview.error.status})`
              : 'Could not load overview.'}
          </p>
        ) : (
          <OverviewBlock data={overview.data as AnalyticsOverview} />
        )}
      </section>

      <section className={styles.section} aria-label="Dimensions">
        <h2 className={styles.sectionHeading}>Dimensions</h2>
        {dimensions.isError ? (
          <p className={styles.errorMeta} role="status">
            {dimensions.error instanceof ApiError
              ? `${dimensions.error.code} (${dimensions.error.status})`
              : 'Could not load dimensions.'}
          </p>
        ) : (
          <DimensionsBlock data={dimensions.data} />
        )}
      </section>
    </PageShell>
  );
}
