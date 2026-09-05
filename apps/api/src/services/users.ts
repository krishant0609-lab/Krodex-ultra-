/**
 * KRODEX API — user & profile service.
 *
 * Phase 2 ships:
 *  - a self-service POST /users endpoint to create a public.users
 *    row from an authenticated JWT (so the dev token flow can
 *    bootstrap an account),
 *  - a GET /users/me endpoint that returns the current user,
 *  - GET/PATCH /users/me/profile that wraps public.profiles.
 *
 * All reads use the per-request user client so RLS still applies.
 * All writes go through the user client too — there is no need
 * for the service role in the user domain.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProfileRow,
  ProfileUpdate,
  UserRow,
  UserUpdate,
} from '@krodex/shared';
import { NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow } from './_row';

export interface CreateUserInput {
  auth_user_id: string;
  email: string;
  display_name: string;
  timezone?: string;
  locale?: string;
}

export async function createUser(
  client: SupabaseClient,
  input: CreateUserInput,
): Promise<UserRow> {
  const { data, error } = await client
    .from('users')
    .insert({
      auth_user_id: input.auth_user_id,
      email: input.email,
      display_name: input.display_name,
      timezone: input.timezone ?? 'UTC',
      locale: input.locale ?? 'en-US',
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`createUser failed: ${error?.message ?? 'no row returned'}`);
  }
  return asRow<UserRow>(data);
}

export async function getUserById(
  client: SupabaseClient,
  userId: string,
): Promise<UserRow> {
  const { data, error } = await client
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`getUserById failed: ${error.message}`);
  if (!data) throw new NotFoundError('user not found');
  // public.users is the one table where the row's own `id` is the
  // ownership field. Every other user-scoped table has a `user_id`
  // FK that points back here. We check both `id` and `auth_user_id`
  // because the prehandler passes `req.auth.userId = users.id` (the
  // synthetic PK) while a future caller could also pass the auth
  // subject directly.
  assertOwned(data, userId, ['id', 'auth_user_id']);
  return asRow<UserRow>(data);
}

export async function updateUser(
  client: SupabaseClient,
  userId: string,
  patch: UserUpdate,
): Promise<UserRow> {
  const { data, error } = await client
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`updateUser failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId, ['id', 'auth_user_id']);
  return asRow<UserRow>(data);
}

export async function getProfile(
  client: SupabaseClient,
  userId: string,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`getProfile failed: ${error.message}`);
  if (!data) throw new NotFoundError('profile not found');
  assertOwned(data, userId);
  return asRow<ProfileRow>(data);
}

export async function updateProfile(
  client: SupabaseClient,
  userId: string,
  patch: ProfileUpdate,
): Promise<ProfileRow> {
  // Upsert so a brand-new account can save a profile before the
  // first profile row exists. RLS still owns the row.
  const { data, error } = await client
    .from('profiles')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`updateProfile failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<ProfileRow>(data);
}
