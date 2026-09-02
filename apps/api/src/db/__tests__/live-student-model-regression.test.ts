/**
 * LIVE DATABASE tests — Phase 5 Student Model (PHASE5_PLAN §8).
 *
 * Per PHASE5_PLAN §8, the live-DB tests for Phase 5 must
 * prove that the SECURITY DEFINER SQL function
 * `recompute_student_model(p_user_id, p_features jsonb,
 * p_window_days int, p_until timestamptz)`:
 *
 *   1. Replaces the prior snapshot+feature rows for the user
 *      with the supplied features JSONB and returns the count
 *      of feature rows written (= 7 in the happy path).
 *   2. Persists the top-level confidence as the minimum across
 *      the seven per-feature confidences (limited=0.0,
 *      moderate=0.5, strong=1.0).
 *   3. Persists the per-feature envelope verbatim, with
 *      `evidence_count` matching the per-feature `sampleSize`.
 *   4. Is idempotent — re-running with the same payload yields
 *      the same row count and the same values.
 *   5. Does NOT touch other users' snapshot/feature rows
 *      (cross-tenant isolation).
 *   6. Defensively no-ops when `p_features` is null or a
 *      non-object (returns 0 without touching the tables).
 *
 * These tests shell out to psql exactly like the
 * `live-analytics-rollup-remediation.test.ts` because the API
 * has no `pg` dep. The migration-13 RPC is the only writer of
 * `student_model_snapshots` / `student_model_features` from
 * the application path, so testing the SQL function is the
 * authoritative contract.
 *
 * Gate: LIVE_DB=1. The fixture database is a locally-running
 * standalone PostgreSQL (NOT the Supabase stack). To run
 * locally: ensure the local krodex_test cluster is up (port
 * 5433) and the migrations in supabase/migrations/ are applied.
 *
 *   LIVE_DB=1 npm --workspace @krodex/api test -- live-student-model-regression
 */

import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const liveDb = process.env.LIVE_DB === '1';
const liveOrSkip = liveDb ? describe : describe.skip;

const DB_URL =
  process.env.KRODEX_TEST_DB_URL ??
  'postgresql://postgres@127.0.0.1:5433/krodex_test';

const PSQL_BIN =
  process.env.PSQL_BIN ?? 'C:/Program Files/PostgreSQL/16/bin/psql.exe';

interface QueryResult {
  rows: Record<string, string | number | null>[];
}

function psql(sql: string): QueryResult {
  const out = execFileSync(
    PSQL_BIN,
    ['-d', DB_URL, '--csv', '-X', '-q', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const text = out.replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
  if (!text) return { rows: [] };
  const lines = text.split(/\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return { rows: [] };
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
}

let userA: SeededUser;
let userB: SeededUser;

/** A representative 7-feature payload (one entry per documented feature key). */
function sevenFeaturePayload(overrides?: {
  confidenceOverride?: Partial<Record<string, string>>;
}): string {
  // The structure mirrors StudentModelSnapshotPayload.features —
  // see apps/api/src/student-model/computeFeatures.ts and
  // packages/shared/src/db/types.ts for the canonical shape.
  const features = {
    consistency_score: {
      featureKey: 'consistency_score',
      score: 0.85,
      direction: 'stable',
      confidence: 'strong',
      sampleSize: 28,
      evidenceWindowDays: 28,
    },
    procrastination_score: {
      featureKey: 'procrastination_score',
      score: 0.15,
      direction: 'improving',
      confidence: 'strong',
      sampleSize: 24,
      evidenceWindowDays: 28,
    },
    recovery_score: {
      featureKey: 'recovery_score',
      score: 0.92,
      direction: 'stable',
      confidence: 'moderate',
      sampleSize: 12,
      evidenceWindowDays: 28,
    },
    error_recurrence_score: {
      featureKey: 'error_recurrence_score',
      score: 0.30,
      direction: 'declining',
      confidence: 'strong',
      sampleSize: 30,
      evidenceWindowDays: 28,
    },
    review_compliance_score: {
      featureKey: 'review_compliance_score',
      score: 0.78,
      direction: 'improving',
      confidence: 'moderate',
      sampleSize: 18,
      evidenceWindowDays: 28,
    },
    workload_pressure_score: {
      featureKey: 'workload_pressure_score',
      score: 0.55,
      direction: 'stable',
      confidence: 'moderate',
      sampleSize: 15,
      evidenceWindowDays: 28,
    },
    learning_trajectory: {
      featureKey: 'learning_trajectory',
      score: 0.75,
      direction: 'improving',
      confidence: 'moderate',
      sampleSize: 28,
      evidenceWindowDays: 28,
    },
    ...overrides?.confidenceOverride,
  };
  return JSON.stringify(features).replace(/'/g, "''");
}

beforeAll(async () => {
  if (!liveDb) return;
  const seedUsers = `
    insert into public.users (auth_user_id, email, display_name) values
      ('00000000-0000-0000-0000-0000000a5a05', 'a-sm5@test.local', 'User A Student Model'),
      ('00000000-0000-0000-0000-0000000b5b05', 'b-sm5@test.local', 'User B Student Model')
    on conflict (auth_user_id) do update set email = excluded.email
    returning id, auth_user_id;
  `;
  const result = psql(seedUsers);
  const a = result.rows.find(
    (r) => r.auth_user_id === '00000000-0000-0000-0000-0000000a5a05',
  );
  const b = result.rows.find(
    (r) => r.auth_user_id === '00000000-0000-0000-0000-0000000b5b05',
  );
  if (!a || !b) throw new Error('failed to seed users for student model live test');
  userA = { id: String(a.id) };
  userB = { id: String(b.id) };

  // Purge any prior snapshot/feature rows for these users.
  psqlExec(
    `delete from public.student_model_features where user_id in ('${userA.id}','${userB.id}');`,
  );
  psqlExec(
    `delete from public.student_model_snapshots where user_id in ('${userA.id}','${userB.id}');`,
  );
});

afterAll(() => {
  if (!liveDb) return;
  psqlExec(
    `delete from public.student_model_features where user_id in ('${userA.id}','${userB.id}');`,
  );
  psqlExec(
    `delete from public.student_model_snapshots where user_id in ('${userA.id}','${userB.id}');`,
  );
});

liveOrSkip('LIVE DB — recompute_student_model happy path', () => {
  it('returns 7 and writes one snapshot + 7 feature rows', () => {
    const until = '2026-09-02T12:00:00.000Z';
    const features = sevenFeaturePayload();
    const r = psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         '${features}'::jsonb,
         28,
         '${until}'::timestamptz
       ) as n;`,
    );
    expect(Number(r.rows[0]!.n)).toBe(7);

    const snap = psql(
      `select user_id::text, confidence::text, computed_at::text
       from public.student_model_snapshots where user_id = '${userA.id}'::uuid;`,
    );
    expect(snap.rows).toHaveLength(1);
    // Confidence: min of {strong, strong, moderate, strong, moderate, moderate, moderate}
    //   = moderate → 0.5
    expect(Number(snap.rows[0]!.confidence)).toBeCloseTo(0.5, 6);

    const feats = psql(
      `select feature_key, evidence_count::text
       from public.student_model_features
       where user_id = '${userA.id}'::uuid
       order by feature_key;`,
    );
    const expectedKeys = [
      'consistency_score',
      'error_recurrence_score',
      'learning_trajectory',
      'procrastination_score',
      'recovery_score',
      'review_compliance_score',
      'workload_pressure_score',
    ];
    expect(feats.rows.map((r) => r.feature_key).sort()).toEqual(
      expectedKeys.slice().sort(),
    );
  });

  it('persists per-feature evidence_count matching sampleSize', () => {
    const until = '2026-09-02T12:00:00.000Z';
    const features = sevenFeaturePayload();
    psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         '${features}'::jsonb,
         28,
         '${until}'::timestamptz
       );`,
    );
    const rows = psql(
      `select feature_key, evidence_count::text as n
       from public.student_model_features
       where user_id = '${userA.id}'::uuid
       order by feature_key;`,
    );
    const map = new Map(rows.rows.map((r) => [String(r.feature_key), Number(r.n)]));
    expect(map.get('consistency_score')).toBe(28);
    expect(map.get('procrastination_score')).toBe(24);
    expect(map.get('recovery_score')).toBe(12);
    expect(map.get('error_recurrence_score')).toBe(30);
    expect(map.get('review_compliance_score')).toBe(18);
    expect(map.get('workload_pressure_score')).toBe(15);
    expect(map.get('learning_trajectory')).toBe(28);
  });

  it('persists the per-feature envelope verbatim (score + direction + window)', () => {
    const until = '2026-09-02T12:00:00.000Z';
    const features = sevenFeaturePayload();
    psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         '${features}'::jsonb,
         28,
         '${until}'::timestamptz
       );`,
    );
    // Read each scalar field via ::text — that gives a clean string
    // through the CSV pipeline (no double-quote JSON escaping). The
    // envelope shape is covered by the per-feature evidence_count
    // test above; here we verify the per-feature scalar fields are
    // pulled back verbatim. PostgreSQL lowercases unquoted aliases
    // in CSV output, so the column names here are lowercase.
    const r = psql(
      `select (feature_value->>'featureKey')::text as "featureKey",
              (feature_value->>'score')::text as "score",
              (feature_value->>'direction')::text as "direction",
              (feature_value->>'confidence')::text as "confidence",
              (feature_value->>'sampleSize')::text as "sampleSize",
              (feature_value->>'evidenceWindowDays')::text as "evidenceWindowDays"
       from public.student_model_features
       where user_id = '${userA.id}'::uuid
         and feature_key = 'consistency_score';`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!['featureKey']).toBe('consistency_score');
    expect(Number(r.rows[0]!['score'])).toBeCloseTo(0.85, 6);
    expect(r.rows[0]!['direction']).toBe('stable');
    expect(r.rows[0]!['confidence']).toBe('strong');
    expect(Number(r.rows[0]!['sampleSize'])).toBe(28);
    expect(Number(r.rows[0]!['evidenceWindowDays'])).toBe(28);
  });
});

liveOrSkip('LIVE DB — recompute_student_model idempotency', () => {
  it('a second call with the same payload keeps row counts the same and replaces values', () => {
    const until1 = '2026-09-02T12:00:00.000Z';
    const features1 = sevenFeaturePayload();
    const first = psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         '${features1}'::jsonb,
         28,
         '${until1}'::timestamptz
       ) as n;`,
    );
    expect(Number(first.rows[0]!.n)).toBe(7);

    // Run again with a slightly different payload but same
    // keys; the new payload should overwrite, NOT add a
    // second snapshot row.
    const features2 = sevenFeaturePayload({
      confidenceOverride: { consistency_score: { ...JSON.parse(sevenFeaturePayload()).consistency_score, score: 0.42 } },
    });
    const until2 = '2026-09-02T12:30:00.000Z';
    const second = psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         '${features2}'::jsonb,
         28,
         '${until2}'::timestamptz
       ) as n;`,
    );
    expect(Number(second.rows[0]!.n)).toBe(7);

    const snap = psql(
      `select count(*)::text as c
       from public.student_model_snapshots where user_id = '${userA.id}'::uuid;`,
    );
    expect(Number(snap.rows[0]!.c)).toBe(1);

    const feats = psql(
      `select count(*)::text as c
       from public.student_model_features where user_id = '${userA.id}'::uuid;`,
    );
    expect(Number(feats.rows[0]!.c)).toBe(7);

    // The consistency_score should now reflect the new score.
    const r = psql(
      `select (feature_value->>'score')::text as s
       from public.student_model_features
       where user_id = '${userA.id}'::uuid and feature_key = 'consistency_score';`,
    );
    expect(Number(r.rows[0]!.s)).toBeCloseTo(0.42, 6);
  });
});

liveOrSkip('LIVE DB — recompute_student_model cross-tenant isolation', () => {
  it("a recompute for user A does not write or touch user B's rows", () => {
    // Seed user B with a row.
    const until = '2026-09-02T12:00:00.000Z';
    const features = sevenFeaturePayload();
    psql(
      `select public.recompute_student_model(
         '${userB.id}'::uuid,
         '${features}'::jsonb,
         28,
         '${until}'::timestamptz
       );`,
    );
    const before = psql(
      `select feature_key from public.student_model_features
       where user_id = '${userB.id}'::uuid order by feature_key;`,
    );
    expect(before.rows).toHaveLength(7);

    // Now recompute for user A only.
    psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         '${features}'::jsonb,
         28,
         '${until}'::timestamptz
       );`,
    );

    // user B's rows are untouched.
    const after = psql(
      `select count(*)::text as c
       from public.student_model_features where user_id = '${userB.id}'::uuid;`,
    );
    expect(Number(after.rows[0]!.c)).toBe(7);

    // user A has 7 rows.
    const a = psql(
      `select count(*)::text as c
       from public.student_model_features where user_id = '${userA.id}'::uuid;`,
    );
    expect(Number(a.rows[0]!.c)).toBe(7);
  });
});

liveOrSkip('LIVE DB — recompute_student_model defensive no-op', () => {
  it('returns 0 and does not delete existing rows when p_features is null', () => {
    const until = '2026-09-02T12:00:00.000Z';
    const before = psql(
      `select count(*)::text as c
       from public.student_model_features where user_id = '${userA.id}'::uuid;`,
    );
    const expectedBefore = Number(before.rows[0]!.c);
    const r = psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         null,
         28,
         '${until}'::timestamptz
       ) as n;`,
    );
    expect(Number(r.rows[0]!.n)).toBe(0);
    const after = psql(
      `select count(*)::text as c
       from public.student_model_features where user_id = '${userA.id}'::uuid;`,
    );
    expect(Number(after.rows[0]!.c)).toBe(expectedBefore);
  });

  it('returns 0 when p_features is a non-object (array)', () => {
    const until = '2026-09-02T12:00:00.000Z';
    const r = psql(
      `select public.recompute_student_model(
         '${userA.id}'::uuid,
         '[1,2,3]'::jsonb,
         28,
         '${until}'::timestamptz
       ) as n;`,
    );
    expect(Number(r.rows[0]!.n)).toBe(0);
  });
});
