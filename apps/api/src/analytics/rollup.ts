/**
 * KRODEX API — analytics rollup service.
 *
 * Per PHASE4_PLAN.md §11.4, the SQL function
 * `recompute_analytics_rollup(p_user_id, p_since, p_until)` is
 * the workhorse. This TS service is the thin wrapper that
 * exposes a typed `recomputeRollupForUser` call to the
 * `event-bus` handler and the `POST /analytics/admin/recompute`
 * route.
 *
 * The service does NOT recompute anything in TypeScript — it
 * delegates to the SECURITY DEFINER SQL function in migration
 * 12 and returns the row count. The migration is the source
 * of truth for the rollup logic; this module is just a typed
 * RPC wrapper.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RecomputeArgs {
  userId: string;
  since: Date;
  until: Date;
}

export interface RecomputeResult {
  userId: string;
  /** Number of (user, dimension, day) triples updated. */
  rowsRecomputed: number;
  /** The window used (echo of the input, normalized to ISO). */
  since: string;
  until: string;
  computedAt: string;
}

/**
 * Call the SECURITY DEFINER `recompute_analytics_rollup` SQL
 * function. The function is idempotent — running it twice
 * inside the same window produces the same state with the
 * same row count. Throws on RPC error.
 */
export async function recomputeRollupForUser(
  client: SupabaseClient,
  args: RecomputeArgs,
): Promise<RecomputeResult> {
  const { data, error } = await client.rpc('recompute_analytics_rollup', {
    p_user_id: args.userId,
    p_since: args.since.toISOString(),
    p_until: args.until.toISOString(),
  });
  if (error) {
    throw new Error(
      `recompute_analytics_rollup failed: ${error.code ?? 'unknown'}: ${error.message}`,
    );
  }
  const rowsRecomputed = typeof data === 'number' ? data : 0;
  return {
    userId: args.userId,
    rowsRecomputed,
    since: args.since.toISOString(),
    until: args.until.toISOString(),
    computedAt: new Date().toISOString(),
  };
}

/**
 * The default 5-minute recompute window (Class C — Approved
 * Product Policy, D-9). The window is "now minus 5 minutes"
 * through "now"; the SQL function is idempotent so any
 * overlap is harmless.
 */
export function fiveMinuteRecomputeWindow(now: Date = new Date()): { since: Date; until: Date } {
  return {
    since: new Date(now.getTime() - 5 * 60 * 1000),
    until: now,
  };
}
