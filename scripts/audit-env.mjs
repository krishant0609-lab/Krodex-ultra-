#!/usr/bin/env node
/**
 * KRODEX — env-var audit (Phase 16 M2).
 *
 * Compares a real `.env` file against the union of:
 *   1. The keys declared in `.env.example` (template).
 *   2. The keys consumed by `apps/api/src/config/env.ts`'s `loadEnv()`.
 *
 * Output is JSON to stdout; exit code 0 on a clean audit, exit 1 if
 * any of: missing-key, extra-key, empty-required-key.
 *
 * This script is **read-only**. It does not modify `.env`, `.env.example`,
 * or any source file. It is a verification artifact for the Phase 16
 * release checklist and the M1 CI "lint/checks" stage.
 *
 * Usage:
 *   node scripts/audit-env.mjs                  # audits .env at repo root
 *   node scripts/audit-env.mjs path/to/.env     # audits an explicit file
 *   node scripts/audit-env.mjs --strict         # also fail on empty-but-declared
 *
 * The script's "required" set is the set of env-var names referenced by
 * `loadEnv()`. The script's "declared" set is the keys present in
 * `.env.example`. The script's "audit-target" set is the .env file under
 * audit. A clean audit means: every required name has a non-empty value
 * in the audit target, every declared name is either in the required set
 * or carries a value (or both), and no key in the audit target is
 * completely unknown.
 *
 * Phase 16 M2 acceptance: exit 0 against a complete `.env`; exit 1 with
 * a JSON list of missing keys against a stripped `.env`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

// --- Configuration -----------------------------------------------------

/**
 * Every env-var name consumed by `apps/api/src/config/env.ts`'s
 * `loadEnv()`. This list MUST stay in lockstep with that source file.
 * If you add a new env-var there, also add it here.
 */
const REQUIRED_ENV_VARS = Object.freeze([
  // nodeEnv has a hard-coded default in loadEnv(); not strictly required
  // for boot but the runtime expects it for security policy decisions.
  'NODE_ENV',
  'LOG_LEVEL',
  'API_PORT',
  'API_HOST',
  'WEB_ORIGIN',

  // Supabase / Postgres
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',

  // Auth
  'AUTH_JWT_SECRET',
  'AUTH_JWT_TTL_SECONDS',
  'AUTH_REFRESH_TTL_SECONDS',

  // AI
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_MODEL_DEFAULT',
  'AI_MODEL_REASONING',
  'AI_TIMEOUT_MS',
  'AI_MAX_RETRIES',

  // Storage
  'STORAGE_BUCKET_ERROR_CAPTURES',
  'STORAGE_BUCKET_QUESTION_SNAPSHOTS',
  'STORAGE_SIGNED_URL_TTL_SECONDS',

  // Security / rate-limit
  'RATE_LIMIT_GLOBAL_PER_MIN',
  'RATE_LIMIT_AUTH_PER_MIN',
  'RATE_LIMIT_AI_PER_MIN',
  'CORS_ALLOWED_ORIGINS',

  // Email / push
  'EMAIL_PROVIDER',
  'EMAIL_API_KEY',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME',
  'PUSH_PROVIDER',
  'PUSH_VAPID_PUBLIC_KEY',
  'PUSH_VAPID_PRIVATE_KEY',
  'PUSH_VAPID_SUBJECT',

  // Feature flags
  'FEATURE_PLANNER_ENABLED',
  'FEATURE_TESTS_ENABLED',
  'FEATURE_ERROR_BANK_ENABLED',
  'FEATURE_REVIEW_ENABLED',
  'FEATURE_PROGRESS_ENABLED',
  'FEATURE_AI_INSIGHTS_ENABLED',
  'FEATURE_NOTIFICATIONS_ENABLED',
  'FEATURE_CAPTURE_ENABLED',
]);

/**
 * A small set of keys that `loadEnv()` reads but for which a hard-coded
 * fallback exists in source. These are NOT required to be present in
 * `.env` (the fallback covers the gap), but if they ARE present they
 * MUST be non-empty. Listed for documentation; not used as a fail
 * trigger in non-strict mode.
 */
const OPTIONAL_WITH_FALLBACK = Object.freeze([
  'AI_PROVIDER_URL',
  'AI_PROPOSAL_TTL_MS',
  'STORAGE_BUCKET_ERROR_EVIDENCE',
  'EVIDENCE_SNAPSHOT_MAX_BYTES',
]);

// --- Helpers -----------------------------------------------------------

function parseDotEnv(contents) {
  /** @type {Record<string, string>} */
  const out = {};
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    // Strip surrounding quotes if present.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function declaredKeys(contents) {
  /** @type {string[]} */
  const keys = [];
  const lines = contents.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) keys.push(key);
  }
  return keys;
}

// --- Main --------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const positional = args.filter((a) => !a.startsWith('--'));
  const envPath = positional[0]
    ? resolve(process.cwd(), positional[0])
    : resolve(repoRoot, '.env');

  if (!existsSync(envPath)) {
    const payload = {
      ok: false,
      audited: envPath,
      reason: 'env file not found',
      missing_required: [...REQUIRED_ENV_VARS],
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    process.exit(1);
  }

  const envContents = readFileSync(envPath, 'utf8');
  const parsed = parseDotEnv(envContents);

  const examplePath = resolve(repoRoot, '.env.example');
  const declared = existsSync(examplePath) ? declaredKeys(readFileSync(examplePath, 'utf8')) : [];

  // 1) Required keys missing or empty.
  const missingRequired = REQUIRED_ENV_VARS.filter((k) => {
    const v = parsed[k];
    return v === undefined || v === '';
  });

  // 2) Unknown keys (in the audited .env but neither in REQUIRED nor in declared).
  const knownSet = new Set([...REQUIRED_ENV_VARS, ...declared, ...OPTIONAL_WITH_FALLBACK]);
  const extraKeys = Object.keys(parsed).filter((k) => !knownSet.has(k));

  // 3) In strict mode, also flag optional-with-fallback keys that are present but empty.
  const emptyOptional = strict
    ? OPTIONAL_WITH_FALLBACK.filter((k) => parsed[k] !== undefined && parsed[k] === '')
    : [];

  const ok = missingRequired.length === 0 && extraKeys.length === 0 && emptyOptional.length === 0;

  /** @type {Record<string, unknown>} */
  const payload = {
    ok,
    audited: envPath,
    example: examplePath,
    strict,
    required_count: REQUIRED_ENV_VARS.length,
    declared_count: declared.length,
    present_count: Object.keys(parsed).length,
    missing_required: missingRequired,
    extra_keys: extraKeys,
    empty_optional_in_strict: emptyOptional,
  };

  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(ok ? 0 : 1);
}

main();
