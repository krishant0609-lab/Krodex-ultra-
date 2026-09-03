/**
 * KRODEX API — Phase 8 proposal store tests.
 *
 * The store is the only place that holds a pending mutation the
 * AI suggested. These tests pin the three contracts:
 *
 *   1. `storeProposal` + `lookupProposal` returns the same
 *      proposal the orchestrator stored.
 *   2. `lookupProposal` returns `null` for an entry older than
 *      the 30-minute TTL — the route then returns 404 and no
 *      mutation is performed.
 *   3. `deleteProposal` removes an entry so a subsequent
 *      `lookupProposal` returns `null` (this is the reject
 *      path).
 *
 * The store is per-process; each test starts with a clean
 * bucket via `_resetProposalStoreForTests`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetProposalStoreForTests,
  deleteProposal,
  lookupProposal,
  PROPOSAL_TTL,
  storeProposal,
} from '../proposer';
import type { AssistantProposalT } from '../schemas';

const USER = 'user-A';
const OTHER = 'user-B';

function makeProposal(overrides: Partial<AssistantProposalT> = {}): AssistantProposalT {
  return {
    id: 'prop-1',
    kind: 'create_task',
    description: 'Practice arithmetic.',
    affectedRecords: ['err-1'],
    payload: { title: 'Practice arithmetic' },
    createdAt: 1715000000000,
    ...overrides,
  };
}

afterEach(() => {
  _resetProposalStoreForTests();
});

describe('storeProposal + lookupProposal', () => {
  it('returns the stored proposal for the same user', () => {
    const now = new Date('2025-05-01T12:00:00.000Z');
    const proposal = makeProposal();
    storeProposal(USER, proposal, () => now);
    const got = lookupProposal(USER, 'prop-1', () => now);
    expect(got).toEqual(proposal);
  });

  it('isolates proposals by user id (user-B cannot see user-A proposals)', () => {
    const now = new Date('2025-05-01T12:00:00.000Z');
    storeProposal(USER, makeProposal(), () => now);
    const got = lookupProposal(OTHER, 'prop-1', () => now);
    expect(got).toBeNull();
  });

  it('returns null for a proposal id that was never stored', () => {
    const got = lookupProposal(USER, 'missing', () => new Date());
    expect(got).toBeNull();
  });
});

describe('TTL expiry', () => {
  it('returns null for a proposal older than the 30-minute TTL', () => {
    const storedAt = new Date('2025-05-01T12:00:00.000Z');
    storeProposal(USER, makeProposal(), () => storedAt);
    const after = new Date(storedAt.getTime() + PROPOSAL_TTL + 1);
    const got = lookupProposal(USER, 'prop-1', () => after);
    expect(got).toBeNull();
  });

  it('still returns a proposal exactly at the TTL boundary (inclusive)', () => {
    const storedAt = new Date('2025-05-01T12:00:00.000Z');
    storeProposal(USER, makeProposal(), () => storedAt);
    const atBoundary = new Date(storedAt.getTime() + PROPOSAL_TTL);
    const got = lookupProposal(USER, 'prop-1', () => atBoundary);
    expect(got).not.toBeNull();
  });

  it('removes the entry from the store after the TTL elapses', () => {
    const storedAt = new Date('2025-05-01T12:00:00.000Z');
    storeProposal(USER, makeProposal(), () => storedAt);
    const after = new Date(storedAt.getTime() + PROPOSAL_TTL + 1);
    // First lookup expires and purges.
    expect(lookupProposal(USER, 'prop-1', () => after)).toBeNull();
    // Second lookup must also return null (entry is gone).
    expect(lookupProposal(USER, 'prop-1', () => after)).toBeNull();
  });
});

describe('deleteProposal', () => {
  it('removes a stored proposal so a subsequent lookup returns null', () => {
    const now = new Date('2025-05-01T12:00:00.000Z');
    storeProposal(USER, makeProposal(), () => now);
    deleteProposal(USER, 'prop-1');
    expect(lookupProposal(USER, 'prop-1', () => now)).toBeNull();
  });

  it('is a no-op when the user has no entries', () => {
    expect(() => deleteProposal(USER, 'never-stored')).not.toThrow();
  });
});
