/**
 * KRODEX API — progress evidence + notifications.
 *
 * Phase 2 surface: list evidence rows, mark a notification as
 * read / dismissed, list notifications. The actual evidence
 * writes happen inside the submit_test_attempt / schedule_review
 * / record_progress_evidence RPCs — those keep the counter math
 * in one transaction.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  NotificationRow,
  NotificationSeverity,
  ProgressDimension,
  ProgressEvidenceRow,
} from '@krodex/shared';
import { NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';

export interface ListEvidenceFilter {
  dimension?: ProgressDimension;
  since?: string;
  until?: string;
  limit?: number;
}

export async function listProgressEvidence(
  client: SupabaseClient,
  userId: string,
  filter: ListEvidenceFilter = {},
): Promise<readonly ProgressEvidenceRow[]> {
  let q = client
    .from('progress_evidence')
    .select('*')
    .eq('user_id', userId)
    .order('captured_at', { ascending: false })
    .limit(Math.min(filter.limit ?? 50, 200));
  if (filter.dimension) q = q.eq('dimension', filter.dimension);
  if (filter.since) q = q.gte('captured_at', filter.since);
  if (filter.until) q = q.lte('captured_at', filter.until);
  const { data, error } = await q;
  if (error) throw new Error(`listProgressEvidence failed: ${error.message}`);
  return asRows<ProgressEvidenceRow>(data ?? []);
}

export interface RecordProgressEvidenceInput {
  dimension: ProgressDimension;
  delta: string | number;
  ref_kind: string;
  ref_id: string;
  metadata?: Record<string, unknown>;
}

export async function recordProgressEvidence(
  client: SupabaseClient,
  userId: string,
  input: RecordProgressEvidenceInput,
): Promise<ProgressEvidenceRow> {
  const { data, error } = await client.rpc('record_progress_evidence', {
    p_dimension: input.dimension,
    p_delta: String(input.delta),
    p_ref_kind: input.ref_kind,
    p_ref_id: input.ref_id,
    p_metadata: input.metadata ?? {},
  } as never);
  if (error) {
    throw new Error(`recordProgressEvidence failed: ${error.message}`);
  }
  // Re-read so the response carries the persisted row.
  const id = (data as { id?: string } | null)?.id;
  if (!id) {
    // RPC should always return the row, but fall back to a list
    // read so the API still responds with a typed row.
    const list = await listProgressEvidence(client, userId, { limit: 1 });
    return list[0]!;
  }
  const { data: row, error: readErr } = await client
    .from('progress_evidence')
    .select('*')
    .eq('id', id)
    .single();
  if (readErr || !row) {
    throw new Error(`recordProgressEvidence read-back failed: ${readErr?.message ?? 'no row'}`);
  }
  assertOwned(row, userId);
  return asRow<ProgressEvidenceRow>(row);
}

export interface ListNotificationsFilter {
  unread_only?: boolean;
  severity?: NotificationSeverity;
  limit?: number;
}

export async function listNotifications(
  client: SupabaseClient,
  userId: string,
  filter: ListNotificationsFilter = {},
): Promise<readonly NotificationRow[]> {
  let q = client
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(filter.limit ?? 50, 200));
  if (filter.unread_only) q = q.is('read_at', null);
  if (filter.severity) q = q.eq('severity', filter.severity);
  const { data, error } = await q;
  if (error) throw new Error(`listNotifications failed: ${error.message}`);
  return asRows<NotificationRow>(data ?? []);
}

export async function getNotification(
  client: SupabaseClient,
  userId: string,
  notificationId: string,
): Promise<NotificationRow> {
  const { data, error } = await client
    .from('notifications')
    .select('*')
    .eq('id', notificationId)
    .maybeSingle();
  if (error) throw new Error(`getNotification failed: ${error.message}`);
  if (!data) throw new NotFoundError('notification not found');
  assertOwned(data, userId);
  return asRow<NotificationRow>(data);
}

export interface UpdateNotificationInput {
  read?: boolean;
  dismissed?: boolean;
}

export async function updateNotification(
  client: SupabaseClient,
  userId: string,
  notificationId: string,
  patch: UpdateNotificationInput,
): Promise<NotificationRow> {
  const before = await getNotification(client, userId, notificationId);
  const next: Record<string, unknown> = {};
  if (patch.read === true && !before.read_at) next.read_at = new Date().toISOString();
  if (patch.read === false) next.read_at = null;
  if (patch.dismissed === true && !before.dismissed_at) next.dismissed_at = new Date().toISOString();
  if (patch.dismissed === false) next.dismissed_at = null;
  if (Object.keys(next).length === 0) return before;
  const { data, error } = await client
    .from('notifications')
    .update(next)
    .eq('id', before.id)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`updateNotification failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<NotificationRow>(data);
}
