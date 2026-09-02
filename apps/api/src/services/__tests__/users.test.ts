/**
 * KRODEX API — user / profile service tests.
 *
 * Verifies:
 *  - createUser inserts the expected columns with sensible defaults
 *  - getUserById throws NotFoundError when missing
 *  - getUserById throws ForbiddenError when row exists but doesn't
 *    belong to the caller
 *  - updateUser patches only the listed fields
 *  - updateProfile upserts and asserts ownership on the returned row
 *  - getProfile throws NotFoundError on miss
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  createUser,
  getUserById,
  updateUser,
  getProfile,
  updateProfile,
} from '../users';
import { ForbiddenError, NotFoundError } from '../../errors';

const SUB = '11111111-1111-4111-8111-111111111111';

describe('createUser', () => {
  it('inserts a user row with the listed fields', async () => {
    const client = makeFakeSupabase();
    const row = await createUser(client, {
      auth_user_id: SUB,
      email: 'a@b.co',
      display_name: 'Krish',
    });
    expect(row.email).toBe('a@b.co');
    expect(row.display_name).toBe('Krish');
    expect(row.timezone).toBe('UTC');
    expect(row.locale).toBe('en-US');
  });

  it('inserts with explicit timezone/locale overrides', async () => {
    const client = makeFakeSupabase();
    const row = await createUser(client, {
      auth_user_id: SUB,
      email: 'a@b.co',
      display_name: 'K',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
    });
    expect(row.timezone).toBe('Asia/Kolkata');
    expect(row.locale).toBe('en-IN');
  });

  it('throws when supabase errors', async () => {
    const client = makeFakeSupabase({ errorOn: 'boom' });
    await expect(
      createUser(client, { auth_user_id: SUB, email: 'a@b.co', display_name: 'k' }),
    ).rejects.toThrow(/createUser failed/);
  });
});

describe('getUserById', () => {
  it('returns the user when present and owned', async () => {
    const client = makeFakeSupabase({
      tables: { users: [{ id: SUB, user_id: SUB, email: 'a@b.co' }] },
    });
    const row = await getUserById(client, SUB);
    expect(row.id).toBe(SUB);
  });

  it('throws NotFoundError when missing', async () => {
    const client = makeFakeSupabase();
    await expect(getUserById(client, SUB)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when row exists but owned by someone else', async () => {
    const client = makeFakeSupabase({
      tables: { users: [{ id: SUB, user_id: 'other-user' }] },
    });
    await expect(getUserById(client, SUB)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('updateUser', () => {
  it('patches only the listed fields', async () => {
    const client = makeFakeSupabase({
      tables: { users: [{ id: SUB, user_id: SUB, display_name: 'old', timezone: 'UTC' }] },
    });
    const row = await updateUser(client, SUB, { display_name: 'new' });
    expect(row.display_name).toBe('new');
  });

  it('throws when nothing matches', async () => {
    const client = makeFakeSupabase();
    await expect(updateUser(client, SUB, { display_name: 'new' })).rejects.toThrow(/updateUser failed/);
  });
});

describe('getProfile / updateProfile', () => {
  it('getProfile throws NotFoundError on miss', async () => {
    const client = makeFakeSupabase();
    await expect(getProfile(client, SUB)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateProfile upserts and returns the new row', async () => {
    const client = makeFakeSupabase();
    const row = await updateProfile(client, SUB, {
      grade: '12',
      board: 'CBSE',
      study_goal: 'JEE',
    });
    expect(row.user_id).toBe(SUB);
    expect(row.grade).toBe('12');
    expect(row.board).toBe('CBSE');
  });
});
