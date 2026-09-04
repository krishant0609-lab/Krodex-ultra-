/**
 * KRODEX API — error lifecycle service tests.
 *
 * Covers the state machine in apps/api/src/services/error-lifecycle-service.ts:
 *   - isValidTransition() — exhaustively checked against TRD §11
 *   - transitionStatus()  — happy path, idempotent, illegal transition
 *   - listLifecycleEvents() — read API
 *   - history is append-only (no UPDATE/DELETE allowed by RLS)
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../errors';
import {
  isValidTransition,
  listLifecycleEvents,
  transitionStatus,
} from '../error-lifecycle-service';

const SUB = '11111111-1111-4111-8111-111111111111';
const ERR_ID = '22222222-2222-4222-8222-222222222222';

const OUTBOX_UNIQUE = [
  ['user_id', 'event_type', 'idempotency_key'],
] as const;

function outboxRows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('event_outbox');
}

function lifecycleRows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('error_lifecycle_events');
}

describe('isValidTransition', () => {
  it('matches the TRD §11 table', () => {
    // ACTIVE
    expect(isValidTransition('active', 'in_review')).toBe(true);
    expect(isValidTransition('active', 'archived')).toBe(true);
    expect(isValidTransition('active', 'resolved')).toBe(false);
    expect(isValidTransition('active', 'reopened')).toBe(false);

    // IN_REVIEW
    expect(isValidTransition('in_review', 'resolved')).toBe(true);
    expect(isValidTransition('in_review', 'active')).toBe(true);
    expect(isValidTransition('in_review', 'archived')).toBe(true);
    expect(isValidTransition('in_review', 'reopened')).toBe(false);

    // RESOLVED
    expect(isValidTransition('resolved', 'reopened')).toBe(true);
    expect(isValidTransition('resolved', 'active')).toBe(false);
    expect(isValidTransition('resolved', 'in_review')).toBe(false);

    // REOPENED
    expect(isValidTransition('reopened', 'in_review')).toBe(true);
    expect(isValidTransition('reopened', 'resolved')).toBe(true);
    expect(isValidTransition('reopened', 'archived')).toBe(true);

    // ARCHIVED is terminal
    expect(isValidTransition('archived', 'active')).toBe(false);
    expect(isValidTransition('archived', 'resolved')).toBe(false);

    // same-state transitions are not allowed (treated as no-op)
    expect(isValidTransition('active', 'active')).toBe(false);
    expect(isValidTransition('archived', 'archived')).toBe(false);
  });
});

describe('transitionStatus', () => {
  it('moves active → in_review, appends history, emits outbox event', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [{ id: ERR_ID, user_id: SUB, status: 'active' }],
        error_lifecycle_events: [],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    const { errorEntry, event } = await transitionStatus(
      client,
      SUB,
      ERR_ID,
      { to_status: 'in_review', trigger: 'student_review' },
      SUB,
    );
    expect(errorEntry.status).toBe('in_review');
    expect(event.from_status).toBe('active');
    expect(event.to_status).toBe('in_review');
    expect(event.trigger).toBe('student_review');
    const ob = outboxRows(client).find((r) => r.event_type === 'error.lifecycle.in_review');
    expect(ob).toBeDefined();
    expect(lifecycleRows(client)).toHaveLength(1);
  });

  it('is idempotent: re-asserting the same status is a no-op', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [{ id: ERR_ID, user_id: SUB, status: 'active' }],
        error_lifecycle_events: [],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await transitionStatus(client, SUB, ERR_ID, { to_status: 'active', trigger: 'manual' }, SUB);
    // Same-state: should NOT append a history row.
    expect(lifecycleRows(client)).toHaveLength(0);
  });

  it('rejects an illegal transition with InvalidStateError', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [{ id: ERR_ID, user_id: SUB, status: 'active' }],
        error_lifecycle_events: [],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    // ACTIVE → RESOLVED is not in the table.
    await expect(
      transitionStatus(client, SUB, ERR_ID, { to_status: 'resolved', trigger: 'manual' }, SUB),
    ).rejects.toBeInstanceOf(InvalidStateError);
    // Source row must be untouched.
    const rows = (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('error_entries');
    expect(rows[0]?.status).toBe('active');
    // No history row appended.
    expect(lifecycleRows(client)).toHaveLength(0);
  });

  it('forbids cross-tenant transitions', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [{ id: ERR_ID, user_id: 'other-user', status: 'active' }],
        error_lifecycle_events: [],
      },
    });
    await expect(
      transitionStatus(client, SUB, ERR_ID, { to_status: 'in_review', trigger: 'manual' }, SUB),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when the error entry is missing', async () => {
    const client = makeFakeSupabase();
    await expect(
      transitionStatus(client, SUB, ERR_ID, { to_status: 'in_review', trigger: 'manual' }, SUB),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('chains active → in_review → resolved and writes two history rows', async () => {
    const client = makeFakeSupabase({
      tables: {
        error_entries: [{ id: ERR_ID, user_id: SUB, status: 'active' }],
        error_lifecycle_events: [],
      },
      uniqueConstraints: { event_outbox: OUTBOX_UNIQUE },
    });
    await transitionStatus(client, SUB, ERR_ID, { to_status: 'in_review', trigger: 'student_review' }, SUB);
    const { errorEntry } = await transitionStatus(
      client,
      SUB,
      ERR_ID,
      { to_status: 'resolved', trigger: 'student_review', reason: 'qualifying correct' },
      SUB,
    );
    expect(errorEntry.status).toBe('resolved');
    expect(lifecycleRows(client)).toHaveLength(2);
  });
});

describe('listLifecycleEvents', () => {
  it('returns history ordered newest first', async () => {
    const now = Date.now();
    const t1 = new Date(now - 2000).toISOString();
    const t2 = new Date(now - 1000).toISOString();
    const t3 = new Date(now).toISOString();
    const client = makeFakeSupabase({
      tables: {
        error_entries: [{ id: ERR_ID, user_id: SUB, status: 'resolved' }],
        error_lifecycle_events: [
          { id: 'e1', error_entry_id: ERR_ID, from_status: 'active', to_status: 'in_review', trigger: 'manual', created_at: t1 },
          { id: 'e2', error_entry_id: ERR_ID, from_status: 'in_review', to_status: 'resolved', trigger: 'student_review', created_at: t2 },
          { id: 'e3', error_entry_id: ERR_ID, from_status: 'resolved', to_status: 'reopened', trigger: 'manual', created_at: t3 },
        ],
      },
    });
    const events = await listLifecycleEvents(client, SUB, ERR_ID);
    expect(events.map((e) => e.to_status)).toEqual(['reopened', 'resolved', 'in_review']);
  });
});
