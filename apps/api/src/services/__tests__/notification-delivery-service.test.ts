/**
 * KRODEX — NotificationDeliveryService unit tests.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import { dispatchPendingDeliveries } from '../notification-delivery-service';

function asRows<T>(client: unknown, table: string): T[] {
  return (client as { __rows: (t: string) => unknown[] }).__rows(table) as T[];
}

describe('dispatchPendingDeliveries', () => {
  it('returns zeros when no pending in_app rows exist', async () => {
    const client = makeFakeSupabase({ tables: { notification_deliveries: [] } });
    const out = await dispatchPendingDeliveries(client, { now: () => new Date('2026-09-04T10:00:00.000Z') });
    expect(out).toEqual({ processed: 0, failed: 0 });
  });

  it('transitions pending in_app rows to sent', async () => {
    const sentAt = new Date('2026-09-04T10:00:00.000Z');
    const client = makeFakeSupabase({
      tables: {
        notification_deliveries: [
          { id: 'd1', user_id: 'u1', notification_id: 'n1', channel: 'in_app', state: 'pending', attempt_count: 0, last_error: null, sent_at: null, created_at: '2026-09-04T09:00:00.000Z' },
          { id: 'd2', user_id: 'u1', notification_id: 'n2', channel: 'in_app', state: 'pending', attempt_count: 0, last_error: null, sent_at: null, created_at: '2026-09-04T09:00:00.000Z' },
        ],
      },
    });
    const out = await dispatchPendingDeliveries(client, { now: () => sentAt });
    expect(out).toEqual({ processed: 2, failed: 0 });
    const rows = asRows<{ state: string; sent_at: string | null; attempt_count: number }>(client, 'notification_deliveries');
    expect(rows.every((r) => r.state === 'sent')).toBe(true);
    expect(rows.every((r) => r.sent_at === sentAt.toISOString())).toBe(true);
    expect(rows.every((r) => r.attempt_count === 1)).toBe(true);
  });

  it('does not touch email or push rows (they stay pending)', async () => {
    const client = makeFakeSupabase({
      tables: {
        notification_deliveries: [
          { id: 'd1', user_id: 'u1', notification_id: 'n1', channel: 'email', state: 'pending', attempt_count: 0, last_error: null, sent_at: null, created_at: '2026-09-04T09:00:00.000Z' },
          { id: 'd2', user_id: 'u1', notification_id: 'n2', channel: 'push', state: 'pending', attempt_count: 0, last_error: null, sent_at: null, created_at: '2026-09-04T09:00:00.000Z' },
        ],
      },
    });
    const out = await dispatchPendingDeliveries(client, { now: () => new Date() });
    expect(out).toEqual({ processed: 0, failed: 0 });
    const rows = asRows<{ state: string; channel: string }>(client, 'notification_deliveries');
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
  });

  it('skips rows that are already sent (idempotent on re-dispatch)', async () => {
    const client = makeFakeSupabase({
      tables: {
        notification_deliveries: [
          { id: 'd1', user_id: 'u1', notification_id: 'n1', channel: 'in_app', state: 'sent', attempt_count: 1, last_error: null, sent_at: '2026-09-04T09:30:00.000Z', created_at: '2026-09-04T09:00:00.000Z' },
          { id: 'd2', user_id: 'u1', notification_id: 'n2', channel: 'in_app', state: 'pending', attempt_count: 0, last_error: null, sent_at: null, created_at: '2026-09-04T09:00:00.000Z' },
        ],
      },
    });
    const out = await dispatchPendingDeliveries(client, { now: () => new Date('2026-09-04T10:00:00.000Z') });
    // Only the pending row gets re-read; the sent row is excluded by the SELECT filter.
    expect(out).toEqual({ processed: 1, failed: 0 });
  });

  it('honors the limit option', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i + 1}`,
      user_id: 'u1',
      notification_id: `n${i + 1}`,
      channel: 'in_app',
      state: 'pending',
      attempt_count: 0,
      last_error: null,
      sent_at: null,
      created_at: '2026-09-04T09:00:00.000Z',
    }));
    const client = makeFakeSupabase({ tables: { notification_deliveries: rows } });
    const out = await dispatchPendingDeliveries(client, { limit: 2, now: () => new Date() });
    expect(out.processed).toBeLessThanOrEqual(2);
  });
});
