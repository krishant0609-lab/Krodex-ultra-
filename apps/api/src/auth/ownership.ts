/**
 * KRODEX API — ownership helpers.
 *
 * The RLS policies on user-scoped tables already prevent
 * cross-tenant reads. These helpers are the API-side defence: the
 * service layer must verify that a row fetched via the user
 * client actually belongs to the requester before returning it.
 *
 * The convention is `assertOwned(row, userId, fields?)` — it
 * throws ForbiddenError if any listed field mismatches the
 * requester. Pass no `fields` to fall back to `user_id`.
 */

import { ForbiddenError } from '../errors';

type OwnershipCarrier = Readonly<Record<string, unknown>>;
// Some service-layer callers hold strongly-typed row interfaces
// (e.g. SyllabusProgressRow) that don't expose a string index
// signature. Accepting `unknown` and narrowing at the call sites
// keeps the helper usable from both places.
type OwnershipRow = OwnershipCarrier | object;

/** Returns true if the row's user_id (default field) matches. */
export function isOwnedBy(
  row: OwnershipRow | null | undefined,
  userId: string,
  field: string = 'user_id',
): boolean {
  if (!row) return false;
  const carrier = row as OwnershipCarrier;
  const v = carrier[field];
  return typeof v === 'string' && v === userId;
}

/**
 * Assert a row is owned by `userId` or throw ForbiddenError.
 * Pass `fields` to check multiple possible ownership columns
 * (e.g. for join rows that hold both error_id and question_id).
 */
export function assertOwned(
  row: OwnershipRow | null | undefined,
  userId: string,
  fields: readonly string[] = ['user_id'],
): void {
  if (!row) {
    throw new ForbiddenError('row not found');
  }
  for (const f of fields) {
    if (isOwnedBy(row, userId, f)) return;
  }
  throw new ForbiddenError('row not owned by caller', {
    context: { checkedFields: fields },
  });
}
