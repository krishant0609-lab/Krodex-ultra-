/**
 * KRODEX API — evidence asset service tests.
 *
 * Covers:
 *   - uploadSnapshot: success path (binary stored, row inserted)
 *   - uploadSnapshot: storage failure flips status to 'failed'
 *   - getAuthorizedUrl: returns a signed URL for available assets
 *   - getAuthorizedUrl: returns null for missing/failed/deleted
 *   - softDeleteAsset: flips status and removes the binary
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  composeStorageKey,
  findActiveAssetForEvidence,
  getAuthorizedUrl,
  softDeleteAsset,
  uploadSnapshot,
} from '../evidence-asset-service';

const SUB = '11111111-1111-4111-8111-111111111111';
const EVIDENCE = '33333333-3333-4333-8333-333333333333';
const BUCKET = 'error-evidence';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG_BYTES = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20]);

function rows(client: ReturnType<typeof makeFakeSupabase>): Array<Record<string, unknown>> {
  return (client as unknown as { __rows: (t: string) => Array<Record<string, unknown>> }).__rows('evidence_assets');
}

function storage(client: ReturnType<typeof makeFakeSupabase>, bucket: string): Map<string, Uint8Array> {
  return (client as unknown as { __storage: (b: string) => Map<string, Uint8Array> }).__storage(bucket);
}

function setStorageError(client: ReturnType<typeof makeFakeSupabase>, msg: string | null): void {
  (client as unknown as { __setStorageError: (m: string | null) => void }).__setStorageError(msg);
}

describe('composeStorageKey', () => {
  it('builds the documented path shape', () => {
    const k = composeStorageKey(BUCKET, SUB, EVIDENCE, 'asset-id', 'image/png');
    expect(k).toBe(`${BUCKET}/${SUB}/${EVIDENCE}/asset-id.png`);
  });

  it('switches extension for SVG', () => {
    const k = composeStorageKey(BUCKET, SUB, EVIDENCE, 'asset-id', 'image/svg+xml');
    expect(k).toBe(`${BUCKET}/${SUB}/${EVIDENCE}/asset-id.svg`);
  });
});

describe('uploadSnapshot', () => {
  it('uploads the binary and records a row with status=available', async () => {
    const client = makeFakeSupabase();
    const out = await uploadSnapshot(client, BUCKET, {
      userId: SUB,
      evidenceId: EVIDENCE,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
    });
    expect(out.asset.status).toBe('available');
    expect(out.asset.mime_type).toBe('image/png');
    expect(out.asset.byte_size).toBe(String(PNG_BYTES.byteLength));
    expect(out.asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.asset.storage_bucket).toBe(BUCKET);
    expect(rows(client)).toHaveLength(1);
    const store = storage(client, BUCKET);
    expect(store.get(out.storageKey)).toEqual(PNG_BYTES);
  });

  it('on storage failure still records the row with status=failed', async () => {
    const client = makeFakeSupabase();
    setStorageError(client, 'bucket offline');
    const out = await uploadSnapshot(client, BUCKET, {
      userId: SUB,
      evidenceId: EVIDENCE,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
    });
    expect(out.asset.status).toBe('failed');
    expect(rows(client)).toHaveLength(1);
  });
});

describe('getAuthorizedUrl', () => {
  it('returns a signed URL for an available asset', async () => {
    const client = makeFakeSupabase();
    const { asset } = await uploadSnapshot(client, BUCKET, {
      userId: SUB,
      evidenceId: EVIDENCE,
      bytes: SVG_BYTES,
      mimeType: 'image/svg+xml',
    });
    const out = await getAuthorizedUrl(client, asset.id, 600);
    expect(out).not.toBeNull();
    expect(out?.url).toMatch(new RegExp(`^https://fake\\.example/storage/v1/object/sign/${BUCKET}/`));
    expect(new Date(out!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns null when the asset does not exist', async () => {
    const client = makeFakeSupabase();
    const out = await getAuthorizedUrl(client, '99999999-9999-4999-8999-999999999999', 600);
    expect(out).toBeNull();
  });

  it('returns null when the asset is in a non-available state', async () => {
    const client = makeFakeSupabase();
    const { asset } = await uploadSnapshot(client, BUCKET, {
      userId: SUB,
      evidenceId: EVIDENCE,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
    });
    // Force the row to 'failed' (mimics a delete-then-soft-deleted history).
    await client.from('evidence_assets').update({ status: 'failed' }).eq('id', asset.id);
    const out = await getAuthorizedUrl(client, asset.id, 600);
    expect(out).toBeNull();
  });
});

describe('findActiveAssetForEvidence', () => {
  it('returns the most recent available asset', async () => {
    const client = makeFakeSupabase();
    await uploadSnapshot(client, BUCKET, {
      userId: SUB,
      evidenceId: EVIDENCE,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
    });
    const found = await findActiveAssetForEvidence(client, EVIDENCE);
    expect(found).not.toBeNull();
    expect(found?.status).toBe('available');
  });

  it('returns null when no available asset exists', async () => {
    const client = makeFakeSupabase();
    const found = await findActiveAssetForEvidence(client, EVIDENCE);
    expect(found).toBeNull();
  });
});

describe('softDeleteAsset', () => {
  it('flips status to deleted and removes the binary', async () => {
    const client = makeFakeSupabase();
    const { asset, storageKey } = await uploadSnapshot(client, BUCKET, {
      userId: SUB,
      evidenceId: EVIDENCE,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
    });
    const out = await softDeleteAsset(client, asset.id);
    expect(out.status).toBe('deleted');
    expect(storage(client, BUCKET).has(storageKey)).toBe(false);
  });

  it('is idempotent: deleting twice is a no-op', async () => {
    const client = makeFakeSupabase();
    const { asset } = await uploadSnapshot(client, BUCKET, {
      userId: SUB,
      evidenceId: EVIDENCE,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
    });
    await softDeleteAsset(client, asset.id);
    const out = await softDeleteAsset(client, asset.id);
    expect(out.status).toBe('deleted');
  });
});
