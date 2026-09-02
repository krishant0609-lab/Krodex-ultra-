/**
 * KRODEX API — evidence freshness service.
 *
 * Per PHASE3_PLAN.md §7.2, the evidence endpoint is wrapped with
 * a `freshness` envelope that tells the client "Updated N
 * seconds ago" honestly. The freshness block is:
 *
 *   {
 *     lastEventAt: string | null,
 *     eventLagSeconds: number | null
 *   }
 *
 * `lastEventAt` is the most recent `event_outbox.occurred_at` for
 * any of the relevant event types for this user. `eventLagSeconds`
 * is `now - lastEventAt`, in seconds, rounded to the nearest
 * integer. Both are null when no events have been emitted yet.
 *
 * The set of "relevant" event types is the full Phase 3 catalog
 * (any event that drives a progress_evidence / notification
 * projection). We deliberately use the full set rather than
 * filtering by the requested dimension: the freshness is for
 * the whole evidence stream, not a single dimension. Per §7.2
 * "Computed by MAX(event_outbox.occurred_at) WHERE event_type IN
 * (relevant set) AND user_id = me".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AnalyticsFreshness {
  lastEventAt: string | null;
  eventLagSeconds: number | null;
}

/**
 * All 14 Phase 3 event types participate in the evidence +
 * notification projection chain. We hard-code the list here so
 * the freshness endpoint does not require reading
 * `event_type_metadata` to know which event types matter.
 */
const RELEVANT_EVENT_TYPES: readonly string[] = [
  'attempt.submitted',
  'attempt.analyzed',
  'syllabus.progress_recorded',
  'syllabus.node_archived',
  'error.classified',
  'error.resolved',
  'error.reopened',
  'review.scheduled',
  'review.started',
  'review.outcome_recorded',
  'task.planned',
  'task.completed',
  'task.missed',
  'system.tick',
];

/**
 * Read the most recent event_outbox row for the user across the
 * relevant event-type set, then compute the lag against `now`.
 * The fake-supabase client supports `.order().limit()`. The real
 * client will do the same.
 */
export async function getAnalyticsFreshness(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<AnalyticsFreshness> {
  const { data, error } = await client
    .from('event_outbox')
    .select('occurred_at')
    .eq('user_id', userId)
    .in('event_type', RELEVANT_EVENT_TYPES as string[])
    .order('occurred_at', { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`getAnalyticsFreshness failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ occurred_at: string }>;
  const last = rows[0]?.occurred_at ?? null;
  if (!last) {
    return { lastEventAt: null, eventLagSeconds: null };
  }
  const lastMs = new Date(last).getTime();
  const lagSeconds = Math.max(0, Math.round((now.getTime() - lastMs) / 1000));
  return { lastEventAt: last, eventLagSeconds: lagSeconds };
}
