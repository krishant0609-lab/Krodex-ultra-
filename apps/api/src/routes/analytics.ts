/**
 * KRODEX API — /analytics routes.
 *
 *   GET /analytics/dimensions                       — canonical dimension catalog
 *   GET /analytics/evidence?dimension=...           — list progress evidence + freshness
 *   GET /analytics/dashboards/overview              — three summary numbers + 6 PRD §24 metrics
 *   GET /analytics/dashboards/dimension/:key        — per-dimension deep dive (Phase 4)
 *   GET /analytics/dashboards/dimension/:key/explain— explain block for a dimension (Phase 4)
 *   POST /analytics/admin/recompute                 — service-role rollup recompute (Phase 4)
 *
 * All routes except /admin/recompute require an authenticated
 * user. The admin route is service-role only: it reads its
 * service-role key from the env's service client and refuses
 * to operate without one.
 *
 * Per PHASE3_PLAN.md §7 + PHASE4_PLAN.md §12, the Phase 4
 * routes ship alongside the Phase 3 routes. They read from
 * the analytics_daily_rollup / analytics_weekly_rollup tables
 * (migration 12) and apply the formulas from
 * `apps/api/src/analytics/`.
 *
 * Class A: the metric formulas + the drill-down contract.
 * Class C — Approved Product Policy: the D-2/D-3/D-4 policies
 * applied inside the services, the D-9 5-minute window, and
 * the admin recompute's default 5-minute window.
 */

import type { FastifyInstance } from 'fastify';
import type { ProgressEvidenceRow } from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  AdminRecomputeBody,
  DimensionKeyParam,
  ListProgressEvidenceQuery,
} from '../validation/schemas';
import * as progress from '../services/progress';
import { getAnalyticsDimensions } from '../services/analytics-dimensions';
import { getAnalyticsFreshness } from '../services/analytics-freshness';
import { getAnalyticsOverview } from '../services/analytics-dashboards';
import { getDimensionDashboard } from '../services/analytics-dimension-dashboard';
import { getDimensionExplain } from '../services/analytics-dimension-explain';
import { adminRecompute } from '../services/analytics-admin-recompute';
import { getServiceClient } from '../db/supabase';
import { DependencyUnavailableError, ForbiddenError } from '../errors';

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  /**
   * GET /analytics/dimensions
   * Returns the canonical 13-dimension catalog + the schema
   * version + the KRODEX server build version. No DB read.
   */
  app.get('/analytics/dimensions', { preHandler: app.authPreHandler }, async (_req, reply) => {
    return ok(reply, getAnalyticsDimensions());
  });

  /**
   * GET /analytics/evidence
   * Same shape as Phase 2's /progress/evidence; the only
   * addition is a `freshness` block on the envelope so clients
   * can show "Updated N seconds ago" honestly.
   */
  app.get('/analytics/evidence', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListProgressEvidenceQuery, req.query);
    const [items, freshness] = await Promise.all([
      progress.listProgressEvidence(req.supabaseUser, auth.userId, {
        ...(q.dimension ? { dimension: q.dimension } : {}),
        ...(q.since ? { since: q.since } : {}),
        ...(q.until ? { until: q.until } : {}),
        ...(q.limit !== undefined ? { limit: q.limit } : {}),
      }),
      getAnalyticsFreshness(req.supabaseUser, auth.userId),
    ]);
    return ok<{ items: readonly ProgressEvidenceRow[]; freshness: typeof freshness }>(reply, {
      items,
      freshness,
    });
  });

  /**
   * GET /analytics/dashboards/overview
   * Returns the three summary-card numbers + the six PRD §24
   * metrics + the composite (Phase 4). Always-fresh; never
   * cached. The window is the trailing 7 days (Class C —
   * Approved Product Policy).
   */
  app.get('/analytics/dashboards/overview', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const overview = await getAnalyticsOverview(req.supabaseUser, auth.userId);
    return ok(reply, overview);
  });

  /**
   * GET /analytics/dashboards/dimension/:key
   * Per-dimension deep dive (Phase 4, PHASE4_PLAN.md §12.2).
   * Returns the 7-day metric + daily series + trend direction
   * (D-3) + evidence threshold (D-2) + drill-down IDs (TRD
   * §18:737-740) + explanation (D-10) + composite contribution.
   * The `:key` is validated as one of the six PRD §24 metric
   * keys; unknown keys return 400 via the params schema.
   */
  app.get(
    '/analytics/dashboards/dimension/:key',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(DimensionKeyParam, req.params);
      const dash = await getDimensionDashboard(req.supabaseUser, auth.userId, params.key);
      return ok(reply, dash);
    },
  );

  /**
   * GET /analytics/dashboards/dimension/:key/explain
   * Strict-subset of the dimension dashboard. Optimized for
   * "why is this number X?" tooltips. Carries
   * `templateVersion` from D-10 so a future revision is
   * detectable client-side.
   */
  app.get(
    '/analytics/dashboards/dimension/:key/explain',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(DimensionKeyParam, req.params);
      const explainBlock = await getDimensionExplain(req.supabaseUser, auth.userId, params.key);
      return ok(reply, explainBlock);
    },
  );

  /**
   * POST /analytics/admin/recompute
   * Service-role-only. Invokes the SECURITY DEFINER SQL
   * function `recompute_analytics_rollup(p_user_id, p_since,
   * p_until)` for one user. Idempotent. Default window is the
   * trailing 5 minutes (D-9, Class C — Approved Product
   * Policy).
   *
   * Gating: the route is NOT under `authPreHandler`. The
   * handler checks `env.hasServiceRole` and 503s when the
   * service role is not configured. There is no user-JWT
   * path; an admin caller is expected to be in a trusted
   * network (the route is a no-auth service endpoint that
   * is intended to be reached via the API's internal
   * network).
   */
  app.post('/analytics/admin/recompute', async (req, reply) => {
    const env = app.krodexEnv;
    if (!env.hasServiceRole) {
      throw new DependencyUnavailableError(
        'analytics_admin_recompute: SUPABASE_SERVICE_ROLE_KEY is not configured',
      );
    }
    const body = parseBody(AdminRecomputeBody, req.body ?? {});
    if (body.user_id) {
      // Per-user recompute is the supported path.
    } else {
      // The batch path is owned by the scheduled job; the admin
      // route refuses it so operators don't accidentally bypass
      // the 5-minute cadence.
      throw new ForbiddenError(
        'analytics_admin_recompute: user_id is required (batch recompute is owned by the scheduled job)',
      );
    }
    const service = getServiceClient(env);
    const result = await adminRecompute({
      client: service,
      userId: body.user_id,
      ...(body.since ? { since: new Date(body.since) } : {}),
      ...(body.until ? { until: new Date(body.until) } : {}),
      logger: req.log,
    });
    return ok(reply, result);
  });
}
