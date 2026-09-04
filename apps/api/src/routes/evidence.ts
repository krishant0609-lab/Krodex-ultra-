/**
 * KRODEX API — /evidence and /errors/:id/lifecycle routes (Phase 9).
 *
 *   GET /evidence/:id                  — read one ErrorEvidence row +
 *                                         authorized snapshot URL (if
 *                                         one exists and is still
 *                                         "available"). The snapshot
 *                                         URL is a short-lived signed
 *                                         URL generated server-side
 *                                         (TTL 1h by default); it is
 *                                         never cached permanently.
 *   GET /errors/:id/evidence           — list evidence rows that
 *                                         belong to this error entry,
 *                                         newest first. Used by the
 *                                         error detail page to render
 *                                         the per-attempt snapshot
 *                                         history.
 *   GET /errors/:id/lifecycle          — list the immutable state
 *                                         transitions for the error
 *                                         entry, newest first.
 *
 * All endpoints are student-authenticated. RLS on `error_evidence`
 * and `error_lifecycle_events` is the second line of defense — the
 * service-layer `assertOwned` gate converts a cross-tenant read into
 * a 404 (NotFoundError) rather than an empty list.
 *
 * Snapshot URL policy (TRD §10): the route never exposes a
 * permanent public URL. The client receives a freshly-generated
 * signed URL on each request and the browser caches it for the
 * remaining TTL via `Cache-Control: private, max-age=…`.
 */

import type { FastifyInstance } from 'fastify';
import type { ErrorEvidenceRow, ErrorLifecycleEventRow } from '@krodex/shared';
import { ok, requireAuth } from './_helpers';
import { parseParams } from '../validation/parse';
import { IdParam } from '../validation/schemas';
import * as errorEvidence from '../services/error-evidence-service';
import * as errorLifecycle from '../services/error-lifecycle-service';
import * as evidenceAsset from '../services/evidence-asset-service';
// Default TTL when env doesn't override. Storage signed URLs are
// short-lived by definition; 1 hour matches the documented
// behaviour (TRD §10, Plan §13).
const DEFAULT_AUTHORIZED_URL_TTL_SECONDS = 3600;

export function registerEvidenceRoutes(app: FastifyInstance): void {
  /**
   * GET /evidence/:id
   *
   * Returns the ErrorEvidence row plus, when a snapshot asset
   * exists and is `available`, a freshly-signed authorized URL
   * pointing at the private bucket. The URL has a TTL (default
   * 1 hour); the client should refetch on the next page load
   * to refresh it.
   *
   * Responses:
   *   200 — { evidence, snapshot: { url, mimeType, byteSize, expiresAt } | null }
   *   404 — evidence not found OR not owned by caller
   *   401 — unauthenticated
   */
  app.get('/evidence/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const evidence = await errorEvidence.getErrorEvidence(
      req.supabaseUser,
      auth.userId,
      params.id,
    );
    const snapshot = await resolveAuthorizedSnapshot(app, req.supabaseUser, evidence);
    return ok<{
      evidence: ErrorEvidenceRow;
      snapshot: { url: string; mimeType: string; byteSize: number; expiresAt: string } | null;
    }>(reply, { evidence, snapshot });
  });

  /**
   * GET /errors/:id/evidence
   *
   * Returns the evidence rows that belong to this error entry,
   * newest first. The list endpoint deliberately does NOT include
   * the signed snapshot URL — that's per-evidence and short-lived.
   * The frontend requests `/evidence/:id` only for the row the
   * student actually clicks "view" on.
   */
  app.get(
    '/errors/:id/evidence',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const rows = await errorEvidence.listEvidenceForError(
        req.supabaseUser,
        auth.userId,
        params.id,
      );
      return ok<readonly ErrorEvidenceRow[]>(reply, rows);
    },
  );

  /**
   * GET /errors/:id/lifecycle
   *
   * Returns the immutable state-transition history for the error
   * entry, newest first. The history table is INSERT-only; the
   * API exposes only SELECT.
   */
  app.get(
    '/errors/:id/lifecycle',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const events = await errorLifecycle.listLifecycleEvents(
        req.supabaseUser,
        auth.userId,
        params.id,
      );
      return ok<readonly ErrorLifecycleEventRow[]>(reply, events);
    },
  );
}

/**
 * If a `available` snapshot exists for the evidence row, return a
 * fresh signed URL with the documented TTL. Otherwise return null
 * — the UI shows the student/expected answer text as a fallback.
 *
 * The TTL is sourced from the runtime env so tests and the live
 * deployment can use different values. The signed URL itself is
 * generated by the storage backend; we just hand the client a
 * time-boxed handle.
 */
async function resolveAuthorizedSnapshot(
  app: FastifyInstance,
  client: import('@supabase/supabase-js').SupabaseClient,
  evidence: ErrorEvidenceRow,
): Promise<{ url: string; mimeType: string; byteSize: number; expiresAt: string } | null> {
  const asset = await evidenceAsset.findActiveAssetForEvidence(
    client,
    evidence.id,
  );
  if (!asset || asset.status !== 'available') {
    return null;
  }
  const ttl = app.krodexEnv.storageSignedUrlTtlSeconds ?? DEFAULT_AUTHORIZED_URL_TTL_SECONDS;
  const signed = await evidenceAsset.getAuthorizedUrl(client, asset.id, ttl);
  if (!signed) {
    // Asset record exists but the storage backend refused to sign
    // (e.g. transient network). Surface as "no snapshot" rather
    // than 500; the UI falls back to the answer-text view.
    return null;
  }
  return {
    url: signed.url,
    mimeType: asset.mime_type,
    // Postgres bigint → string in the Supabase row. The client
    // contract is a plain number; coerce with a safe fallback to
    // 0 so a malformed row never throws a 500.
    byteSize: Number(asset.byte_size ?? 0),
    expiresAt: signed.expiresAt,
  };
}
