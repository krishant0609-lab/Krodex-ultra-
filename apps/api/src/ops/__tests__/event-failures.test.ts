/**
 * KRODEX API — ops/event-failures helper tests.
 *
 * Phase 16 M8. Two mandatory tests:
 *   1. Aggregates event_log rows over the [since, until] window,
 *      bucketing by handler_name and counting failed +
 *      dead_letter. Sums match what the table actually holds.
 *   2. The `status` filter narrows the result: `status=failed`
 *      excludes `dead_letter` rows, and `status=dead_letter`
 *      excludes `failed` rows. `status=all` (default) is the
 *      union.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { getEventFailureReport } from '../event-failures';

const SINCE = '2026-09-01T00:00:00.000Z';
const UNTIL = '2026-09-02T00:00:00.000Z';
const INSIDE = '2026-09-01T12:00:00.000Z';
const OUTSIDE = '2026-08-31T23:59:59.000Z';

describe('getEventFailureReport — Phase 16 M8 helper', () => {
  it('aggregates failed + dead_letter rows by handler_name within the window', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_log: [
          { handler_name: 'project_notification', status: 'failed', last_attempted_at: INSIDE },
          { handler_name: 'project_notification', status: 'failed', last_attempted_at: INSIDE },
          { handler_name: 'project_notification', status: 'dead_letter', last_attempted_at: INSIDE },
          { handler_name: 'student_model_recompute', status: 'failed', last_attempted_at: INSIDE },
          { handler_name: 'student_model_recompute', status: 'succeeded', last_attempted_at: INSIDE },
          { handler_name: 'project_notification', status: 'failed', last_attempted_at: OUTSIDE },
        ],
      },
    });

    const report = await getEventFailureReport(client, { since: SINCE, until: UNTIL });

    expect(report.since).toBe(SINCE);
    expect(report.until).toBe(UNTIL);
    expect(report.status).toBe('all');
    expect(report.total).toBe(4); // 3 project_notification + 1 student_model_recompute
    const byHandler = Object.fromEntries(report.buckets.map((b) => [b.handler_name, b]));
    expect(byHandler['project_notification']).toEqual({
      handler_name: 'project_notification',
      failed: 2,
      dead_letter: 1,
      total: 3,
    });
    expect(byHandler['student_model_recompute']).toEqual({
      handler_name: 'student_model_recompute',
      failed: 1,
      dead_letter: 0,
      total: 1,
    });
    // Buckets are sorted by total desc, then handler_name asc.
    expect(report.buckets[0]?.handler_name).toBe('project_notification');
    expect(report.buckets[1]?.handler_name).toBe('student_model_recompute');
  });

  it('the status filter narrows the result to failed or dead_letter only', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_log: [
          { handler_name: 'project_notification', status: 'failed', last_attempted_at: INSIDE },
          { handler_name: 'project_notification', status: 'dead_letter', last_attempted_at: INSIDE },
          { handler_name: 'student_model_recompute', status: 'dead_letter', last_attempted_at: INSIDE },
        ],
      },
    });

    const failedOnly = await getEventFailureReport(client, {
      since: SINCE,
      until: UNTIL,
      status: 'failed',
    });
    expect(failedOnly.status).toBe('failed');
    expect(failedOnly.total).toBe(1);
    expect(failedOnly.buckets).toHaveLength(1);
    expect(failedOnly.buckets[0]).toEqual({
      handler_name: 'project_notification',
      failed: 1,
      dead_letter: 0,
      total: 1,
    });

    const dlqOnly = await getEventFailureReport(client, {
      since: SINCE,
      until: UNTIL,
      status: 'dead_letter',
    });
    expect(dlqOnly.status).toBe('dead_letter');
    expect(dlqOnly.total).toBe(2);
    expect(dlqOnly.buckets.map((b) => b.handler_name).sort()).toEqual([
      'project_notification',
      'student_model_recompute',
    ]);
    for (const b of dlqOnly.buckets) {
      expect(b.dead_letter).toBeGreaterThan(0);
      expect(b.failed).toBe(0);
    }
  });
});
