/**
 * KRODEX API — syllabus (tree) + syllabus progress.
 *
 * The tree (subjects/topics/sub_topics/questions) is global: every
 * read uses the per-request user client, which still sees the
 * global tables because the RLS policy is `to authenticated using
 * (true)`. The per-user progress rows are RLS-scoped to the
 * caller.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CoverageState,
  QuestionRow,
  SubjectRow,
  SubTopicRow,
  SyllabusProgressRow,
  TopicRow,
} from '@krodex/shared';
import { NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';

export async function listSubjects(client: SupabaseClient): Promise<readonly SubjectRow[]> {
  const { data, error } = await client
    .from('subjects')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) throw new Error(`listSubjects failed: ${error.message}`);
  return asRows<SubjectRow>(data ?? []);
}

export async function listTopics(
  client: SupabaseClient,
  filter: { subject_id?: string; parent_topic_id?: string | null } = {},
): Promise<readonly TopicRow[]> {
  let q = client.from('topics').select('*').order('display_order', { ascending: true });
  if (filter.subject_id) q = q.eq('subject_id', filter.subject_id);
  if (filter.parent_topic_id === null) q = q.is('parent_topic_id', null);
  else if (filter.parent_topic_id) q = q.eq('parent_topic_id', filter.parent_topic_id);
  const { data, error } = await q;
  if (error) throw new Error(`listTopics failed: ${error.message}`);
  return asRows<TopicRow>(data ?? []);
}

export async function listSubTopics(
  client: SupabaseClient,
  topicId: string,
): Promise<readonly SubTopicRow[]> {
  const { data, error } = await client
    .from('sub_topics')
    .select('*')
    .eq('topic_id', topicId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`listSubTopics failed: ${error.message}`);
  return asRows<SubTopicRow>(data ?? []);
}

export async function listQuestions(
  client: SupabaseClient,
  filter: {
    subject_id?: string;
    topic_id?: string;
    sub_topic_id?: string;
    difficulty?: string;
    type?: string;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<{ items: readonly QuestionRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
  let q = client
    .from('questions')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(limit + 1);
  if (filter.subject_id) q = q.eq('subject_id', filter.subject_id);
  if (filter.topic_id) q = q.eq('topic_id', filter.topic_id);
  if (filter.sub_topic_id) q = q.eq('sub_topic_id', filter.sub_topic_id);
  if (filter.difficulty) q = q.eq('difficulty', filter.difficulty);
  if (filter.type) q = q.eq('question_type', filter.type);
  if (filter.cursor) {
    const decoded = decodeQuestionCursor(filter.cursor);
    if (decoded) q = q.gt('id', decoded);
  }
  const { data, error } = await q;
  if (error) throw new Error(`listQuestions failed: ${error.message}`);
  const rows = asRows<QuestionRow>(data ?? []);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeQuestionCursor(items[items.length - 1]?.id) : null;
  return { items, nextCursor };
}

function encodeQuestionCursor(lastId: string | undefined): string | null {
  if (!lastId) return null;
  return Buffer.from(JSON.stringify({ after: lastId }), 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeQuestionCursor(cursor: string): string | null {
  try {
    const pad = cursor.length % 4 === 0 ? '' : '='.repeat(4 - (cursor.length % 4));
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const raw = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.after === 'string' ? obj.after : null;
  } catch {
    return null;
  }
}

export async function getQuestionOptions(
  client: SupabaseClient,
  questionId: string,
): Promise<readonly { id: string; display_order: number; body: string; is_correct: boolean }[]> {
  const { data, error } = await client
    .from('question_options')
    .select('id, display_order, body, is_correct')
    .eq('question_id', questionId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`getQuestionOptions failed: ${error.message}`);
  return asRows<{ id: string; display_order: number; body: string; is_correct: boolean }>(data ?? []);
}

export async function getSyllabusProgress(
  client: SupabaseClient,
  userId: string,
  scope: string,
  cursor?: string | null,
  limit = 25,
): Promise<{ items: readonly SyllabusProgressRow[]; nextCursor: string | null }> {
  let q = client
    .from('syllabus_progress')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit + 1);
  if (scope) q = q.eq('scope', scope);
  if (cursor) {
    const decoded = decodeProgressCursor(cursor);
    if (decoded) q = q.lt('updated_at', decoded);
  }
  const { data, error } = await q;
  if (error) throw new Error(`getSyllabusProgress failed: ${error.message}`);
  const rows = asRows<SyllabusProgressRow>(data ?? []);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  for (const r of items) assertOwned(r, userId);
  const nextCursor = hasMore && items.length > 0
    ? encodeProgressCursor(items[items.length - 1]?.updated_at)
    : null;
  return { items, nextCursor };
}

function encodeProgressCursor(updatedAt: string | undefined): string | null {
  if (!updatedAt) return null;
  return Buffer.from(JSON.stringify({ after: updatedAt }), 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeProgressCursor(cursor: string): string | null {
  try {
    const pad = cursor.length % 4 === 0 ? '' : '='.repeat(4 - (cursor.length % 4));
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const raw = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.after === 'string' ? obj.after : null;
  } catch {
    return null;
  }
}

export interface UpsertProgressInput {
  scope: 'subject' | 'topic' | 'sub_topic' | 'global';
  scope_id?: string | null;
  coverage_state?: CoverageState;
  last_activity_at?: string | null;
}

export async function upsertSyllabusProgress(
  client: SupabaseClient,
  userId: string,
  input: UpsertProgressInput,
): Promise<SyllabusProgressRow> {
  // RLS is on user_id; we always scope the upsert to the caller.
  // The (user_id, scope, scope_id) tuple is unique in the schema.
  const { data, error } = await client
    .from('syllabus_progress')
    .upsert(
      {
        user_id: userId,
        scope: input.scope,
        scope_id: input.scope_id ?? null,
        ...(input.coverage_state ? { coverage_state: input.coverage_state } : {}),
        ...(input.last_activity_at ? { last_activity_at: input.last_activity_at } : {}),
      },
      { onConflict: 'user_id,scope,scope_id' },
    )
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`upsertSyllabusProgress failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<SyllabusProgressRow>(data);
}
