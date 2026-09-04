/**
 * KRODEX web — Phase 16 M7 smoke: local stack availability probe.
 *
 * Per `docs/PHASE16_PLAN.md` §4.3 sub-gate (b): if no deployed
 * environment is available at sign-off, the smoke run is performed
 * against the local integrated stack AND a `PARTIAL` verdict is
 * recorded in `docs/PHASE16_VERIFICATION.md`. This spec is the
 * "did the local stack come up?" probe: it reads the
 * `.stack-state.json` marker written by `global-setup.mjs` and
 * either runs (LOCAL_STACK_AVAILABLE) or skips (SKIP_NO_LOCAL_STACK)
 * accordingly.
 *
 * Every other spec in the smoke suite mirrors this gating via
 * `test.skip` on the same marker. The marker is the single source
 * of truth for the run mode.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = join(__dirname, '.stack-state.json');

interface StackState {
  timestamp: string;
  supabase_cli: boolean;
  api_reachable: boolean;
  verdict: 'LOCAL_STACK_AVAILABLE' | 'SKIP_NO_LOCAL_STACK';
}

function readMarker(): StackState | null {
  try {
    const raw = readFileSync(MARKER, 'utf-8');
    return JSON.parse(raw) as StackState;
  } catch {
    return null;
  }
}

test.describe('M7 smoke — local integrated stack probe', () => {
  test('local Supabase + real API are reachable, or skip', () => {
    const state = readMarker();
    if (!state || state.verdict !== 'LOCAL_STACK_AVAILABLE') {
      test.skip(
        true,
        `SKIP_NO_LOCAL_STACK: marker=${state?.verdict ?? 'missing'}; ` +
          `supabase_cli=${state?.supabase_cli}, api_reachable=${state?.api_reachable}. ` +
          'M7 is documentation-only; PARTIAL verdict per §4.3 sub-gate (b).',
      );
      return;
    }
    expect(state.verdict).toBe('LOCAL_STACK_AVAILABLE');
  });
});
