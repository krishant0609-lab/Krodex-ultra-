/**
 * KRODEX API — ops/event-failures helper.
 *
 * Phase 16 M8. Read-only SQL helper for the new service-role-only
 * `/ops/event-failures` route. Counts `event_log` rows whose
 * `status` is `failed` or `dead_letter` over a time window,
 * grouped by `handler_name`.
 *
 * The shape is intentionally minimal:
 *   - One count per handler.
 *   - A total across all handlers.
 *   - The `since` / `until` window in the response.
 *
 * The helper does NOT read PII. It joins nothing to `users`. The
 * only fields it touches are `event_log.handler_name`,
 * `event_log.status`, and `event_log.last_attempted_at` (used as
 * the time-bucket anchor). The aggregate_id / user_id columns
 * are NOT projected to the response — a `count(*)` over
 * `event_log` filtered by `status` is sufficient for the
 * operational concern ("how many events is this handler
 * currently failing to deliver?").
 *
 * The route that exposes this helper is registered in
 * `apps/api/src/routes/ops.ts`. It is service-role-only and is
 * NOT under `authPreHandler` (same posture as
 * `/analytics/admin/recompute`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { DependencyUnavailableError } from '../errors';

export type EventFailureStatus = 'failed' | 'dead_letter' | 'all';

export interface EventFailureQuery {
  /** ISO timestamp; only event_log rows with last_attempted_at >= since are counted. */
  since: string;
  /** ISO timestamp; only event_log rows with last_attempted_at <= until are counted. */
  until: string;
  /** Which status set to count. Defaults to 'all' (failed + dead_letter). */
  status?: EventFailureStatus;
}

export interface EventFailureBucket {
  handler_name: string;
  failed: number;
  dead_letter: number;
  total: number;
}

export interface EventFailureReport {
  since: string;
  until: string;
  status: EventFailureStatus;
  total: number;
  buckets: readonly EventFailureBucket[];
}

const STATUS_TO_SET: Record<EventFailureStatus, readonly string[]> = {
  failed: ['failed'],
  dead_letter: ['dead_letter'],
  all: ['failed', 'dead_letter'],
};

/**
 * Group event_log failures by handler_name over a time window.
 *
 * Implementation: issue ONE `from('event_log').select(...)` call
 * with a `.gte('last_attempted_at', since).lte('last_attempted_at', until).in('status', [...])`
 * filter, then aggregate in memory. The event_log table is small
 * (one row per (event, handler) attempt) and indexed on
 * (handler_name, status, last_attempted_at) per migration 08, so
 * the filter is the workhorse. We deliberately avoid `rpc()` for
 * the aggregate because the data volume is bounded by the time
 * window — `since/until` are required query parameters.
 */
export async function getEventFailureReport(
  client: SupabaseClient,
  query: EventFailureQuery,
): Promise<EventFailureReport> {
  const status = query.status ?? 'all';
  const allowedStatuses = STATUS_TO_SET[status];

  // The PostgREST fluent chain we need:
  //   from('event_log')
  //     .select('handler_name,status,last_attempted_at')
  //     .gte('last_attempted_at', since)
  //     .lte('last_attempted_at', until)
  //     .in('status', allowedStatuses)
  // The fake-supabase test stub used by the route test supports
  // this exact chain shape (select + eq/gte/lte/in + terminal
  // await for the array result).
  const { data, error } = await client
    .from('event_log')
    .select('handler_name,status,last_attempted_at')
    .gte('last_attempted_at', query.since)
    .lte('last_attempted_at', query.until)
    .in('status', allowedStatuses as string[]);

  if (error) {
    throw new DependencyUnavailableError(
      `event-failures: query failed — ${error.message ?? 'unknown'}`,
    );
  }

  const rows = (data ?? []) as ReadonlyArray<{
    handler_name: string;
    status: string;
  }>;

  // Group by handler_name. The number of handlers is bounded by
  // the application code (~10) and the number of rows is bounded
  // by the time window, so an in-memory reduce is sufficient.
  const grouped = new Map<string, { failed: number; dead_letter: number }>();
  for (const row of rows) {
    const name = row.handler_name;
    const bucket = grouped.get(name) ?? { failed: 0, dead_letter: 0 };
    if (row.status === 'failed') bucket.failed += 1;
    else if (row.status === 'dead_letter') bucket.dead_letter += 1;
    grouped.set(name, bucket);
  }

  const buckets: EventFailureBucket[] = [...grouped.entries()]
    .map(([handler_name, counts]) => ({
      handler_name,
      failed: counts.failed,
      dead_letter: counts.dead_letter,
      total: counts.failed + counts.dead_letter,
    }))
    .sort((a, b) => b.total - a.total || a.handler_name.localeCompare(b.handler_name));

  const total = buckets.reduce((acc, b) => acc + b.total, 0);

  return {
    since: query.since,
    until: query.until,
    status,
    total,
    buckets,
  };
}
