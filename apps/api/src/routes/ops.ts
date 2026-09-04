/**
 * KRODEX API — /ops routes.
 *
 *   GET /ops/event-failures?since=<iso>&until=<iso>&status=<s>
 *
 * Phase 16 M8. Returns a read-only count of `event_log` rows
 * whose `status` is `failed` or `dead_letter` (or one of the
 * two, depending on the `status` query param) over a time
 * window, grouped by `handler_name`. Supports the
 * `domain_event_failure_rate` monitor (RUNBOOK §1.1).
 *
 * **Service-role only.** This route is NOT under
 * `authPreHandler`. The handler checks `env.hasServiceRole` and
 * 503s when the service role is not configured (same posture as
 * `/analytics/admin/recompute`). An admin caller is expected to
 * be in a trusted network; there is no user-JWT path.
 *
 * **No PII.** The route reads only `event_log.handler_name`,
 * `event_log.status`, and `event_log.last_attempted_at`. It does
 * NOT join to `users` or any per-account table; no `userId` is
 * echoed in the response.
 *
 * The shape matches the KRODEX success envelope:
 *   { success: true, data: { since, until, status, total, buckets: [...] }, requestId, timestamp }
 *
 * Frozen-boundary note: this file is the **only** new Phase 16
 * route file. The 75 Phase 0–15 routes are unmodified (see
 * `docs/RELEASE_CONTRACTS_v1.0.md` §3).
 */

import type { FastifyInstance } from 'fastify';
import { ok } from './_helpers';
import { parseQuery } from '../validation/parse';
import { OpsEventFailuresQuery } from '../validation/schemas';
import { getServiceClient } from '../db/supabase';
import { getEventFailureReport } from '../ops/event-failures';
import { DependencyUnavailableError, ValidationError } from '../errors';

/** Max window the route will accept. 7 days mirrors RUNBOOK §1.1. */
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function registerOpsRoutes(app: FastifyInstance): void {
  /**
   * GET /ops/event-failures?since=<iso>&until=<iso>&status=<s>
   *
   * Service-role only. Returns a count of `event_log` rows
   * whose `status` is `failed` / `dead_letter` (or both) over
   * a [since, until] time window, grouped by `handler_name`.
   *
   * Error modes:
   *  - 503: env.hasServiceRole is false
   *  - 400: missing or invalid `since` / `until` / `status`,
   *         `since >= until`, or window > 7 days
   *  - 500: dependency error (event_log query failure) — wrapped
   *         in the standard KRODEX error envelope
   */
  app.get('/ops/event-failures', async (req, reply) => {
    const env = app.krodexEnv;
    if (!env.hasServiceRole) {
      throw new DependencyUnavailableError(
        'ops_event_failures: SUPABASE_SERVICE_ROLE_KEY is not configured',
      );
    }

    const q = parseQuery(OpsEventFailuresQuery, req.query);
    const sinceMs = Date.parse(q.since);
    const untilMs = Date.parse(q.until);
    if (Number.isNaN(sinceMs) || Number.isNaN(untilMs)) {
      throw new ValidationError(
        'ops_event_failures: since and until must be valid ISO 8601 timestamps',
      );
    }
    if (sinceMs >= untilMs) {
      throw new ValidationError(
        'ops_event_failures: since must be strictly less than until',
      );
    }
    if (untilMs - sinceMs > MAX_WINDOW_MS) {
      throw new ValidationError(
        'ops_event_failures: window must be at most 7 days',
      );
    }

    const service = getServiceClient(env);
    const report = await getEventFailureReport(service, {
      since: q.since,
      until: q.until,
      ...(q.status ? { status: q.status } : {}),
    });

    return ok(reply, report);
  });
}
