/**
 * KRODEX — project_notification handler.
 *
 * Per PHASE12_PLAN.md §6–§8a, this handler runs on every event_outbox
 * row whose event_type is recognized as notification-worthy. It
 * projects the event into:
 *   1. a `notifications` row (idempotent on (user_id, dedup_key))
 *   2. one `notification_deliveries` row per enabled channel
 *      (in_app, email, push — email/push are scaffold-only, no
 *      external transmission in Phase 12)
 *
 * Idempotency is layered:
 *   1. The worker event_log already prevents duplicate handler
 *      invocations per (event_id, handler_name).
 *   2. The (user_id, dedup_key) unique index added in migration 16
 *      prevents duplicate notification rows for the same
 *      semantic occurrence, even across distinct event types
 *      (e.g. an error.lifecycle.active and a replayed error.recorded
 *      for the same error_id).
 *
 * Preferences (PHASE12_PLAN §6):
 *   - per-kind opt-out: if a kind is in `disabled_kinds`, skip
 *   - per-kind allow-list: if `enabled_kinds` is non-empty and
 *     the kind is not in it, skip
 *   - quiet hours: if the current time in the user's timezone
 *     falls inside the configured quiet window, skip
 *   - Fail-open on any preferences read failure (better to
 *     over-notify than to silently drop)
 *
 * Channel mapping:
 *   - in_app -> insert a pending delivery row (dispatcher flips
 *     state to sent at the next tick)
 *   - email / push -> also insert a pending delivery row in
 *     Phase 12; external transmission is not implemented
 */

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EventEnvelope,
  EventType,
  Json,
  NotificationSeverity,
} from '@krodex/shared';

import { HandlerOutcome } from './handler-outcome';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isChannelEnabled,
  isInQuietHours,
  isKindEnabled,
  preferencesFromSettings,
  type NotificationPreferences,
} from '../services/notification-preferences-service';

export const HANDLER_NAME = 'project_notification';

/**
 * Notification-worthy event types. Anything outside this set is
 * acknowledged with wrote=0 (the worker records a clean
 * event_log row so we never re-run it).
 */
const NOTIFICATION_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'notification.created',
  // Phase 9 — error lifecycle
  'error.lifecycle.active',
  'error.lifecycle.reopened',
  // Phase 9 — capture
  'attempt.analyzed',
  // Phase 10 — review
  'review.outcome_recorded',
  // Phase 11 — planner / backlog
  'task.missed',
  'task.completed',
  'backlog.item_created',
  // Phase 12 — scheduled reminders
  'review.due',
  'review.overdue',
  'task.upcoming',
]);

/** Recurring events are deduped per calendar day. */
const RECURRING_KINDS: ReadonlySet<string> = new Set(['review_due', 'review_overdue']);

/** Channels that Phase 12 scaffolds delivery rows for. */
const CHANNELS: ReadonlyArray<'in_app' | 'email' | 'push'> = ['in_app', 'email', 'push'];

interface PlannedNotification {
  user_id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  /** Aggregate id used to build the dedup_key. */
  source_aggregate_id: string;
  /** YYYY-MM-DD in UTC for recurring kinds; null for one-shot. */
  date_bucket: string | null;
}

/**
 * Pure: map an event envelope to the notification row(s) it should
 * produce. Returns [] for non-notification events.
 *
 * Exported for unit tests.
 */
export function planNotificationForEvent(
  envelope: EventEnvelope,
): readonly PlannedNotification[] {
  if (!NOTIFICATION_EVENT_TYPES.has(envelope.eventType as EventType)) {
    return [];
  }
  // System-owned events (accountId === null) cannot produce per-user
  // notification rows. Return early with an empty plan.
  if (envelope.accountId === null) return [];
  const userId = envelope.accountId;

  switch (envelope.eventType) {
    case 'notification.created': {
      // The legacy shape. We honor it for backwards compat with
      // any producer still emitting direct notification.created.
      const p = (envelope as EventEnvelope<'notification.created'>).payload;
      return [{
        user_id: userId,
        kind: p.kind,
        severity: (p.severity as NotificationSeverity) ?? 'info',
        title: p.title,
        body: p.body,
        payload: {
          source_event_id: p.source_event_id,
          ...(p.metadata as Record<string, unknown> ?? {}),
        },
        source_aggregate_id: p.notification_id,
        date_bucket: null,
      }];
    }

    case 'error.lifecycle.active': {
      const p = (envelope as EventEnvelope<'error.lifecycle.active'>).payload;
      return [{
        user_id: userId,
        kind: 'error_recorded',
        severity: 'info',
        title: 'A new error was logged',
        body: 'Open the error to start a review session.',
        payload: {
          error_id: p.error_id,
          source_event_id: envelope.eventId,
          deep_link: `/errors/${p.error_id}`,
        },
        source_aggregate_id: p.error_id,
        date_bucket: null,
      }];
    }

    case 'error.lifecycle.reopened': {
      const p = (envelope as EventEnvelope<'error.lifecycle.reopened'>).payload;
      return [{
        user_id: userId,
        kind: 'error_reopened',
        severity: 'warning',
        title: 'An error was reopened',
        body: 'A new wrong answer moved this error back to active.',
        payload: {
          error_id: p.error_id,
          source_event_id: envelope.eventId,
          deep_link: `/errors/${p.error_id}`,
        },
        source_aggregate_id: p.error_id,
        date_bucket: null,
      }];
    }

    case 'attempt.analyzed': {
      const p = (envelope as EventEnvelope<'attempt.analyzed'>).payload;
      const incorrect = p.answers.filter((a) => a.outcome !== 'correct');
      if (incorrect.length === 0) return [];
      return [{
        user_id: userId,
        kind: 'attempt_analyzed',
        severity: 'info',
        title: 'Attempt analyzed',
        body: incorrect.length === 1
          ? 'One question was missed. Review it now.'
          : `${incorrect.length} questions were missed. Review them now.`,
        payload: {
          attempt_id: p.attempt_id,
          incorrect_count: incorrect.length,
          source_event_id: envelope.eventId,
          deep_link: `/attempts/${p.attempt_id}`,
        },
        source_aggregate_id: p.attempt_id,
        date_bucket: null,
      }];
    }

    case 'review.outcome_recorded': {
      const p = (envelope as EventEnvelope<'review.outcome_recorded'>).payload;
      // Only the "correct" outcome is interesting — incorrect
      // outcomes already produce an `attempt.analyzed` -> error
      // chain that the project_progress_evidence handler tracks.
      if (p.outcome !== 'correct') return [];
      return [{
        user_id: userId,
        kind: 'review_outcome_recorded',
        severity: 'info',
        title: 'Review recorded',
        body: 'You answered the verification question correctly.',
        payload: {
          schedule_id: p.schedule_id,
          error_id: p.error_id,
          source_event_id: envelope.eventId,
          deep_link: `/errors/${p.error_id}`,
        },
        source_aggregate_id: p.schedule_id,
        date_bucket: null,
      }];
    }

    case 'task.missed': {
      const p = (envelope as EventEnvelope<'task.missed'>).payload;
      return [{
        user_id: userId,
        kind: 'task_missed',
        severity: 'critical',
        title: 'A planned task was missed',
        body: 'It was moved to your backlog. Recover it from the planner.',
        payload: {
          task_id: p.task_id,
          plan_date: p.plan_date,
          source_event_id: envelope.eventId,
          deep_link: '/planner',
        },
        source_aggregate_id: p.task_id,
        date_bucket: null,
      }];
    }

    case 'task.completed': {
      const p = (envelope as EventEnvelope<'task.completed'>).payload;
      return [{
        user_id: userId,
        kind: 'task_completed',
        severity: 'success',
        title: 'Task complete',
        body: 'Nice work — your plan is on track.',
        payload: {
          task_id: p.task_id,
          plan_date: p.plan_date,
          source_event_id: envelope.eventId,
          deep_link: '/planner',
        },
        source_aggregate_id: p.task_id,
        date_bucket: null,
      }];
    }

    case 'backlog.item_created': {
      const p = (envelope as EventEnvelope<'backlog.item_created'>).payload;
      return [{
        user_id: userId,
        kind: 'backlog_recovery',
        severity: 'warning',
        title: 'Backlog item added',
        body: 'A missed task was added to your backlog for recovery.',
        payload: {
          backlog_item_id: p.backlog_item_id,
          source_task_id: p.source_task_id,
          reason: p.reason,
          source_event_id: envelope.eventId,
          deep_link: '/planner',
        },
        source_aggregate_id: p.backlog_item_id,
        date_bucket: null,
      }];
    }

    case 'review.due': {
      const p = (envelope as EventEnvelope<'review.due'>).payload;
      return [{
        user_id: userId,
        kind: 'review_due',
        severity: 'warning',
        title: 'A review is due',
        body: 'Open the review to keep your error book on track.',
        payload: {
          schedule_id: p.schedule_id,
          error_id: p.error_id,
          due_at: p.due_at,
          strategy: p.strategy,
          source_event_id: envelope.eventId,
          deep_link: `/reviews/${p.schedule_id}`,
        },
        source_aggregate_id: p.schedule_id,
        // Recurring: bucket by the day the review becomes due so
        // we don't spam the inbox across multiple reminder runs.
        date_bucket: p.due_at.slice(0, 10),
      }];
    }

    case 'review.overdue': {
      const p = (envelope as EventEnvelope<'review.overdue'>).payload;
      return [{
        user_id: userId,
        kind: 'review_overdue',
        severity: 'critical',
        title: 'A review is overdue',
        body: 'Your review past due. Catch up now to stay on track.',
        payload: {
          schedule_id: p.schedule_id,
          error_id: p.error_id,
          due_at: p.due_at,
          overdue_by_seconds: p.overdue_by_seconds,
          source_event_id: envelope.eventId,
          deep_link: `/reviews/${p.schedule_id}`,
        },
        source_aggregate_id: p.schedule_id,
        // Recurring: bucket per calendar day so an overdue review
        // doesn't generate a new notification every 5 minutes.
        date_bucket: p.due_at.slice(0, 10),
      }];
    }

    case 'task.upcoming': {
      const p = (envelope as EventEnvelope<'task.upcoming'>).payload;
      return [{
        user_id: userId,
        kind: 'task_upcoming',
        severity: 'info',
        title: 'A planned task is coming up',
        body: 'Get ready — your next planned task is due soon.',
        payload: {
          task_id: p.task_id,
          plan_date: p.plan_date,
          subject_id: p.subject_id,
          due_at: p.due_at,
          source_event_id: envelope.eventId,
          deep_link: '/planner',
        },
        source_aggregate_id: p.task_id,
        // Recurring: bucket per calendar day so 15-min ticks don't
        // spam the inbox for the same task.
        date_bucket: p.due_at.slice(0, 10),
      }];
    }

    default:
      return [];
  }
}

/** Compute the dedup_key for a planned notification. */
export function computeDedupKey(plan: PlannedNotification): string {
  const bucket = plan.date_bucket ?? 'once';
  return createHash('sha256')
    .update(plan.kind)
    .update('|')
    .update(plan.source_aggregate_id)
    .update('|')
    .update(plan.user_id)
    .update('|')
    .update(bucket)
    .digest('hex');
}

/** Test/visibility helper: are we treating this kind as recurring? */
export function isRecurringKind(kind: string): boolean {
  return RECURRING_KINDS.has(kind);
}

/**
 * Decide whether the user wants this notification right now.
 *
 * Returns `null` if it should be sent, or a `skipped` string
 * explaining why it was suppressed. The projector respects this
 * in `handle` below.
 */
export function evaluatePreferences(
  prefs: NotificationPreferences,
  userTimezone: string,
  now: Date,
  kind: string,
): string | null {
  if (!isKindEnabled(prefs, kind)) return 'kind_disabled';
  if (isInQuietHours(prefs, userTimezone, now)) return 'quiet_hours';
  return null;
}

/** Pick the channels the user wants this notification on. */
export function pickEnabledChannels(
  prefs: NotificationPreferences,
): Array<'in_app' | 'email' | 'push'> {
  return CHANNELS.filter((c) => isChannelEnabled(prefs, c));
}

/**
 * Read the user's notification preferences and timezone.
 *
 * Fail-open: any error -> return the default preferences. Better
 * to over-notify than to silently drop.
 */
async function loadUserPreferences(
  client: SupabaseClient,
  userId: string,
): Promise<{ prefs: NotificationPreferences; timezone: string }> {
  // Try the join in one query. If the profile row is missing or
  // the join fails, we fall back to defaults.
  const { data: row, error } = await client
    .from('profiles')
    .select('settings, users:user_id (timezone)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !row) {
    return { prefs: DEFAULT_NOTIFICATION_PREFERENCES, timezone: 'UTC' };
  }
  const settings = ((row as { settings?: Json | null }).settings ?? null) as Json | null;
  const tz = (row as { users?: { timezone?: string } | null }).users?.timezone ?? 'UTC';
  return {
    prefs: preferencesFromSettings(settings),
    timezone: tz || 'UTC',
  };
}

/**
 * Execute the handler. Returns the outcome the worker should record
 * in event_log. Throws only on truly unexpected errors (network,
 * PostgREST 5xx, etc.) — not on uniqueness conflicts.
 */
export async function handle(
  client: SupabaseClient,
  envelope: EventEnvelope,
): Promise<HandlerOutcome> {
  if (!NOTIFICATION_EVENT_TYPES.has(envelope.eventType as EventType)) {
    return { kind: 'succeeded', wrote: 0, skipped: 'no_notification_for_event_type' };
  }

  const planned = planNotificationForEvent(envelope);
  if (planned.length === 0) {
    return { kind: 'succeeded', wrote: 0, skipped: 'event_had_no_projection' };
  }

  // planNotificationForEvent returns [] for null accountId, so any
  // non-empty plan implies a non-null accountId. The assertion is
  // bounded by the prior length check.
  const accountId = envelope.accountId as string;
  const { prefs, timezone } = await loadUserPreferences(client, accountId);
  const now = new Date(envelope.occurredAt);

  let wrote = 0;
  let suppressed = 0;

  for (const plan of planned) {
    const skipReason = evaluatePreferences(prefs, timezone, now, plan.kind);
    if (skipReason) {
      suppressed += 1;
      continue;
    }
    const channels = pickEnabledChannels(prefs);
    if (channels.length === 0) {
      suppressed += 1;
      continue;
    }
    const dedupKey = computeDedupKey(plan);

    // Idempotent insert: the (user_id, dedup_key) unique index
    // means a duplicate projection is a 23505 conflict. We treat
    // the conflict as a clean no-op so the worker still records
    // a success row.
    const { data: inserted, error: insErr } = await client
      .from('notifications')
      .insert({
        user_id: plan.user_id,
        kind: plan.kind,
        severity: plan.severity,
        title: plan.title,
        body: plan.body,
        payload: plan.payload,
        dedup_key: dedupKey,
      })
      .select('id')
      .single();
    if (insErr) {
      if (insErr.code === '23505') continue; // dedup hit
      throw new Error(
        `project_notification: insert failed (${insErr.code}): ${insErr.message}`,
      );
    }
    const notificationId = (inserted as { id: string } | null)?.id;
    if (!notificationId) continue;

    // One delivery row per enabled channel. The (notification_id,
    // channel) unique index makes this idempotent too.
    for (const channel of channels) {
      const { error: dErr } = await client
        .from('notification_deliveries')
        .insert({
          user_id: plan.user_id,
          notification_id: notificationId,
          channel,
          state: 'pending',
        });
      if (dErr) {
        if (dErr.code === '23505') continue;
        throw new Error(
          `project_notification: delivery insert failed (${dErr.code}): ${dErr.message}`,
        );
      }
    }
    wrote += 1;
  }

  if (wrote === 0 && suppressed > 0) {
    return { kind: 'succeeded', wrote: 0, skipped: 'all_suppressed_by_preferences' };
  }
  return { kind: 'succeeded', wrote };
}
