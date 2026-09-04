/**
 * KRODEX API — security audit logger (Phase 14).
 *
 * A single helper that writes a row to the `audit_events` table
 * for every privileged operation. The API owns the schema; the
 * logger is the only writer from application code.
 *
 * Posture:
 *   - INSERT-only. We do not expose UPDATE or DELETE.
 *   - Service-role client. The table's RLS lets only the
 *     service role through.
 *   - Best-effort. If the audit insert fails, the API logs the
 *     failure but does NOT roll back the privileged operation —
 *     security observability is a separate concern from the
 *     operation itself. The original Phase 0–13 rule "a
 *     notification failure does not roll back the source
 *     transaction" generalizes to "an audit failure does not
 *     roll back the privileged operation". An un-audited
 *     privileged op is a known issue; a failed privileged op
 *     is a worse outcome.
 *   - No PII in metadata. The logger documents this in the
 *     type signature: `metadata` is `Record<string, string | number | boolean | null>`.
 *     No objects, no arrays, no request bodies. Just labels.
 *
 * Why a thin helper rather than a full ORM:
 *   - Privileged operations are few (5 in Phase 0–14). A
 *     three-line helper is more honest than a framework.
 *   - Tests can stub the helper instead of mocking a database
 *     adapter.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';

export type AuditAction =
  | 'ANALYTICS_ADMIN_RECOMPUTE'
  | 'STUDENT_MODEL_ADMIN_RECOMPUTE'
  | 'PLANNER_CHECK_MISSED'
  | 'EVIDENCE_ASSET_SOFT_DELETE'
  | 'OUTBOX_EVENT_REPLAY'
  | 'PROFILE_DELETE'
  | 'PROFILE_EXPORT';

export interface AuditEvent {
  /** Who did it. A user UUID, 'service_role', or 'system'. */
  readonly actorId: string;
  /** High-level action label. */
  readonly action: AuditAction;
  /** Resource name (e.g. 'analytics_rollup'). Optional. */
  readonly resource?: string;
  /** Primary key of the affected row. Optional. */
  readonly resourceId?: string;
  /** Scalar metadata. No PII, no request bodies, no objects. */
  readonly metadata?: Record<string, string | number | boolean | null>;
  /** X-Request-ID or other correlation id. */
  readonly requestId?: string;
}

export interface AuditLogger {
  /** Write one audit row. Never throws. */
  log(event: AuditEvent): Promise<void>;
  /** Flush the underlying client (no-op in current implementation). */
  flush(): Promise<void>;
}

/**
 * Construct an audit logger backed by the service-role client.
 *
 * The service client is required: the table's RLS denies
 * non-service-role writes. The env guard is the caller's
 * responsibility — `loadEnv().hasServiceRole` should be true
 * before any route that uses the logger runs. We log a warning
 * and short-circuit when this is not the case so a misconfigured
 * environment fails closed (no audit) rather than throwing.
 */
export function makeAuditLogger(
  serviceClient: SupabaseClient | null,
  log: FastifyBaseLogger,
): AuditLogger {
  return {
    async log(event: AuditEvent): Promise<void> {
      if (!serviceClient) {
        log.warn(
          { event },
          'krodex.audit.no_service_role: privileged op ran without an audit row; ' +
            'configure SUPABASE_SERVICE_ROLE_KEY to fix',
        );
        return;
      }
      try {
        const row = {
          actor_id: event.actorId,
          action: event.action,
          resource: event.resource ?? null,
          resource_id: event.resourceId ?? null,
          metadata: event.metadata ?? {},
          request_id: event.requestId ?? null,
        };
        const { error } = await serviceClient.from('audit_events').insert(row);
        if (error) {
          log.error(
            { event, error: error.message },
            'krodex.audit.insert_failed: privileged op ran but audit row was not written',
          );
        }
      } catch (err) {
        // Best-effort. The privileged operation has already
        // happened by the time we get here; throwing would not
        // undo it.
        log.error(
          { err, event },
          'krodex.audit.unexpected_error: privileged op ran but audit logging threw',
        );
      }
    },
    async flush(): Promise<void> {
      // No-op: Supabase client queues are best-effort. Future
      // phases could add a bounded retry queue here.
    },
  };
}

/**
 * In-memory audit logger for tests. Captures all events so the
 * test can assert on them without a database.
 */
export function makeInMemoryAuditLogger(): AuditLogger & { readonly events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async log(event: AuditEvent): Promise<void> {
      events.push(event);
    },
    async flush(): Promise<void> {
      // no-op
    },
  };
}
