/**
 * KRODEX API — database health probe.
 *
 * Returns a small, safe-to-expose snapshot of the database layer.
 * Used by the existing GET /health route (Phase 0) and by the Phase 1
 * verification harness.
 *
 * When the persistence layer is not configured (no SUPABASE_URL), the
 * function returns a degraded-but-honest snapshot. The API server still
 * boots and answers /health; the persistence layer simply reports itself
 * as "not configured". This is the same behavior the rest of the app
 * already exhibits in this Docker-less dev environment.
 *
 * When the persistence layer IS configured, the probe runs a `select 1`
 * via the service-role client and reports the round-trip latency.
 */

import type { ApiEnv } from '../config/env';
import { getServiceClient } from './supabase';

export type DbHealthStatus = 'ok' | 'degraded' | 'unconfigured' | 'unreachable';

export interface DbHealthSnapshot {
  status: DbHealthStatus;
  configured: boolean;
  hasServiceRole: boolean;
  latencyMs: number | null;
  message: string;
  /** Only present when status is 'unreachable'. */
  error?: string;
}

export async function dbHealth(env: ApiEnv): Promise<DbHealthSnapshot> {
  if (!env.hasSupabase) {
    return {
      status: 'unconfigured',
      configured: false,
      hasServiceRole: env.hasServiceRole,
      latencyMs: null,
      message:
        'Supabase not configured: SUPABASE_URL is empty. ' +
        'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Engineering Support Spec §13.1) to enable the persistence layer.',
    };
  }

  if (!env.hasServiceRole) {
    return {
      status: 'degraded',
      configured: true,
      hasServiceRole: false,
      latencyMs: null,
      message:
        'Supabase URL is set but SUPABASE_SERVICE_ROLE_KEY is empty. ' +
        'Health probe and cross-tenant tooling are disabled until the key is provided.',
    };
  }

  const started = Date.now();
  try {
    const client = getServiceClient(env);
    // The cheapest query that proves connectivity. We deliberately
    // avoid reading any user-scoped table here — the health route
    // must never leak data, even with the service role.
    const { error } = await client.rpc('health_ping').maybeSingle();
    const latencyMs = Date.now() - started;

    // If the RPC doesn't exist (we did not create one in Phase 1), fall
    // back to a no-op select on a known small global table. Both indicate
    // "database is reachable" without leaking user data.
    if (error && /health_ping.*not found/i.test(error.message ?? '')) {
      const { error: fallbackErr } = await client
        .from('subjects')
        .select('id', { count: 'exact', head: true });
      if (fallbackErr) {
        return {
          status: 'unreachable',
          configured: true,
          hasServiceRole: true,
          latencyMs: Date.now() - started,
          message: 'Database query failed during health probe.',
          error: fallbackErr.message,
        };
      }
    } else if (error) {
      return {
        status: 'unreachable',
        configured: true,
        hasServiceRole: true,
        latencyMs,
        message: 'Database query failed during health probe.',
        error: error.message,
      };
    }

    return {
      status: 'ok',
      configured: true,
      hasServiceRole: true,
      latencyMs,
      message: 'Database reachable via Supabase service role.',
    };
  } catch (err) {
    return {
      status: 'unreachable',
      configured: true,
      hasServiceRole: true,
      latencyMs: Date.now() - started,
      message: 'Database health probe threw an exception.',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
