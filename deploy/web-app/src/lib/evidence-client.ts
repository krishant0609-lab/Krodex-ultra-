/**
 * KRODEX web — Evidence client (Phase 9).
 *
 * Typed fetch wrapper for `/evidence/:id`. The endpoint returns
 * a per-evidence record plus, when an available snapshot exists,
 * a freshly-signed authorized URL. The URL is short-lived
 * (default 1 hour TTL); callers should refetch on the next page
 * load to refresh it.
 *
 * Why a separate client: the evidence + lifecycle endpoints are
 * not part of the existing route groups. We keep the surface
 * tiny — `fetchEvidence()` is the only thing the UI needs at
 * this layer.
 */

import type { ErrorEvidenceRow } from '@krodex/shared';
import { api } from './api-client';

export interface EvidenceSnapshot {
  /** Short-lived signed URL pointing at the private storage bucket. */
  url: string;
  /** MIME type of the snapshot binary. */
  mimeType: string;
  /** Snapshot size in bytes. */
  byteSize: number;
  /** ISO 8601 expiry of the signed URL. */
  expiresAt: string;
}

export interface EvidenceDetail {
  evidence: ErrorEvidenceRow;
  /** Authorized snapshot descriptor, or null if no snapshot is available. */
  snapshot: EvidenceSnapshot | null;
}

/**
 * Fetch one ErrorEvidence row plus its authorized snapshot URL.
 * The URL is server-signed and expires per the configured TTL;
 * do not cache it past `expiresAt`.
 */
export async function fetchEvidence(evidenceId: string): Promise<EvidenceDetail> {
  return api.get<EvidenceDetail>(`/evidence/${evidenceId}`);
}
