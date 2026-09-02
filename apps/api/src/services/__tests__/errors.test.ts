/**
 * KRODEX API — error bank service tests.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  createErrorEntry,
  getErrorEntry,
  linkErrorQuestion,
  listErrorEntries,
  resolveError,
  updateErrorEntry,
} from '../errors';
import { ForbiddenError, NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const ERR_ID = '22222222-2222-4222-8222-222222222222';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function outboxRows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('event_outbox');
}

describe('createErrorEntry', () => {
  it('inserts with the documented defaults', async () => {
    const client = makeFakeSupabase();
    const row = await createErrorEntry(client, SUB, {
      remark: 'mixed up formula',
      mistake_type: 'concept',
    });
    expect(row.user_id).toBe(SUB);
    expect(row.status).toBe('active');
    expect(row.recurrence_count).toBe(0);
  });
});

describe('getErrorEntry / listErrorEntries / updateErrorEntry / linkErrorQuestion', () => {
  it('getErrorEntry throws NotFoundError on miss', async () => {
    const client = makeFakeSupabase();
    await expect(getErrorEntry(client, SUB, ERR_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getErrorEntry throws ForbiddenError on cross-tenant', async () => {
    const client = makeFakeSupabase({
      tables: { error_entries: [{ id: ERR_ID, user_id: 'other' }] },
    });
    await expect(getErrorEntry(client, SUB, ERR_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('listErrorEntries filters by status', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [
          { id: 'e1', user_id: SUB, status: 'active', last_seen_at: '2026-09-01T00:00:00Z' },
          { id: 'e2', user_id: SUB, status: 'resolved', last_seen_at: '2026-08-01T00:00:00Z' },
        ],
      },
    });
    const out = await listErrorEntries(client, SUB, { status: 'active' });
    expect(out.map((r) => r.id)).toEqual(['e1']);
  });

  it('updateErrorEntry refuses to update a missing row', async () => {
    const client = makeFakeSupabase();
    await expect(
      updateErrorEntry(client, SUB, ERR_ID, { status: 'resolved' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateErrorEntry patches a present row', async () => {
    const client = makeFakeSupabase({
      tables: { error_entries: [{ id: ERR_ID, user_id: SUB, status: 'active' }] },
    });
    const row = await updateErrorEntry(client, SUB, ERR_ID, { status: 'resolved' });
    expect(row.status).toBe('resolved');
  });

  it('linkErrorQuestion refuses to link on a missing error', async () => {
    const client = makeFakeSupabase();
    await expect(
      linkErrorQuestion(client, SUB, ERR_ID, '44444444-4444-4444-8444-444444444444'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

/**
 * Phase 3 §4.2 — service-layer event emissions.
 *
 * The error bank service emits two events:
 *   - `error.classified` from updateErrorEntry when mistake_type
 *     transitions from null to a value.
 *   - `error.resolved` from the new resolveError service when the
 *     status flips to 'resolved'.
 *
 * The fake supabase returns `data: null, error: { message: 'no
 * row returned' }` for inserts into unknown tables — so the
 * service's post-commit emit is treated as a failure, which is
 * caught and logged. The source mutation still returns the
 * patched row, which is the spec's "log and continue" policy.
 *
 * We test the two distinct outcomes:
 *   1. With `event_outbox` in `tables`, the emit is observable.
 *   2. Without it, the source mutation still succeeds.
 */
describe('Phase 3: error service-layer event emissions', () => {
  it('updateErrorEntry emits error.classified when mistake_type goes null→value', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'active', mistake_type: null },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const row = await updateErrorEntry(client, SUB, ERR_ID, { mistake_type: 'concept' });
    expect(row.mistake_type).toBe('concept');
    const outbox = outboxRows(client);
    expect(outbox).toHaveLength(1);
    const ev = outbox[0] as {
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      actor_id: string | null;
      payload: { error_id: string; mistake_type: string; previous_mistake_type: string | null };
    };
    expect(ev.event_type).toBe('error.classified');
    expect(ev.aggregate_type).toBe('error_entry');
    expect(ev.aggregate_id).toBe(ERR_ID);
    expect(ev.actor_id).toBe(SUB);
    expect(ev.payload.mistake_type).toBe('concept');
    expect(ev.payload.previous_mistake_type).toBeNull();
    expect(ev.payload.error_id).toBe(ERR_ID);
  });

  it('updateErrorEntry does NOT re-emit error.classified when mistake_type changes value→value', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'active', mistake_type: 'calculation' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updateErrorEntry(client, SUB, ERR_ID, { mistake_type: 'concept' });
    expect(outboxRows(client)).toHaveLength(0);
  });

  it('updateErrorEntry does NOT emit error.classified when mistake_type is set to null', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'active', mistake_type: 'concept' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await updateErrorEntry(client, SUB, ERR_ID, { mistake_type: null });
    expect(outboxRows(client)).toHaveLength(0);
  });

  it('updateErrorEntry succeeds even when event_outbox is missing (post-commit log-and-continue)', async () => {
    const client = makeFakeSupabase({
      // Intentionally NO event_outbox table — the emit will fail,
      // the service should log and continue.
      tables: {
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'active', mistake_type: null },
        ],
      },
    });
    const row = await updateErrorEntry(client, SUB, ERR_ID, { mistake_type: 'concept' });
    expect(row.mistake_type).toBe('concept');
  });

  it('resolveError flips status to resolved and emits error.resolved', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'active', mistake_type: 'concept' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const row = await resolveError(client, SUB, ERR_ID);
    expect(row.status).toBe('resolved');
    const outbox = outboxRows(client);
    expect(outbox).toHaveLength(1);
    const ev = outbox[0] as {
      event_type: string;
      aggregate_id: string;
      payload: { error_id: string; trigger: string; review_schedule_id: string | null };
    };
    expect(ev.event_type).toBe('error.resolved');
    expect(ev.aggregate_id).toBe(ERR_ID);
    expect(ev.payload.trigger).toBe('manual');
    expect(ev.payload.review_schedule_id).toBeNull();
  });

  it('resolveError with trigger=review sets the trigger and review_schedule_id on the payload', async () => {
    const SCHED = '33333333-3333-4333-8333-333333333333';
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'in_review', mistake_type: 'concept' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await resolveError(client, SUB, ERR_ID, { trigger: 'review', review_schedule_id: SCHED });
    const outbox = outboxRows(client);
    const ev = outbox[0] as {
      payload: { trigger: string; review_schedule_id: string | null };
    };
    expect(ev.payload.trigger).toBe('review');
    expect(ev.payload.review_schedule_id).toBe(SCHED);
  });

  it('resolveError is a no-op (no emit) when the entry is already resolved', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'resolved', mistake_type: 'concept' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const row = await resolveError(client, SUB, ERR_ID);
    expect(row.status).toBe('resolved');
    expect(outboxRows(client)).toHaveLength(0);
  });

  it('resolveError is a no-op (no emit) when the entry is archived', async () => {
    const client = makeFakeSupabase({
      tables: {
        event_outbox: [],
        error_entries: [
          { id: ERR_ID, user_id: SUB, status: 'archived', mistake_type: 'concept' },
        ],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const row = await resolveError(client, SUB, ERR_ID);
    expect(row.status).toBe('archived');
    expect(outboxRows(client)).toHaveLength(0);
  });
});
