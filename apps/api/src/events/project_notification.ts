/**
 * KRODEX — project_notification handler.
 *
 * Per PHASE3_PLAN.md §6.2, this handler runs on every event_outbox
 * row whose event_type matches and inserts a notification row when
 * the policy says one should exist.
 *
 * The handler is intentionally small in Phase 3. Notification
 * *policy* (which events should become which notifications, with
 * what severity/title/body) is a Phase 4/5 concern; the Phase 3
 * shape of the bus is the deliverable.
 *
 * Today, the only event that produces a notification via the
 * worker is:
 *
 *   notification.created  -> insert one notifications row from
 *                            the payload's typed fields
 *
 * The handler is called for every event in the outbox, but it
 * only acts on `notification.created`. Other event types return
 * 'succeeded' with wrote=0 so the worker records a clean
 * (event_id, handler_name) row and never re-runs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EventEnvelope,
  NotificationSeverity,
} from '@krodex/shared';

import { HandlerOutcome } from './handler-outcome';

export const HANDLER_NAME = 'project_notification';

interface PlannedNotification {
  user_id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
}

/**
 * Pure: return the notification row the handler would insert.
 * Exported for unit tests.
 */
export function planNotificationForEvent(
  envelope: EventEnvelope<'notification.created'>,
): readonly PlannedNotification[] {
  const p = envelope.payload;
  return [{
    user_id: envelope.accountId,
    kind: p.kind,
    severity: p.severity as NotificationSeverity,
    title: p.title,
    body: p.body,
    payload: {
      source_event_id: p.source_event_id,
      ...p.metadata,
    },
  }];
}

export async function handle(
  client: SupabaseClient,
  envelope: EventEnvelope,
): Promise<HandlerOutcome> {
  if (envelope.eventType !== 'notification.created') {
    return { kind: 'succeeded', wrote: 0, skipped: 'no_notification_for_event_type' };
  }
  const planned = planNotificationForEvent(envelope as EventEnvelope<'notification.created'>);
  let wrote = 0;
  for (const n of planned) {
    const { error } = await client.from('notifications').insert(n);
    if (error) {
      if (error.code === '23505') continue;
      throw new Error(
        `project_notification: insert failed (${error.code}): ${error.message}`,
      );
    }
    wrote += 1;
  }
  return { kind: 'succeeded', wrote };
}
