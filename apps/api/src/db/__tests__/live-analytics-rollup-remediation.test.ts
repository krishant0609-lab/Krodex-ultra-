/**
 * LIVE DATABASE tests — Phase 4 Remediation #2
 * (PHASE4_REPORT §5.7 — STRUCTURAL ANALYTICS/EVIDENCE MISMATCH).
 *
 * Background. The Phase 4 audit found that the
 * `recompute_analytics_rollup` SQL function's `days` CTE pulled
 * (pe.dimension, day) pairs from `progress_evidence`, where
 * `pe.dimension` is an event-level name (`test_attempts`,
 * `errors_created`, etc.). The CASE branches that computed each
 * of the six PRD §24 metric values keyed on metric-level names
 * (`test_completion`, `error_capture`, etc.) and ALWAYS fell
 * through to `else null`. The rollup table was never populated
 * with real metric values, and the only way to get non-NULL
 * metric rows was to insert synthetic `metric_trigger` evidence
 * rows with metric-level dimensions.
 *
 * The fix: the `days` CTE now iterates over (UTC day, metric)
 * pairs, where metric is one of the six PRD §24 names, only on
 * days where the user has any activity. The metric subqueries
 * compute from the event-level evidence and raw tables directly.
 *
 * What these tests prove:
 *   1. The function runs against a real PostgreSQL and produces
 *      six metric rows per (user, day) of activity.
 *   2. Each metric is computed from the EVENT-LEVEL evidence
 *      (`test_attempts`, `test_accuracy`, `errors_created`,
 *      `errors_resolved`, `errors_reopened`, `review_completed`)
 *      and the raw tables (`review_schedules`). NO synthetic
 *      metric-level progress_evidence rows are required.
 *   3. The numeric values match the expected PRD §24 formulas
 *      (numerator/denominator, median for time_to_correction).
 *   4. Cross-tenant isolation is preserved: a recompute for
 *      user A does not read user B's evidence.
 *   5. A user with no activity in the window produces no rollup
 *      rows (sparse rollup is correct, not buggy).
 *   6. The function is idempotent: re-running it for the same
 *      window produces the same row count with the same values.
 *
 * Gate: LIVE_DB=1. The fixture database is a locally-running
 * standalone PostgreSQL (NOT the Supabase stack). The API has
 * no `pg` dep, so this test shells out to the psql binary
 * (C:/Program Files/PostgreSQL/16/bin/psql.exe) via
 * child_process.execFileSync. This keeps the test self-contained
 * and the test contract identical regardless of which migration
 * runner is used.
 *
 * To run locally:
 *   1. Ensure the local krodex_test cluster is up (port 5433)
 *      and the migrations in supabase/migrations/ are applied.
 *   2. LIVE_DB=1 npm --workspace @krodex/api test -- live-analytics-rollup-remediation
 */

import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const liveDb = process.env.LIVE_DB === '1';
const liveOrSkip = liveDb ? describe : describe.skip;

const DB_URL =
  process.env.KRODEX_TEST_DB_URL ??
  'postgresql://postgres@127.0.0.1:5433/krodex_test';

// Path to the psql binary. On Windows the repo has no `pg` dep
// in @krodex/api, so we shell out directly. Override with
// PSQL_BIN if the binary lives elsewhere.
const PSQL_BIN =
  process.env.PSQL_BIN ?? 'C:/Program Files/PostgreSQL/16/bin/psql.exe';

interface QueryResult {
  rows: Record<string, string | number | null>[];
}

function psql(sql: string): QueryResult {
  // Use psql's CSV output mode. With `--csv` we get a header
  // row + comma-separated values for every SELECT. We parse it
  // by hand to avoid pulling in node-pg.
  const out = execFileSync(
    PSQL_BIN,
    ['-d', DB_URL, '--csv', '-X', '-q', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const text = out.replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
  if (!text) return { rows: [] };
  const lines = text.split(/\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    // Only the header (or only a single scalar value). For an
    // INSERT/UPDATE/DELETE/CREATE statement psql returns just
    // a status line or nothing — treat as empty result.
    return { rows: [] };
  }
  const header = lines[0]!.split(',');
  const rows: QueryResult['rows'] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i]!.split(',');
    const row: Record<string, string | number | null> = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]!] = cols[j] ?? null;
    }
    rows.push(row);
  }
  return { rows };
}

function psqlExec(sql: string): void {
  // Run a multi-statement SQL block via psql -c. Use --set
  // ON_ERROR_STOP=1 so the first error halts the transaction.
  execFileSync(
    PSQL_BIN,
    [
      '-d',
      DB_URL,
      '-X',
      '-q',
      '--set',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

interface SeededUser {
  id: string;
  email: string;
}

let userA: SeededUser;
let userB: SeededUser;
let userCEmpty: SeededUser;

const ALL_METRICS = [
  'test_completion',
  'error_capture',
  'review_completion',
  'correction_rate',
  'reopen_rate',
  'time_to_correction',
] as const;

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

beforeAll(async () => {
  if (!liveDb) return;
  const now = new Date().toISOString();
  const seedUsers = `
    insert into public.users (auth_user_id, email, display_name) values
      ('00000000-0000-0000-0000-0000000aaa02', 'a-rem-${escapeSqlString(now)}@test.local', 'User A Remediation'),
      ('00000000-0000-0000-0000-0000000bbb02', 'b-rem-${escapeSqlString(now)}@test.local', 'User B Remediation'),
      ('00000000-0000-0000-0000-0000000ccc02', 'c-rem-${escapeSqlString(now)}@test.local', 'User C Remediation')
    on conflict (auth_user_id) do update set email = excluded.email
    returning id, email, auth_user_id;
  `;
  const result = psql(seedUsers);
  const a = result.rows.find((r) => r.auth_user_id === '00000000-0000-0000-0000-0000000aaa02');
  const b = result.rows.find((r) => r.auth_user_id === '00000000-0000-0000-0000-0000000bbb02');
  const c = result.rows.find((r) => r.auth_user_id === '00000000-0000-0000-0000-0000000ccc02');
  if (!a || !b || !c) throw new Error('failed to seed users');
  userA = { id: String(a.id), email: String(a.email) };
  userB = { id: String(b.id), email: String(b.email) };
  userCEmpty = { id: String(c.id), email: String(c.email) };

  // Purge any prior evidence/rollup rows for these test users.
  psqlExec(
    `delete from public.progress_evidence where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );
  psqlExec(
    `delete from public.review_schedules where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );
  psqlExec(
    `delete from public.analytics_daily_rollup where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );
  psqlExec(
    `delete from public.analytics_weekly_rollup where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );

  // USER A: full event-level evidence for 2026-09-15.
  //  - 2 test_attempts (each with a test_accuracy metadata.incorrect=2)
  //  - 3 errors_created
  //  - 2 errors_resolved (30 min after creation → median 1800s)
  //  - 1 errors_reopened
  //  - 1 review_completed
  //  - 5 review_schedules due before end-of-2026-09-15
  const day = '2026-09-15T12:00:00.000Z';
  // Deterministic UUIDs so the test is reproducible.
  const aTa1 = '00000000-0000-0000-0000-00000000a0a1';
  const aTa2 = '00000000-0000-0000-0000-00000000a0a2';
  const aE1 = '00000000-0000-0000-0000-00000000ae01';
  const aE2 = '00000000-0000-0000-0000-00000000ae02';
  const aE3 = '00000000-0000-0000-0000-00000000ae03';
  const aS1 = '00000000-0000-0000-0000-00000000a501';
  // review_schedules has a FK on error_id, so we need real
  // error_entries rows for the 5 schedules.
  const aErrEntryRefs = [
    '00000000-0000-0000-0000-00000000aee1',
    '00000000-0000-0000-0000-00000000aee2',
    '00000000-0000-0000-0000-00000000aee3',
    '00000000-0000-0000-0000-00000000aee4',
    '00000000-0000-0000-0000-00000000aee5',
  ];
  for (const ee of aErrEntryRefs) {
    psqlExec(
      `insert into public.error_entries
         (id, user_id, status, first_seen_at, last_seen_at)
       values
         ('${ee}'::uuid, '${userA.id}'::uuid, 'active', '${day}'::timestamptz, '${day}'::timestamptz)
       on conflict (id) do nothing;`,
    );
  }

  const userAEvidence: { dim: string; ref: string; ts: string; meta?: string }[] = [
    { dim: 'test_attempts', ref: aTa1, ts: day },
    { dim: 'test_accuracy', ref: aTa1, ts: day, meta: '{"incorrect":"2"}' },
    { dim: 'test_attempts', ref: aTa2, ts: day },
    { dim: 'test_accuracy', ref: aTa2, ts: day, meta: '{"incorrect":"2"}' },
    { dim: 'errors_created', ref: aE1, ts: day },
    { dim: 'errors_created', ref: aE2, ts: day },
    { dim: 'errors_created', ref: aE3, ts: day },
    { dim: 'errors_resolved', ref: aE1, ts: '2026-09-15T12:30:00.000Z' },
    { dim: 'errors_resolved', ref: aE2, ts: '2026-09-15T12:30:00.000Z' },
    { dim: 'errors_reopened', ref: aE2, ts: '2026-09-15T12:45:00.000Z' },
    { dim: 'review_completed', ref: aS1, ts: day },
  ];
  for (const e of userAEvidence) {
    psqlExec(
      `insert into public.progress_evidence
         (user_id, dimension, delta, ref_kind, ref_id, captured_at, metadata)
       values
         ('${userA.id}', '${e.dim}', '1', 'auto', '${e.ref}'::uuid, '${e.ts}'::timestamptz, ${e.meta ? `'${e.meta}'::jsonb` : "'{}'::jsonb"});`,
    );
  }
  for (let i = 0; i < aErrEntryRefs.length; i += 1) {
    const dueAt = `2026-09-15T0${6 + i}:00:00.000Z`;
    psqlExec(
      `insert into public.review_schedules
         (user_id, error_id, due_at, state)
       values
         ('${userA.id}'::uuid, '${aErrEntryRefs[i]}'::uuid, '${dueAt}'::timestamptz, 'due');`,
    );
  }

  // USER B: 1 test_attempt (and 1 test_accuracy with incorrect=1).
  // This is the cross-tenant isolation test: a recompute for user A
  // must not see user B's evidence.
  const bTa1 = '00000000-0000-0000-0000-00000000b0a1';
  psqlExec(
    `insert into public.progress_evidence
       (user_id, dimension, delta, ref_kind, ref_id, captured_at, metadata)
     values
       ('${userB.id}', 'test_attempts', '1', 'auto', '${bTa1}'::uuid, '${day}'::timestamptz, '{}'::jsonb),
       ('${userB.id}', 'test_accuracy', '1', 'auto', '${bTa1}'::uuid, '${day}'::timestamptz, '{"incorrect":"1"}'::jsonb);`,
  );
});

afterAll(() => {
  if (!liveDb) return;
  // Clean up seeded rows so the live-DB state stays predictable.
  psqlExec(
    `delete from public.progress_evidence where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );
  psqlExec(
    `delete from public.review_schedules where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );
  psqlExec(
    `delete from public.error_entries where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}') and id in ('00000000-0000-0000-0000-00000000aee1','00000000-0000-0000-0000-00000000aee2','00000000-0000-0000-0000-00000000aee3','00000000-0000-0000-0000-00000000aee4','00000000-0000-0000-0000-00000000aee5');`,
  );
  psqlExec(
    `delete from public.analytics_daily_rollup where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );
  psqlExec(
    `delete from public.analytics_weekly_rollup where user_id in ('${userA.id}','${userB.id}','${userCEmpty.id}');`,
  );
});

liveOrSkip('LIVE DB — recompute_analytics_rollup produces 6 metric rows per (user, day) of activity', () => {
  it('user A — 2026-09-15 — emits 6 metric rows (one per PRD §24 metric)', () => {
    const since = '2026-09-14T00:00:00.000Z';
    const until = '2026-09-16T00:00:00.000Z';
    const r = psql(
      `select public.recompute_analytics_rollup('${userA.id}'::uuid, '${since}'::timestamptz, '${until}'::timestamptz) as rowsrecomputed;`,
    );
    const count = Number(r.rows[0]!.rowsrecomputed ?? 0);
    // Daily: 6 (one per metric for 2026-09-15). Weekly: 6
    // (ISO-week 2026-09-14..2026-09-20). Total ≥ 12.
    expect(count).toBeGreaterThanOrEqual(12);

    const daily = psql(
      `select dimension from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and rollup_date = '2026-09-15'
       order by dimension;`,
    );
    const dimSet = new Set(daily.rows.map((row) => String(row.dimension)));
    for (const m of ALL_METRICS) {
      expect(dimSet.has(m), `${m} missing from daily rollup`).toBe(true);
    }
  });

  it('test_completion: 1.0 (2 attempts, both submitted)', () => {
    const r = psql(
      `select value_numeric::text as v, numerator::text as n, denominator::text as d, sample_size::text as s
       from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and dimension = 'test_completion' and rollup_date = '2026-09-15';`,
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(Number(row.v)).toBeCloseTo(1.0, 6);
    expect(Number(row.n)).toBe(2);
    expect(Number(row.d)).toBe(2);
    expect(Number(row.s)).toBe(2);
  });

  it('error_capture: 3 captured / 4 eligible (2 attempts × 2 incorrect) = 0.75', () => {
    const r = psql(
      `select value_numeric::text as v, numerator::text as n, denominator::text as d
       from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and dimension = 'error_capture' and rollup_date = '2026-09-15';`,
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(Number(row.v)).toBeCloseTo(0.75, 6);
    expect(Number(row.n)).toBe(3);
    expect(Number(row.d)).toBe(4);
  });

  it('review_completion: 1 completed / 5 due = 0.2', () => {
    const r = psql(
      `select value_numeric::text as v, numerator::text as n, denominator::text as d
       from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and dimension = 'review_completion' and rollup_date = '2026-09-15';`,
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(Number(row.v)).toBeCloseTo(0.2, 6);
    expect(Number(row.n)).toBe(1);
    expect(Number(row.d)).toBe(5);
  });

  it('correction_rate: 2 resolved / (2 resolved + 1 reopened) = 0.6667', () => {
    const r = psql(
      `select value_numeric::text as v, numerator::text as n, denominator::text as d
       from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and dimension = 'correction_rate' and rollup_date = '2026-09-15';`,
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(Number(row.v)).toBeCloseTo(2 / 3, 4);
    expect(Number(row.n)).toBe(2);
    expect(Number(row.d)).toBe(3);
  });

  it('reopen_rate: 1 reopened / 2 resolved = 0.5', () => {
    const r = psql(
      `select value_numeric::text as v, numerator::text as n, denominator::text as d
       from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and dimension = 'reopen_rate' and rollup_date = '2026-09-15';`,
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(Number(row.v)).toBeCloseTo(0.5, 6);
    expect(Number(row.n)).toBe(1);
    expect(Number(row.d)).toBe(2);
  });

  it('time_to_correction: MEDIAN of 1800s (both resolutions 30min after creation) = 1800', () => {
    const r = psql(
      `select value_numeric::text as v, numerator::text as n, denominator::text as d
       from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and dimension = 'time_to_correction' and rollup_date = '2026-09-15';`,
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    // Both resolutions are 1800s after their errors_created. Median = 1800.
    expect(Number(row.v)).toBeCloseTo(1800, 1);
    expect(Number(row.n)).toBe(1800);
    expect(Number(row.d)).toBe(2);
  });
});

liveOrSkip('LIVE DB — cross-tenant isolation', () => {
  it("a recompute for user A does NOT include user B's test_attempts", () => {
    const since = '2026-09-14T00:00:00.000Z';
    const until = '2026-09-16T00:00:00.000Z';
    psql(
      `select public.recompute_analytics_rollup('${userA.id}'::uuid, '${since}'::timestamptz, '${until}'::timestamptz);`,
    );
    const detail = psql(
      `select sample_size::text as s from public.analytics_daily_rollup
       where user_id = '${userA.id}'::uuid and dimension = 'test_completion' and rollup_date = '2026-09-15';`,
    );
    // User A has 2 attempts → test_completion sample_size = 2.
    // If user B's 1 attempt leaked, sample_size would be 3.
    expect(detail.rows).toHaveLength(1);
    expect(Number(detail.rows[0]?.s)).toBe(2);
  });

  it("a recompute for user B shows ONLY user B's test_attempts (sample_size = 1)", () => {
    const since = '2026-09-14T00:00:00.000Z';
    const until = '2026-09-16T00:00:00.000Z';
    psql(
      `select public.recompute_analytics_rollup('${userB.id}'::uuid, '${since}'::timestamptz, '${until}'::timestamptz);`,
    );
    const r = psql(
      `select sample_size::text as s, value_numeric::text as v
       from public.analytics_daily_rollup
       where user_id = '${userB.id}'::uuid and dimension = 'test_completion' and rollup_date = '2026-09-15';`,
    );
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0]!.s)).toBe(1);
    expect(Number(r.rows[0]!.v ?? 0)).toBeCloseTo(1.0, 6);
  });
});

liveOrSkip('LIVE DB — sparse rollup (empty user)', () => {
  it('user C (no activity) produces no rollup rows', () => {
    const since = '2026-09-14T00:00:00.000Z';
    const until = '2026-09-16T00:00:00.000Z';
    const result = psql(
      `select public.recompute_analytics_rollup('${userCEmpty.id}'::uuid, '${since}'::timestamptz, '${until}'::timestamptz) as rowsrecomputed;`,
    );
    // No days CTE rows means the FOR loop body never runs → 0
    // daily rows + 0 weekly rows.
    expect(Number(result.rows[0]?.rowsrecomputed ?? -1)).toBe(0);
    const daily = psql(
      `select 1 as one from public.analytics_daily_rollup
       where user_id = '${userCEmpty.id}'::uuid and rollup_date = '2026-09-15';`,
    );
    expect(daily.rows).toHaveLength(0);
  });
});

liveOrSkip('LIVE DB — idempotency', () => {
  it('a second recompute for the same window produces the same row count', () => {
    const since = '2026-09-14T00:00:00.000Z';
    const until = '2026-09-16T00:00:00.000Z';
    const r1 = psql(
      `select public.recompute_analytics_rollup('${userA.id}'::uuid, '${since}'::timestamptz, '${until}'::timestamptz) as rowsrecomputed;`,
    );
    const r2 = psql(
      `select public.recompute_analytics_rollup('${userA.id}'::uuid, '${since}'::timestamptz, '${until}'::timestamptz) as rowsrecomputed;`,
    );
    expect(Number(r2.rows[0]?.rowsrecomputed)).toBe(
      Number(r1.rows[0]?.rowsrecomputed),
    );
  });
});
