/**
 * KRODEX API — analytics admin recompute service.
 *
 * Per PHASE4_PLAN.md §13.1, `POST /analytics/admin/recompute`
 * is a service-role-only endpoint that invokes the SECURITY
 * DEFINER SQL function `recompute_analytics_rollup(p_user_id,
 * p_since, p_until)` for one user (or all active users in a
 * window). The function is idempotent: re-running it inside
 * the same window produces the same state with the same row
 * count.
 *
 * The route is gated by `app.requireServiceRole` (not the
 * user JWT pre-handler). The handler returns a structured
 * result: rowsRecomputed + the per-user breakdown when a
 * single user is specified.
 *
 * The 5-minute window default comes from D-9 (Class C —
 * Approved Product Policy). Operators can pass a wider
 * window for a cold start (e.g. 7 days), but the daily path
 * always uses the 5-minute trailing window.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  recomputeRollupForUser,
  type RecomputeResult,
} from '../analytics/rollup';

const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTE_MS = 5 * ONE_MINUTE_MS;

export interface AdminRecomputeInput {
  /** Service-role Supabase client. */
  client: SupabaseClient;
  /** The user to recompute. When omitted, all active users in the window are recomputed. */
  userId?: string;
  /** Window start. Defaults to `now - 5 minutes` (D-9, Class C). */
  since?: Date;
  /** Window end. Defaults to `now`. */
  until?: Date;
  /** Logger. */
  logger: { info: Function; warn: Function; error: Function };
}

export interface AdminRecomputeOutput {
  /** True when the SQL call succeeded for at least one user. */
  ok: boolean;
  /** The window used. */
  window: { since: string; until: string };
  /** When a single user is specified: the per-user row count. */
  rowsRecomputed: number;
  /** When a single user is specified: the user id. */
  userId?: string;
  /** Error message when ok is false. */
  error?: string;
}

/**
 * Run the admin recompute for one user. The route layer calls
 * this; the per-user path is the common case (the 5-minute
 * scheduled job already covers the per-active-user path).
 */
export async function adminRecompute(
  input: AdminRecomputeInput,
): Promise<AdminRecomputeOutput> {
  const now = new Date();
  const since = input.since ?? new Date(now.getTime() - FIVE_MINUTE_MS);
  const until = input.until ?? now;
  const userId = input.userId;

  if (!userId) {
    return {
      ok: false,
      window: { since: since.toISOString(), until: until.toISOString() },
      rowsRecomputed: 0,
      error: 'admin_recompute: user_id is required (batch path is owned by the scheduled job)',
    };
  }

  let result: RecomputeResult;
  try {
    result = await recomputeRollupForUser(input.client, { userId, since, until });
  } catch (err) {
    input.logger.error(
      { err, userId, since: since.toISOString(), until: until.toISOString() },
      'admin_recompute.failed',
    );
    return {
      ok: false,
      window: { since: since.toISOString(), until: until.toISOString() },
      rowsRecomputed: 0,
      userId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  input.logger.info(
    { userId, rowsRecomputed: result.rowsRecomputed, since: since.toISOString(), until: until.toISOString() },
    'admin_recompute.ok',
  );
  return {
    ok: true,
    window: { since: since.toISOString(), until: until.toISOString() },
    rowsRecomputed: result.rowsRecomputed,
    userId,
  };
}
