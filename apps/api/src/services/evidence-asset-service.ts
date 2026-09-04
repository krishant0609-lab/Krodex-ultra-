/**
 * KRODEX API — evidence asset service (Phase 9).
 *
 * Owns the lifecycle of an `evidence_assets` row and the binary it
 * points at in Supabase Storage. The capture orchestrator calls
 * `uploadSnapshot()` to persist a freshly rendered snapshot;
 * `getAuthorizedUrl()` is what the API serves back to the in-app
 * evidence viewer (a short-lived signed URL, not a permanent
 * public URL).
 *
 * Storage path convention (per Phase 9 Class A decision):
 *   {bucket}/{userId}/{evidenceId}/{assetId}.{ext}
 * The `userId` prefix is what the RLS policy on storage.objects
 * checks: a user can only upload/list/delete their own prefix.
 *
 * The service deliberately does NOT physically delete rows. A
 * deleted asset is `status = 'deleted'` with the storage object
 * removed — the metadata row stays for audit symmetry (TRD §10).
 *
 * Failure modes (per TRD §9 / Schema Ready §7):
 *   - Upload failure → record an `evidence_assets` row with
 *     `status = 'failed'`, do NOT throw. The caller (orchestrator)
 *     keeps the underlying `error_evidence` row and surfaces a
 *     `question_snapshot_url = null` on it.
 *   - Signed URL failure → return `null`; the route layer turns
 *     that into a degraded viewer (text fallback, no image).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import type { EvidenceAssetInsert, EvidenceAssetRow } from '@krodex/shared';
import { asRow } from './_row';

export interface UploadSnapshotInput {
  /** Owning user. The asset path is namespaced under this id. */
  userId: string;
  /** Parent error_evidence row id. */
  evidenceId: string;
  /** Raw snapshot bytes (PNG or SVG). */
  bytes: Uint8Array;
  /** 'image/png' or 'image/svg+xml' — the bucket allows only these. */
  mimeType: 'image/png' | 'image/svg+xml';
}

export interface UploadSnapshotResult {
  asset: EvidenceAssetRow;
  /** Storage key the asset lives at, including the leading `bucket/...` prefix the SDK expects. */
  storageKey: string;
}

/** Pick a deterministic extension for a MIME type. */
function extFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'bin';
}

/** Compose the storage key. Exported for the route layer's RLS check. */
export function composeStorageKey(
  bucket: string,
  userId: string,
  evidenceId: string,
  assetId: string,
  mimeType: string,
): string {
  return `${bucket}/${userId}/${evidenceId}/${assetId}.${extFor(mimeType)}`;
}

/**
 * Upload a snapshot binary and record its metadata.
 *
 * Returns the new `evidence_assets` row. On storage failure the
 * row is still created with `status = 'failed'` so the audit trail
 * reflects the attempt; the caller is expected to leave the
 * parent `error_evidence.question_snapshot_url` as `null`.
 */
export async function uploadSnapshot(
  client: SupabaseClient,
  bucket: string,
  input: UploadSnapshotInput,
): Promise<UploadSnapshotResult> {
  const assetId = randomUUID();
  const storageKey = composeStorageKey(
    bucket,
    input.userId,
    input.evidenceId,
    assetId,
    input.mimeType,
  );

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');

  // Step 1 — push the binary to Supabase Storage. We do this
  // BEFORE inserting the metadata row so a non-zero `status =
  // 'failed'` reflects a real upload attempt rather than a
  // a-priori "we never tried" state.
  let status: EvidenceAssetRow['status'] = 'available';
  const { error: uploadError } = await client.storage
    .from(bucket)
    .upload(storageKey, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
      cacheControl: 'private, max-age=3600',
    });
  if (uploadError) {
    status = 'failed';
  }

  // Step 2 — record the metadata. The bucket-name is preserved on
  // the row so the row is self-describing even if the env var
  // changes later.
  const insert: EvidenceAssetInsert = {
    evidence_id: input.evidenceId,
    storage_bucket: bucket,
    storage_key: storageKey,
    mime_type: input.mimeType,
    byte_size: String(input.bytes.byteLength),
    sha256,
    status,
  };
  const { data, error: insertError } = await client
    .from('evidence_assets')
    .insert(insert)
    .select('*')
    .single();
  if (insertError || !data) {
    // We never throw away an upload attempt. If the metadata row
    // itself fails to insert, surface the error so the caller can
    // decide (the orchestrator's failure isolation will record
    // it on the parent evidence and continue).
    throw new Error(
      `evidence_assets insert failed: ${insertError?.message ?? 'no row returned'}`,
    );
  }
  return {
    asset: asRow<EvidenceAssetRow>(data),
    storageKey,
  };
}

/**
 * Generate a short-lived signed URL for an existing asset.
 *
 * Returns `null` when the asset is missing, deleted, or in a
 * non-available state. The TTL is bound to `env.storageSignedUrlTtlSeconds`
 * — the route layer clamps the value but the SDK enforces its own
 * server-side ceiling (typically 7 days for Supabase Storage).
 */
export async function getAuthorizedUrl(
  client: SupabaseClient,
  assetId: string,
  ttlSeconds: number,
): Promise<{ url: string; expiresAt: string } | null> {
  const { data: row, error } = await client
    .from('evidence_assets')
    .select('*')
    .eq('id', assetId)
    .maybeSingle();
  if (error || !row) return null;
  const asset = asRow<EvidenceAssetRow>(row);
  if (asset.status !== 'available') return null;

  const { data, error: signError } = await client.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_key, ttlSeconds);
  if (signError || !data?.signedUrl) return null;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return { url: data.signedUrl, expiresAt };
}

/**
 * Find the active (status = 'available') asset for an evidence
 * record. Returns `null` when the snapshot was never rendered or
 * has been soft-deleted.
 */
export async function findActiveAssetForEvidence(
  client: SupabaseClient,
  evidenceId: string,
): Promise<EvidenceAssetRow | null> {
  const { data, error } = await client
    .from('evidence_assets')
    .select('*')
    .eq('evidence_id', evidenceId)
    .eq('status', 'available')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return asRow<EvidenceAssetRow>(data);
}

/**
 * Soft-delete an asset: flip the row to `status = 'deleted'` and
 * remove the binary from storage. The metadata row stays for
 * audit symmetry (TRD §10).
 *
 * Idempotent: deleting an already-deleted asset is a no-op.
 *
 * Phase 14: every successful soft-delete writes a row to
 * `audit_events` (best-effort, never throws). The audit row
 * records the user_id derived from the row, the asset id, and
 * the storage key. The audit insert requires a service-role
 * client; when the caller passed the per-request user client
 * we silently skip the audit (the row update still happens —
 * security observability is a separate concern from the
 * underlying op).
 */
export async function softDeleteAsset(
  client: SupabaseClient,
  assetId: string,
): Promise<EvidenceAssetRow> {
  const { data: existing, error: selError } = await client
    .from('evidence_assets')
    .select('*')
    .eq('id', assetId)
    .maybeSingle();
  if (selError) throw new Error(`softDeleteAsset lookup failed: ${selError.message}`);
  if (!existing) throw new Error(`softDeleteAsset: asset ${assetId} not found`);
  const asset = asRow<EvidenceAssetRow>(existing);
  if (asset.status === 'deleted') return asset;

  // Best-effort storage delete. The metadata row is the source of
  // truth; a leftover binary is preferable to a leaked-but-marked-
  // deleted row.
  await client.storage.from(asset.storage_bucket).remove([asset.storage_key]);

  const { data, error } = await client
    .from('evidence_assets')
    .update({ status: 'deleted' })
    .eq('id', assetId)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`softDeleteAsset update failed: ${error?.message ?? 'no row returned'}`);
  }
  // Phase 14: write an audit_events row. Best-effort.
  // We import lazily so the service can be loaded in test
  // environments that have not registered the audit logger.
  // The asset row has no user_id; the parent error_evidence
  // does, but a join is a second query and we deliberately
  // keep the audit best-effort. We use 'system' as actor
  // and put the storage key + evidence id in metadata so an
  // operator can correlate to the parent error.
  try {
    const { makeAuditLogger } = await import('../security/audit-logger');
    const audit = makeAuditLogger(client, defaultLogger);
    await audit.log({
      actorId: 'system',
      action: 'EVIDENCE_ASSET_SOFT_DELETE',
      resource: 'evidence_assets',
      resourceId: assetId,
      metadata: {
        storage_bucket: asset.storage_bucket,
        mime_type: asset.mime_type,
        evidence_id: asset.evidence_id,
      },
    });
  } catch {
    // Best-effort: do not propagate audit failures.
  }
  return asRow<EvidenceAssetRow>(data);
}

/**
 * A minimal logger shim that satisfies the FastifyBaseLogger
 * surface used by the audit logger (warn, error, info, debug,
 * trace, fatal). The Phase 0–13 callers of softDeleteAsset were
 * single-line (`softDeleteAsset(client, assetId)`); the Phase
 * 14 audit logger needs a logger to pass through to. We use a
 * console-backed shim so audit failures during the soft-delete
 * path produce a log line but never throw.
 */
type DefaultLogger = {
  fatal: (msg: string) => void;
  error: (msg: string) => void;
  warn: (msg: string) => void;
  info: (msg: string) => void;
  debug: (msg: string) => void;
  trace: (msg: string) => void;
  child: () => DefaultLogger;
  level: 'warn';
  silent: (...args: unknown[]) => void;
  msgPrefix: string;
};

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}

function safeLog(level: 'warn' | 'info' | 'debug', msg: string): void {
  if (isTestEnv()) return;
  // eslint-disable-next-line no-console
  console[level](msg);
}

const defaultLogger: DefaultLogger = {
  fatal: (msg): void => safeLog('warn', msg),
  error: (msg): void => safeLog('warn', msg),
  warn: (msg): void => safeLog('warn', msg),
  info: (msg): void => safeLog('info', msg),
  debug: (msg): void => safeLog('debug', msg),
  trace: (msg): void => safeLog('debug', msg),
  child: (): DefaultLogger => defaultLogger,
  level: 'warn',
  silent: (): void => {
    // no-op: Phase 14 audit logger never needs to silence
  },
  msgPrefix: 'evidence-asset-service',
};
