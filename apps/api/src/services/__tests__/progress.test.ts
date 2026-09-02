/**
 * KRODEX API — progress service tests.
 *
 * Covers:
 *  - listProgressEvidence filters by dimension + since + until
 *  - recordProgressEvidence invokes the record_progress_evidence
 *    RPC and returns the persisted row
 *  - listNotifications filters by unread_only + severity
 *  - getNotification throws NotFoundError on miss
 *  - updateNotification sets read_at / dismissed_at on the
 *    corresponding booleans, leaves the row alone when nothing
 *    changes
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  listProgressEvidence,
  recordProgressEvidence,
  listNotifications,
  getNotification,
  updateNotification,
} from '../progress';
import { NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';
const NOTIF_ID = '22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333333';

describe('listProgressEvidence', () => {
  it('filters by dimension and since/until', async () => {
    const client = makeFakeSupabase({
      tables: {
        progress_evidence: [
          { id: 'e1', user_id: SUB, dimension: 'test_accuracy', captured_at: '2026-09-02T00:00:00Z' },
          { id: 'e2', user_id: SUB, dimension: 'syllabus_coverage', captured_at: '2026-09-01T00:00:00Z' },
        ],
      },
    });
    const out = await listProgressEvidence(client, SUB, {
      dimension: 'test_accuracy',
      since: '2026-09-01T00:00:00Z',
      until: '2026-09-30T00:00:00Z',
    });
    expect(out.map((r) => r.id)).toEqual(['e1']);
  });
});

describe('recordProgressEvidence', () => {
  it('invokes the RPC and returns the persisted row', async () => {
    const client = makeFakeSupabase({
      tables: {
        progress_evidence: [
          {
            id: EVIDENCE_ID,
            user_id: SUB,
            dimension: 'test_accuracy',
            delta: '0.1',
            captured_at: '2026-09-02T00:00:00Z',
          },
        ],
      },
    });
    const row = await recordProgressEvidence(client, SUB, {
      dimension: 'test_accuracy',
      delta: '0.1',
      ref_kind: 'test_attempt',
      ref_id: 'att-1',
    });
    expect(row.id).toBe(EVIDENCE_ID);
    expect(row.user_id).toBe(SUB);
  });
});

describe('listNotifications / getNotification / updateNotification', () => {
  it('listNotifications filters by unread_only and severity', async () => {
    const client = makeFakeSupabase({
      tables: {
        notifications: [
          { id: 'n1', user_id: SUB, severity: 'info', read_at: null, created_at: '2026-09-02T00:00:00Z' },
          { id: 'n2', user_id: SUB, severity: 'info', read_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
          { id: 'n3', user_id: SUB, severity: 'warning', read_at: null, created_at: '2026-08-31T00:00:00Z' },
        ],
      },
    });
    const out = await listNotifications(client, SUB, { unread_only: true, severity: 'info' });
    expect(out.map((r) => r.id)).toEqual(['n1']);
  });

  it('getNotification throws NotFoundError on miss', async () => {
    const client = makeFakeSupabase();
    await expect(getNotification(client, SUB, NOTIF_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateNotification stamps read_at on read=true', async () => {
    const client = makeFakeSupabase({
      tables: {
        notifications: [
          { id: NOTIF_ID, user_id: SUB, read_at: null, dismissed_at: null },
        ],
      },
    });
    const row = await updateNotification(client, SUB, NOTIF_ID, { read: true });
    expect(row.read_at).toBeTruthy();
  });

  it('updateNotification is a no-op when nothing changes', async () => {
    const client = makeFakeSupabase({
      tables: {
        notifications: [
          { id: NOTIF_ID, user_id: SUB, read_at: '2026-09-01T00:00:00Z', dismissed_at: null },
        ],
      },
    });
    const row = await updateNotification(client, SUB, NOTIF_ID, {});
    expect(row.read_at).toBe('2026-09-01T00:00:00Z');
  });
});
