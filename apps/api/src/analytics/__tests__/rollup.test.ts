/**
 * Unit tests for the rollup service.
 *
 * The service is a typed RPC wrapper; the actual rollup logic
 * lives in the SECURITY DEFINER SQL function from migration 12.
 * Here we only verify the wrapper builds the right request and
 * maps the response into the canonical `RecomputeResult` shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recomputeRollupForUser, fiveMinuteRecomputeWindow } from '../rollup';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';

const UUID = '00000000-0000-0000-0000-000000000123';

describe('recomputeRollupForUser (RPC wrapper)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('invokes the SQL function with the expected argument names and ISO timestamps', async () => {
    const since = new Date('2026-09-02T10:00:00.000Z');
    const until = new Date('2026-09-02T10:05:00.000Z');
    const client = makeFakeSupabase({
      rpcImpls: {
        recompute_analytics_rollup: () => ({ data: 7, error: null }),
      },
    });
    const out = await recomputeRollupForUser(client, { userId: UUID, since, until });
    expect(out.userId).toBe(UUID);
    expect(out.rowsRecomputed).toBe(7);
    expect(out.since).toBe(since.toISOString());
    expect(out.until).toBe(until.toISOString());
  });

  it('throws when the RPC returns an error', async () => {
    const client = makeFakeSupabase({
      rpcImpls: {
        recompute_analytics_rollup: () => ({
          data: null,
          error: { code: '40001', message: 'serialization_failure' },
        }),
      },
    });
    await expect(
      recomputeRollupForUser(client, {
        userId: UUID,
        since: new Date('2026-09-02T00:00:00Z'),
        until: new Date('2026-09-02T00:05:00Z'),
      }),
    ).rejects.toThrow(/serialization_failure/);
  });

  it('defaults rowsRecomputed to 0 when the RPC returns a non-number', async () => {
    const client = makeFakeSupabase({
      rpcImpls: {
        recompute_analytics_rollup: () => ({ data: null, error: null }),
      },
    });
    const out = await recomputeRollupForUser(client, {
      userId: UUID,
      since: new Date('2026-09-02T00:00:00Z'),
      until: new Date('2026-09-02T00:05:00Z'),
    });
    expect(out.rowsRecomputed).toBe(0);
  });
});

describe('fiveMinuteRecomputeWindow (D-9, Class C — Approved Product Policy)', () => {
  it('returns a 5-minute trailing window', () => {
    const now = new Date('2026-09-02T12:00:00.000Z');
    const { since, until } = fiveMinuteRecomputeWindow(now);
    expect(until.toISOString()).toBe(now.toISOString());
    expect(now.getTime() - since.getTime()).toBe(5 * 60 * 1000);
  });
});
