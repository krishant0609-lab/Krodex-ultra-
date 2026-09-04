/**
 * KRODEX web — Phase 16 M7 smoke: global setup.
 *
 * The smoke run is gated on the local Supabase + real API being
 * available. Before the suite starts, this script:
 *   1. Probes `supabase --version` on PATH.
 *   2. Probes the real API's /health (port 4200 by default).
 *   3. Writes a JSON marker to `tests/e2e/smoke/.stack-state.json`
 *      that the specs read to decide whether to skip.
 *
 * The marker is the **single source of truth** for the local
 * stack availability. The smoke config does not put `supabase
 * start` in its webServer block (which would crash the run on
 * hosts without the CLI); the suite simply skips when the
 * marker is `unavailable`.
 *
 * Per `docs/PHASE16_PLAN.md` §4.3 sub-gate (b), the skip +
 * marker is the documented PARTIAL-verdict path. The actual
 * verdict is recorded in `docs/PHASE16_VERIFICATION.md`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4200';
const MARKER = resolve(dirname(fileURLToPath(import.meta.url)), '.stack-state.json');

async function probeApi() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${API_URL}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function probeSupabaseCli() {
  try {
    execSync('supabase --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const supabaseAvailable = probeSupabaseCli();
const apiAvailable = await probeApi();
const state = {
  timestamp: new Date().toISOString(),
  supabase_cli: supabaseAvailable,
  api_reachable: apiAvailable,
  verdict: supabaseAvailable && apiAvailable ? 'LOCAL_STACK_AVAILABLE' : 'SKIP_NO_LOCAL_STACK',
};

mkdirSync(dirname(MARKER), { recursive: true });
writeFileSync(MARKER, JSON.stringify(state, null, 2), 'utf-8');

if (state.verdict === 'SKIP_NO_LOCAL_STACK') {
  console.log(`[M7 smoke] ${state.verdict} — supabase_cli=${supabaseAvailable} api_reachable=${apiAvailable}`);
  console.log('[M7 smoke] M7 is documentation-only; PARTIAL verdict per PHASE16_PLAN §4.3 sub-gate (b)');
} else {
  console.log('[M7 smoke] LOCAL_STACK_AVAILABLE — running real-API smoke');
}

export default async function globalSetup() {
  // The probe-and-write is performed at module load above. Playwright
  // requires a default-exported function; the side effect is the work.
  // The marker is the single source of truth for the suite's run mode.
  return state;
}
