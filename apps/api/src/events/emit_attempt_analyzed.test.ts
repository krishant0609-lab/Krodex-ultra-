/**
 * KRODEX — emit_attempt_analyzed handler tests.
 */

import { describe, expect, it } from 'vitest';
import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  computeWorkerIdempotencyKey,
} from '@krodex/shared';
import { makeFakeSupabase } from '../test-utils/fake-supabase';
import { buildEnvelope } from './outbox-writer';
import { handle } from './emit_attempt_analyzed';
import type { EventEnvelope } from '@krodex/shared';

const USER_A = '00000000-0000-0000-0000-00000000000a';
const ATTEMPT_ID = '00000000-0000-0000-0000-0000000000a1';
const TEST_ID = '00000000-0000-0000-0000-0000000000b1';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function attemptSubmittedEnvelope(): EventEnvelope<'attempt.submitted'> {
  const eventId = computeEventId({
    event_type: 'attempt.submitted',
    aggregate_type: 'attempt',
    aggregate_id: ATTEMPT_ID,
    aggregate_version: 1,
  });
  const idempotencyKey = computeIdempotencyKeyForEvent({
    event_type: 'attempt.submitted',
    aggregate_type: 'attempt',
    aggregate_id: ATTEMPT_ID,
    aggregate_version: 1,
  });
  return buildEnvelope({
    eventType: 'attempt.submitted',
    accountId: USER_A,
    actorId: USER_A,
    aggregateType: 'attempt',
    aggregateId: ATTEMPT_ID,
    aggregateVersion: 1,
    eventId,
    idempotencyKey,
    payload: {
      test_id: TEST_ID,
      attempt_id: ATTEMPT_ID,
      correct_count: 2,
      incorrect_count: 1,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0.667',
      duration_ms: 60_000,
      incorrect_question_ids: ['q3'],
    },
  });
}

describe('emit_attempt_analyzed', () => {
  it('reads test_answers and writes an attempt.analyzed event into the outbox', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_answers: [
          { attempt_id: ATTEMPT_ID, user_id: USER_A, question_id: 'q1', outcome: 'correct' },
          { attempt_id: ATTEMPT_ID, user_id: USER_A, question_id: 'q2', outcome: 'correct' },
          { attempt_id: ATTEMPT_ID, user_id: USER_A, question_id: 'q3', outcome: 'incorrect' },
        ],
        event_outbox: [],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const env = attemptSubmittedEnvelope();
    const out = await handle(client, env);
    expect(out.kind).toBe('succeeded');
    if (out.kind !== 'succeeded') throw new Error('narrow');
    expect(out.wrote).toBe(1);

    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(1);
    const row = outbox[0] as { event_type: string; payload: { attempt_id: string; test_id: string; answers: { question_id: string; outcome: string }[] } };
    expect(row.event_type).toBe('attempt.analyzed');
    expect(row.payload.attempt_id).toBe(ATTEMPT_ID);
    expect(row.payload.test_id).toBe(TEST_ID);
    expect(row.payload.answers).toHaveLength(3);
    expect(row.payload.answers.find((a) => a.question_id === 'q3')?.outcome).toBe('incorrect');
  });

  it('uses the worker idempotency key formula so it does not collide with the source event', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_answers: [
          { attempt_id: ATTEMPT_ID, user_id: USER_A, question_id: 'q1', outcome: 'correct' },
        ],
        event_outbox: [],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const env = attemptSubmittedEnvelope();
    await handle(client, env);

    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    const row = outbox[0] as { idempotency_key: string; event_id: string; event_type: string };
    expect(row.event_type).toBe('attempt.analyzed');
    expect(row.idempotency_key).toBe(
      computeWorkerIdempotencyKey(env.eventId, 'emit_attempt_analyzed'),
    );
    expect(row.event_id).not.toBe(env.eventId);
  });

  it('is idempotent on repeated delivery — second call writes 0 rows', async () => {
    const client = makeFakeSupabase({
      tables: {
        test_answers: [
          { attempt_id: ATTEMPT_ID, user_id: USER_A, question_id: 'q1', outcome: 'correct' },
        ],
        event_outbox: [],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const env = attemptSubmittedEnvelope();
    const a = await handle(client, env);
    const b = await handle(client, env);
    expect(a.kind).toBe('succeeded');
    expect(b.kind).toBe('succeeded');
    if (a.kind !== 'succeeded' || b.kind !== 'succeeded') throw new Error('narrow');
    expect(a.wrote).toBe(1);
    expect(b.wrote).toBe(0);
    const outbox = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('event_outbox');
    expect(outbox).toHaveLength(1);
  });
});
