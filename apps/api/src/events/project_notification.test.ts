/**
 * KRODEX — project_notification handler tests.
 */

import { describe, expect, it } from 'vitest';
import { computeEventId, computeIdempotencyKeyForEvent } from '@krodex/shared';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import { buildEnvelope } from './outbox-writer';
import { planNotificationForEvent, handle } from './project_notification';
import type { EventEnvelope, EventType } from '@krodex/shared';

const USER_A = '00000000-0000-0000-0000-00000000000a';

function envOf<T extends EventType>(
  eventType: T,
  payload: EventEnvelope<T>['payload'],
  aggregateType = 'notification',
  aggregateId = 'n1',
): EventEnvelope<T> {
  const eventId = computeEventId({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: 1,
  });
  return buildEnvelope({
    eventType,
    accountId: USER_A,
    actorId: USER_A,
    aggregateType,
    aggregateId,
    aggregateVersion: 1,
    eventId,
    idempotencyKey,
    payload,
  });
}

describe('planNotificationForEvent', () => {
  it('returns one row for notification.created with the typed fields', () => {
    const env = envOf('notification.created', {
      notification_id: 'n1',
      kind: 'review_due',
      severity: 'info',
      source_event_id: 'e1',
      title: 'Review due',
      body: 'You have a review scheduled.',
      metadata: { review_schedule_id: 's1' },
    });
    const out = planNotificationForEvent(env);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      user_id: USER_A,
      kind: 'review_due',
      severity: 'info',
      title: 'Review due',
      body: 'You have a review scheduled.',
    });
    expect(out[0]?.payload).toMatchObject({
      source_event_id: 'e1',
      review_schedule_id: 's1',
    });
  });
});

describe('handle()', () => {
  it('inserts a notifications row for notification.created', async () => {
    const client = makeFakeSupabase({
      tables: { notifications: [] },
    });
    const env = envOf('notification.created', {
      notification_id: 'n1',
      kind: 'review_due',
      severity: 'info',
      source_event_id: 'e1',
      title: 'Review due',
      body: null,
      metadata: {},
    });
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(1);

    const rows = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('notifications');
    expect(rows).toHaveLength(1);
    expect((rows[0] as { kind: string }).kind).toBe('review_due');
  });

  it('returns wrote=0 for non-notification events', async () => {
    const client = makeFakeSupabase({
      tables: { notifications: [] },
    });
    const env = envOf('attempt.submitted', {
      test_id: 't1',
      attempt_id: 'a1',
      correct_count: 0,
      incorrect_count: 0,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0',
      duration_ms: null,
      incorrect_question_ids: [],
    });
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(0);
  });
});
