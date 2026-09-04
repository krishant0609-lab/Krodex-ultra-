/**
 * KRODEX — notification delivery service.
 *
 * Per Phase 12 plan, the delivery dispatcher is responsible for
 * transitioning `notification_deliveries` rows from `pending` to
 * `sent` (for the in_app channel) and from `pending` to
 * `cancelled`/`failed` (for unimplemented channels).
 *
 * Phase 12 supports `in_app` end-to-end: a row is marked `sent`
 * with a `sent_at = now()` timestamp. `email` and `push` rows
 * stay in `pending` state — they are scaffolded as placeholders
 * for the next phase but never transmitted.
 *
 * Idempotency: the dispatch loop scopes the update to
 *   `state = 'pending' AND channel = 'in_app'`
 * so a concurrent dispatcher is harmless. A row already at `sent`
 * is a no-op (the WHERE clause filters it out).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface DispatchResult {
  /** Number of in_app rows transitioned from pending to sent. */
  processed: number;
  /** Number of rows that failed to transition (cancelled, etc.). */
  failed: number;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Mark up to `limit` pending in_app deliveries as sent.
 *
 * Returns counts. Does NOT throw on individual row failures — a
 * transient Supabase error surfaces as a thrown exception, but a
 * row that fails to update (e.g. was cancelled concurrently) is
 * just skipped.
 */
export async function dispatchPendingDeliveries(
  client: SupabaseClient,
  options: { limit?: number; now?: () => Date } = {},
): Promise<DispatchResult> {
  const limit = options.limit ?? DEFAULT_BATCH_SIZE;
  const now = options.now ? options.now() : new Date();

  // 1. Read the next batch of pending in_app rows. We do the
  //    select first so we can produce a deterministic count even
  //    if the subsequent update has a race.
  const { data: pending, error: readErr } = await client
    .from('notification_deliveries')
    .select('id')
    .eq('state', 'pending')
    .eq('channel', 'in_app')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (readErr) {
    throw new Error(`dispatchPendingDeliveries read failed: ${readErr.message}`);
  }
  const rows = (pending ?? []) as Array<{ id: string }>;
  if (rows.length === 0) {
    return { processed: 0, failed: 0 };
  }

  // 2. For each pending row, attempt the pending→sent transition.
  //    We rely on a WHERE filter (`state = 'pending'`) on the
  //    update so a concurrent transition by another worker is
  //    silently skipped.
  let processed = 0;
  let failed = 0;
  const sentAt = now.toISOString();
  for (const row of rows) {
    // Use an update-with-filter pattern via eq(). The fake
    // client treats eq() as a filter; the real client hits the
    // same WHERE clause. This is the idempotency guard.
    const { error: updErr } = await client
      .from('notification_deliveries')
      .update({ state: 'sent', sent_at: sentAt, attempt_count: 1 })
      .eq('id', row.id)
      .eq('state', 'pending');
    if (updErr) {
      failed += 1;
      continue;
    }
    processed += 1;
  }

  return { processed, failed };
}
