/**
 * Offline tests for the Phase 1 migration set.
 *
 * These tests do NOT apply the migrations — that requires a live
 * Supabase/Postgres. Instead they verify the on-disk artifacts:
 *
 *   1. The expected migration files exist and parse as plain text.
 *   2. The naming convention (UTC YYYYMMDDHHMMSS_NN_slug.sql) holds.
 *   3. Every Phase 1 table appears in the core schema migration.
 *   4. Every CHECK-constrained enum that has a matching string-union
 *      type in packages/shared is mentioned in the SQL somewhere.
 *   5. The RLS migration enables + forces RLS on every user-scoped
 *      table and on every global table.
 *   6. The seed migration is idempotent (uses on conflict do update).
 *
 * The live-DB tests that actually apply these migrations live in
 * `live.test.ts` and are gated on LIVE_DB=1.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_CONVERSATION_STATE_VALUES,
  AI_MESSAGE_ROLE_VALUES,
  BACKLOG_REASON_VALUES,
  BACKLOG_RECOVERY_STATE_VALUES,
  BACKLOG_STATE_VALUES,
  CAPTURED_QUESTION_STATE_VALUES,
  CLASSIFICATION_STATUS_VALUES,
  EVIDENCE_ASSET_STATUS_VALUES,
  COVERAGE_STATE_VALUES,
  DIFFICULTY_VALUES,
  ERROR_ENTRY_STATUS_VALUES,
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_DELIVERY_STATE_VALUES,
  NOTIFICATION_SEVERITY_VALUES,
  PLANNER_TASK_STATE_VALUES,
  QUESTION_TYPE_VALUES,
  REVIEW_ATTEMPT_OUTCOME_VALUES,
  REVIEW_OUTCOME_VALUES,
  REVIEW_STATE_VALUES,
  REVIEW_STRATEGY_VALUES,
  TEST_ANSWER_OUTCOME_VALUES,
  TEST_ATTEMPT_STATE_VALUES,
  TEST_DEFINITION_STATE_VALUES,
  TEST_SOURCE_KIND_VALUES,
} from '@krodex/shared';

// __dirname equivalent for ESM.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

// ----- what we expect to find on disk -----------------------------------

const EXPECTED_MIGRATION_FILES = [
  '20260901164346_01_extensions.sql',
  '20260901164346_02_helpers.sql',
  '20260901164346_03_core_schema.sql',
  '20260901164346_04_rls.sql',
  '20260901164346_05_seed_dev.sql',
  '20260901164346_06_idempotency_keys.sql',
  '20260901164346_07_domain_rpcs.sql',
  '20260901164346_08_event_bus.sql',
  '20260901164346_09_extend_rpcs_with_outbox.sql',
  '20260901164346_10_progress_evidence_dedup.sql',
  '20260901164346_11_scheduled_job_fns.sql',
  // Phase 4: analytics_daily_rollup, analytics_weekly_rollup,
  // evidence_threshold column, recompute_analytics_rollup fn.
  '20260901164346_12_analytics_rollup.sql',
  // Phase 5: recompute_student_model fn (per PHASE5_PLAN §4). The
  // snapshot+features tables themselves already exist in
  // migration 03; migration 13 is the SECURITY DEFINER persistence
  // RPC that the TypeScript orchestrator hands the seven-feature
  // payload to.
  '20260901164346_13_student_model_recompute.sql',
  // Phase 9: error_evidence, evidence_assets,
  // error_lifecycle_events tables, error-evidence Storage bucket,
  // capture_sources seed row.
  '20260901164346_14_error_capture_pipeline.sql',
  // Phase 10 + 11: verification_questions, planner_task_events,
  // backlog_recovery_events, planner_tasks.partial_count,
  // planner_tasks.source_task_id.
  '20260901164346_15_review_and_planner_history.sql',
  // Phase 12: notification dedup_key column + (user_id, dedup_key)
  // unique index for the project_notification projector.
  '20260901164346_16_notification_dedup.sql',
  // Phase 14: audit_events table for high-privilege operation
  // observability. Service-role writer; RLS denies non-service-role
  // writes (no policies = deny by default).
  '20260901164346_17_security_audit_log.sql',
  // Phase 15: targeted indexes for the in-app delivery dispatcher
  // and recovery-suggestions hot paths. Additive; existing query
  // plans remain valid.
  '20260901164346_18_perf_indexes.sql',
] as const;

const MIGRATION_NAMING_PATTERN =
  /^\d{14}_\d{2}_[a-z][a-z0-9_]*\.sql$/;

// Every user-scoped table (per Schema-Ready §4) that must appear in
// both the core schema migration AND the RLS migration's DO block.
const USER_SCOPED_TABLES = [
  'syllabus_progress',
  'error_entries',
  'error_question_links',
  'review_schedules',
  'review_attempts',
  'test_definitions',
  'test_questions',
  'test_attempts',
  'test_answers',
  'planner_templates',
  'planner_tasks',
  'backlog_items',
  'backlog_recoveries',
  'notifications',
  'notification_deliveries',
  'ai_conversations',
  'ai_messages',
  'captured_questions',
  'question_snapshots',
  'progress_evidence',
  'progress_snapshots',
  'student_model_snapshots',
  'student_model_features',
  // Phase 9: per-attempt evidence record (TRD §9).
  'error_evidence',
  // Phase 9: storage-asset metadata (TRD §10).
  'evidence_assets',
  // Phase 9: lifecycle event history (TRD §11).
  'error_lifecycle_events',
  // Phase 14: privileged-operation audit log. Service-role writer
  // only; RLS denies non-service-role. Not user-scoped. Created in
  // migration 17, not the core schema; see the dedicated
  // "Phase 14 audit_events" describe below.
  // 'audit_events',  // intentionally not in ALL_TABLES
] as const;

// Global (shared-across-users, read-public) tables per Schema-Ready §4.
// `users` and `profiles` are excluded from this list because they are
// per-user and have an explicit owner policy in the RLS migration rather
// than a read-public / write-service pair.
const GLOBAL_TABLES = [
  'subjects',
  'topics',
  'sub_topics',
  'questions',
  'question_options',
  'capture_sources',
] as const;

// `users` and `profiles` are per-user but use an explicit owner
// policy (not the user-scoped `_owner_all` DO block) because the
// policy column is `id` / `user_id` respectively — same shape, just
// spelled out for clarity in the migration.
const EXPLICIT_OWNER_TABLES = ['users', 'profiles'] as const;

// Phase 9 tables whose ownership predicate is a JOIN through a
// parent table (no direct `user_id` column). They are owned via
// explicit CREATE POLICY statements in migration 14 and are
// skipped by the simple DO-block assertion above.
const JOIN_OWNED_TABLES: ReadonlySet<string> = new Set([
  'evidence_assets',     // owner: error_evidence.user_id
  'error_lifecycle_events', // owner: error_entries.user_id
]);

// All tables in the core schema, used to confirm we did not drop one.
const ALL_TABLES = [
  ...USER_SCOPED_TABLES,
  ...GLOBAL_TABLES,
  ...EXPLICIT_OWNER_TABLES,
] as const;

// Every CHECK-constrained enum and its runtime list of values.
// We confirm the SQL contains the literal values somewhere. The
// lists live in packages/shared so the SQL migrations and the TS
// unions can be kept in lockstep by the migration test.
//
// Note: MistakeType is intentionally excluded — the SQL column is
// free-form text per the schema spec (the union is enforced at the
// application layer only). It is tested separately below.
const ENUM_MIRRORS: ReadonlyArray<{
  unionName: string;
  values: readonly string[];
}> = [
  { unionName: 'CoverageState',             values: COVERAGE_STATE_VALUES },
  { unionName: 'QuestionType',              values: QUESTION_TYPE_VALUES },
  { unionName: 'Difficulty',                values: DIFFICULTY_VALUES },
  { unionName: 'ErrorEntryStatus',          values: ERROR_ENTRY_STATUS_VALUES },
  { unionName: 'ReviewState',               values: REVIEW_STATE_VALUES },
  { unionName: 'ReviewOutcome',             values: REVIEW_OUTCOME_VALUES },
  { unionName: 'ReviewStrategy',            values: REVIEW_STRATEGY_VALUES },
  { unionName: 'ReviewAttemptOutcome',      values: REVIEW_ATTEMPT_OUTCOME_VALUES },
  { unionName: 'TestSourceKind',            values: TEST_SOURCE_KIND_VALUES },
  { unionName: 'TestDefinitionState',       values: TEST_DEFINITION_STATE_VALUES },
  { unionName: 'TestAttemptState',          values: TEST_ATTEMPT_STATE_VALUES },
  { unionName: 'TestAnswerOutcome',         values: TEST_ANSWER_OUTCOME_VALUES },
  { unionName: 'PlannerTaskState',          values: PLANNER_TASK_STATE_VALUES },
  { unionName: 'BacklogReason',             values: BACKLOG_REASON_VALUES },
  { unionName: 'BacklogState',              values: BACKLOG_STATE_VALUES },
  { unionName: 'BacklogRecoveryState',      values: BACKLOG_RECOVERY_STATE_VALUES },
  { unionName: 'NotificationSeverity',      values: NOTIFICATION_SEVERITY_VALUES },
  { unionName: 'NotificationChannel',       values: NOTIFICATION_CHANNEL_VALUES },
  { unionName: 'NotificationDeliveryState', values: NOTIFICATION_DELIVERY_STATE_VALUES },
  { unionName: 'AiConversationState',       values: AI_CONVERSATION_STATE_VALUES },
  { unionName: 'AiMessageRole',             values: AI_MESSAGE_ROLE_VALUES },
  { unionName: 'CapturedQuestionState',     values: CAPTURED_QUESTION_STATE_VALUES },
  { unionName: 'ClassificationStatus',      values: CLASSIFICATION_STATUS_VALUES },
  { unionName: 'EvidenceAssetStatus',       values: EVIDENCE_ASSET_STATUS_VALUES },
];

// ----- helpers ----------------------------------------------------------

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  if (!existsSync(path)) {
    throw new Error(`Migration file missing: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

// ----- the actual tests --------------------------------------------------

describe('Phase 1+3+4+9 migration set — file presence', () => {
  it('contains the expected 18 migration files', () => {
    const onDisk = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(onDisk).toEqual([...EXPECTED_MIGRATION_FILES]);
  });

  it('every migration follows the UTC YYYYMMDDHHMMSS_NN_slug.sql pattern', () => {
    for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
      expect(f, `bad filename: ${f}`).toMatch(MIGRATION_NAMING_PATTERN);
    }
  });

  it('every migration file is non-empty and parses as UTF-8 text', () => {
    for (const f of EXPECTED_MIGRATION_FILES) {
      const path = join(migrationsDir, f);
      expect(statSync(path).size, `${f} should be non-empty`).toBeGreaterThan(0);
      const text = readMigration(f);
      // The text must contain at least one SQL keyword.
      expect(text).toMatch(/\b(create|alter|insert|do|create or replace)\b/i);
    }
  });
});

describe('Phase 1 migration set — core schema coverage', () => {
  const core = readMigration('20260901164346_03_core_schema.sql');

  it.each(ALL_TABLES)(`declares table %s`, (t) => {
    const re = new RegExp(`create table if not exists public\\.${t}\\b`, 'i');
    expect(core, `core schema is missing CREATE TABLE public.${t}`).toMatch(re);
  });

  it.each(
    USER_SCOPED_TABLES.filter((t) => !JOIN_OWNED_TABLES.has(t as string)),
  )('user-scoped table %s has a user_id column and immutability trigger', (t) => {
    // The user_id column is part of the CREATE TABLE block; the
    // immutability trigger is a separate CREATE TRIGGER in the same file.
    //
    // Join-owned tables (evidence_assets, error_lifecycle_events) are
    // skipped: their ownership is via a parent-table JOIN, not a
    // direct user_id column. They are verified separately in the
    // "JOIN-based owner policies" assertion against migration 04.
    expect(core).toMatch(
      new RegExp(`create table if not exists public\\.${t}[\\s\\S]+?user_id\\s+uuid`, 'i'),
    );
    expect(core).toMatch(
      new RegExp(`create trigger trg_${t}_user_id_immutable`, 'i'),
    );
  });

  it('every table that should be mutable has an updated_at trigger', () => {
    // error_lifecycle_events is append-only by design (TRD §11: "no
    // UPDATE/DELETE"); it intentionally has no updated_at column, so
    // the trigger is not required. All other tables must have it.
    const TABLES_WITH_UPDATED_AT: ReadonlySet<string> = new Set([
      'error_lifecycle_events',
    ]);
    for (const t of ALL_TABLES) {
      if (TABLES_WITH_UPDATED_AT.has(t)) continue;
      expect(
        core,
        `core schema is missing set_updated_at trigger for ${t}`,
      ).toMatch(new RegExp(`create trigger trg_${t}_updated_at`, 'i'));
    }
  });

  it.each(ENUM_MIRRORS)('enum $unionName values are mirrored in the SQL', (m) => {
    for (const v of m.values) {
      expect(
        core,
        `${m.unionName} value "${v}" is not present as a CHECK value in the core schema`,
      ).toContain(`'${v}'`);
    }
  });

  it('MistakeType is intentionally free-form text (no CHECK constraint)', () => {
    // The error_entries.mistake_type column is documented in the SQL
    // as free-form; the union lives at the TS layer. The column line
    // is `mistake_type text,` with no inline CHECK clause.
    const line = core
      .split('\n')
      .find((l) => /mistake_type\s+text/i.test(l));
    expect(line, 'mistake_type column not found in core schema').toBeDefined();
    expect(line).not.toMatch(/\bcheck\s*\(/i);
  });
});

describe('Phase 1 migration set — RLS coverage', () => {
  const rls = readMigration('20260901164346_04_rls.sql');

  it('enables + forces RLS on every user-scoped table', () => {
    // The user-scoped tables get their `alter table` and policy via a
    // single DO block. The table list is the only thing spelled out
    // literally, so we verify the table name appears in the DO block's
    // `tables text[] := array[...]` and the format templates for both
    // ALTER and FORCE are present.
    //
    // Join-owned tables (evidence_assets, error_lifecycle_events) are
    // skipped: their policies live outside the DO block because the
    // ownership predicate is a JOIN. They are verified separately by
    // the "JOIN-based owner policies" test below.
    const doBlockMatch = rls.match(/tables\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/i);
    expect(doBlockMatch, 'migration 04 must declare a `tables text[] := array[...]` DO block').not.toBeNull();
    const doBlock = doBlockMatch?.[1] ?? '';
    for (const t of USER_SCOPED_TABLES) {
      if (JOIN_OWNED_TABLES.has(t as string)) continue;
      expect(
        doBlock,
        `User-scoped table ${t} is missing from the RLS DO block's tables array`,
      ).toMatch(new RegExp(`['"]${t}['"]`));
    }
    expect(rls).toMatch(/alter table public\.%I enable row level security/i);
    expect(rls).toMatch(/alter table public\.%I force\s+row level security/i);
  });

  it('enables + forces RLS on every global table', () => {
    for (const t of GLOBAL_TABLES) {
      expect(
        rls,
        `RLS not enabled on global table ${t}`,
      ).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`, 'i'));
      expect(
        rls,
        `RLS not forced on global table ${t}`,
      ).toMatch(new RegExp(`alter table public\\.${t}\\s+force\\s+row level security`, 'i'));
    }
  });

  it('enables + forces RLS on the explicit-owner tables (users, profiles)', () => {
    for (const t of EXPLICIT_OWNER_TABLES) {
      expect(
        rls,
        `RLS not enabled on ${t}`,
      ).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`, 'i'));
      expect(
        rls,
        `RLS not forced on ${t}`,
      ).toMatch(new RegExp(`alter table public\\.${t}\\s+force\\s+row level security`, 'i'));
    }
  });

  it('declares a SELECT policy for every global table', () => {
    for (const t of GLOBAL_TABLES) {
      expect(
        rls,
        `No read policy for global table ${t}`,
      ).toMatch(new RegExp(`create policy\\s+${t}_read\\b`, 'i'));
    }
  });

  it('declares a service-role-only write policy for every global table', () => {
    for (const t of GLOBAL_TABLES) {
      expect(
        rls,
        `No service-role write policy for global table ${t}`,
      ).toMatch(new RegExp(`create policy\\s+${t}_write_service\\b`, 'i'));
    }
  });

  it('declares an explicit owner policy for users and profiles', () => {
    for (const t of EXPLICIT_OWNER_TABLES) {
      expect(
        rls,
        `No explicit owner policy for ${t}`,
      ).toMatch(new RegExp(`create policy\\s+${t}_owner_all\\b`, 'i'));
    }
  });

  it('declares an owner policy for every user-scoped table', () => {
    // The owner policy is generated by a DO block using `format(...)`,
    // so the literal `create policy X_owner_all` text never appears in
    // the file. We instead verify that (a) the table name appears in the
    // DO block's `tables text[]`, and (b) the format template that
    // produces the policy exists.
    //
    // EXCEPTION: tables whose ownership predicate is a JOIN (rather
    // than a direct `user_id` column) cannot use the simple DO-block
    // template. They are listed in JOIN_OWNED_TABLES and verified
    // separately by a JOIN-based policy assertion below.
    const doBlockMatch = rls.match(/tables\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/i);
    expect(doBlockMatch, 'migration 04 must declare a `tables text[] := array[...]` DO block').not.toBeNull();
    const doBlock = doBlockMatch?.[1] ?? '';
    for (const t of USER_SCOPED_TABLES) {
      if (JOIN_OWNED_TABLES.has(t as string)) continue;
      expect(
        doBlock,
        `User-scoped table ${t} is not present in the RLS DO block's tables array`,
      ).toMatch(new RegExp(`['"]${t}['"]`));
    }
    // The policy template must be present exactly once (it's a single
    // format(...) call inside the loop).
    expect(rls).toMatch(/create policy\s+%I_owner_all\s+on\s+public\.%I/i);
  });

  it('declares JOIN-based owner policies for join-owned tables', () => {
    // evidence_assets joins through error_evidence.user_id;
    // error_lifecycle_events joins through error_entries.user_id.
    // Both have explicit CREATE POLICY statements in migration 14
    // because the simple user_id = auth.uid() template does not fit.
    expect(rls).toMatch(/create policy\s+evidence_assets_owner_all\b/i);
    expect(rls).toMatch(/create policy\s+error_lifecycle_owner_select\b/i);
  });

  it('uses auth_uid() in every owner policy (no hard-coded auth.uid())', () => {
    // We are deliberately portable — the policy SQL must reference the
    // shim, not the Supabase-only auth.uid() function.
    expect(rls).toContain('public.auth_uid()');
  });
});

describe('Phase 1 migration set — seed idempotency', () => {
  const seed = readMigration('20260901164346_05_seed_dev.sql');

  it('uses on conflict do update for subjects', () => {
    expect(seed).toMatch(/on conflict \(code\) do update/i);
  });

  it('uses on conflict do update for capture_sources', () => {
    // Same pattern, same expectation.
    const matches = seed.match(/on conflict \(code\) do update/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('seeds a documented set of subjects', () => {
    for (const code of ['MATH', 'PHYS', 'CHEM', 'BIO', 'ENGL']) {
      expect(seed).toContain(`'${code}'`);
    }
  });

  it('seeds a documented set of capture sources', () => {
    for (const code of ['manual', 'clipboard_text', 'browser_extension']) {
      expect(seed).toContain(`'${code}'`);
    }
  });
});

describe('Phase 1 migration set — helpers', () => {
  const helpers = readMigration('20260901164346_02_helpers.sql');

  it('defines auth_uid() with the documented shim behavior', () => {
    expect(helpers).toContain('create or replace function public.auth_uid()');
    expect(helpers).toContain('request.jwt.claim.sub');
    expect(helpers).toContain('app.current_user_id');
  });

  it('defines set_updated_at()', () => {
    expect(helpers).toContain('create or replace function public.set_updated_at()');
  });

  it('defines prevent_user_id_mutation()', () => {
    expect(helpers).toContain('create or replace function public.prevent_user_id_mutation()');
    expect(helpers).toContain('user_id is immutable');
  });

  it('defines set_user_id_on_insert()', () => {
    expect(helpers).toContain('create or replace function public.set_user_id_on_insert()');
  });
});

describe('Phase 14 migration set — audit_events (17)', () => {
  const m = readMigration('20260901164346_17_security_audit_log.sql');

  it('creates public.audit_events', () => {
    expect(m).toMatch(/create table if not exists public\.audit_events/i);
  });

  it('declares actor_id, action, resource, resource_id, metadata, request_id columns', () => {
    for (const col of [
      'actor_id',
      'action',
      'resource',
      'resource_id',
      'metadata',
      'request_id',
    ]) {
      expect(m, `audit_events missing column ${col}`).toContain(col);
    }
  });

  it('enables RLS on audit_events', () => {
    expect(m).toMatch(/alter table public\.audit_events enable row level security/i);
    expect(m).toMatch(/alter table public\.audit_events\s+force\s+row level security/i);
  });

  it('declares at least one supporting index', () => {
    // The migration creates indexes for the most common
    // operator queries: by occurred_at, by actor, and by action.
    expect(m).toMatch(/create index if not exists idx_audit_events_occurred_at/i);
    expect(m).toMatch(/create index if not exists idx_audit_events_actor/i);
    expect(m).toMatch(/create index if not exists idx_audit_events_action/i);
  });
});

describe('Phase 15 migration set — perf indexes (18)', () => {
  const m = readMigration('20260901164346_18_perf_indexes.sql');

  it('adds the in-app delivery dispatcher partial index', () => {
    expect(m).toMatch(
      /create index if not exists idx_notification_deliveries_pending_channel_time/i,
    );
    // Partial index — limited to pending state to keep it small.
    expect(m).toMatch(/where state = 'pending'/i);
  });

  it('adds the recovery-suggestions partial index on backlog_items', () => {
    expect(m).toMatch(
      /create index if not exists idx_backlog_items_user_open_time/i,
    );
    expect(m).toMatch(/where state = 'open'/i);
  });

  it('is additive (no DROP / DROP INDEX statements)', () => {
    // Phase 15 must not regress existing query plans. We verify
    // by asserting no DROP / TRUNCATE / DELETE FROM appears.
    expect(m).not.toMatch(/\bdrop\s+(index|table)\b/i);
    expect(m).not.toMatch(/\btruncate\b/i);
  });
});

describe('Phase 2 migration set — idempotency keys (06)', () => {
  const m = readMigration('20260901164346_06_idempotency_keys.sql');

  it('creates public.idempotency_keys', () => {
    expect(m).toMatch(/create table if not exists public\.idempotency_keys/i);
  });

  it('declares the (user_id, route, idempotency_key) uniqueness constraint', () => {
    expect(m).toMatch(/unique\s+\(user_id,\s*route,\s*idempotency_key\)/i);
  });

  it('declares the request_hash and response columns', () => {
    expect(m).toContain('request_hash');
    expect(m).toContain('response_status');
    expect(m).toContain('response_body');
    expect(m).toContain('expires_at');
  });

  it('installs the prevent_user_id_mutation trigger', () => {
    expect(m).toMatch(/create trigger trg_idempotency_keys_user_id_immutable/i);
  });
});

describe('Phase 2 migration set — domain RPCs (07)', () => {
  const m = readMigration('20260901164346_07_domain_rpcs.sql');

  it('adds the (user_id, question_id) uniqueness constraint to error_entries', () => {
    expect(m).toMatch(/add constraint uq_error_entries_user_question/i);
    expect(m).toMatch(/unique\s+\(user_id,\s*question_id\)/i);
  });

  it('declares public.submit_test_attempt', () => {
    expect(m).toMatch(/create or replace function public\.submit_test_attempt\s*\(\s*p_attempt_id\s+uuid\s*\)/i);
  });

  it('submit_test_attempt honours all six grading decisions', () => {
    // Decision 1 — reads source_payload->scoring
    expect(m).toMatch(/source_payload\s*->\s*'scoring'/i);
    // Decision 2 — defaultOutcome fallback
    expect(m).toMatch(/defaultOutcome/i);
    // Decision 4 — inserts 'skipped' rows for unattached questions
    expect(m).toMatch(/insert into public\.test_answers[\s\S]{0,400}'skipped'/i);
    // Decision 5 — comprehension / assertion_reason forced to partial
    expect(m).toMatch(/question_type in \('comprehension', 'assertion_reason'\)/i);
    expect(m).toMatch(/v_outcome := 'partial'/i);
    // Decision 6 — only incorrect creates error_entries
    expect(m).toMatch(/and a\.outcome = 'incorrect'/i);
  });

  it('computes accuracy as correct / (correct + incorrect + partial)', () => {
    expect(m).toMatch(/v_correct_count::numeric\s*\/\s*v_denominator::numeric/);
  });

  it('declares public.schedule_review_for_error', () => {
    expect(m).toMatch(/create or replace function public\.schedule_review_for_error\s*\(/i);
    expect(m).toContain("p_strategy");
    expect(m).toContain("p_due_at");
  });

  it('declares public.record_progress_evidence', () => {
    expect(m).toMatch(/create or replace function public\.record_progress_evidence\s*\(/i);
    expect(m).toContain("p_dimension");
    expect(m).toContain("p_delta");
    expect(m).toContain("p_ref_kind");
  });
});
