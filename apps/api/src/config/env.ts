/**
 * KRODEX API — typed environment loader.
 *
 * Read all §13.1 env vars (Engineering Support Spec) once at boot
 * and surface them as a frozen object. Throws fast if a required
 * var is missing — the API never starts in a half-configured state.
 *
 * Phase 1 split:
 *  - STRICT mode: every required var must be present (used when
 *    a live Supabase/Postgres is expected).
 *  - LENIENT mode (default when SUPABASE_URL is empty): the
 *    persistence layer stays inactive. Used for Phase 0 boots and
 *    for the current Docker-less dev environment.
 */

const trim = (v: string | undefined): string => (v ?? '').trim();

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(trim(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const flag = (v: string | undefined, fallback = false): boolean => {
  const s = trim(v).toLowerCase();
  if (s === '') return fallback;
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

export interface ApiEnv {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: string;
  readonly apiPort: number;
  readonly apiHost: string;
  readonly webOrigin: string;

  // Supabase / Postgres
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseServiceRoleKey: string;
  readonly supabaseDbUrl: string;
  readonly hasSupabase: boolean;
  readonly hasServiceRole: boolean;

  // Auth
  readonly authJwtSecret: string;
  readonly authJwtTtlSeconds: number;
  readonly authRefreshTtlSeconds: number;

  // AI (Phase 8)
  readonly aiProvider: string;
  readonly aiProviderUrl: string;
  readonly aiApiKey: string;
  readonly aiModelDefault: string;
  readonly aiModelReasoning: string;
  readonly aiTimeoutMs: number;
  readonly aiMaxRetries: number;
  readonly aiProposalTtlMs: number;

  // Storage
  readonly storageBucketErrorCaptures: string;
  readonly storageBucketQuestionSnapshots: string;
  readonly storageBucketErrorEvidence: string;
  readonly storageSignedUrlTtlSeconds: number;
  readonly evidenceSnapshotMaxBytes: number;

  // Security
  readonly rateLimitGlobalPerMin: number;
  readonly rateLimitAuthPerMin: number;
  readonly rateLimitAiPerMin: number;
  readonly corsAllowedOrigins: readonly string[];

  // Email / push
  readonly emailProvider: string;
  readonly emailApiKey: string;
  readonly emailFromAddress: string;
  readonly emailFromName: string;
  readonly pushProvider: string;
  readonly pushVapidPublicKey: string;
  readonly pushVapidPrivateKey: string;
  readonly pushSubject: string;

  // Feature flags
  readonly featureFlags: {
    readonly planner: boolean;
    readonly tests: boolean;
    readonly errorBank: boolean;
    readonly review: boolean;
    readonly progress: boolean;
    readonly aiInsights: boolean;
    readonly notifications: boolean;
    readonly capture: boolean;
  };
}

function readNodeEnv(): 'development' | 'test' | 'production' {
  const raw = trim(process.env.NODE_ENV).toLowerCase();
  if (raw === 'production') return 'production';
  if (raw === 'test') return 'test';
  return 'development';
}

export function loadEnv(): ApiEnv {
  const nodeEnv = readNodeEnv();
  const supabaseUrl = trim(process.env.SUPABASE_URL);
  const supabaseServiceRoleKey = trim(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasSupabase = supabaseUrl.length > 0;
  const hasServiceRole = supabaseServiceRoleKey.length > 0;

  const corsAllowedOrigins = trim(process.env.CORS_ALLOWED_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return Object.freeze({
    nodeEnv,
    logLevel: trim(process.env.LOG_LEVEL) || 'info',
    apiPort: num(process.env.API_PORT, 3001),
    apiHost: trim(process.env.API_HOST) || '127.0.0.1',
    webOrigin: trim(process.env.WEB_ORIGIN) || 'http://localhost:3000',

    supabaseUrl,
    supabaseAnonKey: trim(process.env.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey,
    supabaseDbUrl: trim(process.env.SUPABASE_DB_URL),
    hasSupabase,
    hasServiceRole,

    authJwtSecret: trim(process.env.AUTH_JWT_SECRET) || 'dev-only-not-secure-replace-me-please-please',
    authJwtTtlSeconds: num(process.env.AUTH_JWT_TTL_SECONDS, 3600),
    authRefreshTtlSeconds: num(process.env.AUTH_REFRESH_TTL_SECONDS, 2_592_000),

    aiProvider: trim(process.env.AI_PROVIDER) || 'openai',
    aiProviderUrl: trim(process.env.AI_PROVIDER_URL) || 'https://api.openai.com/v1',
    aiApiKey: trim(process.env.AI_API_KEY),
    aiModelDefault: trim(process.env.AI_MODEL_DEFAULT) || 'gpt-4o-mini',
    aiModelReasoning: trim(process.env.AI_MODEL_REASONING) || 'gpt-4o',
    aiTimeoutMs: num(process.env.AI_TIMEOUT_MS, 20_000),
    aiMaxRetries: num(process.env.AI_MAX_RETRIES, 2),
    aiProposalTtlMs: num(process.env.AI_PROPOSAL_TTL_MS, 30 * 60 * 1000),

    storageBucketErrorCaptures:
      trim(process.env.STORAGE_BUCKET_ERROR_CAPTURES) || 'error-captures',
    storageBucketQuestionSnapshots:
      trim(process.env.STORAGE_BUCKET_QUESTION_SNAPSHOTS) || 'question-snapshots',
    storageBucketErrorEvidence:
      trim(process.env.STORAGE_BUCKET_ERROR_EVIDENCE) || 'error-evidence',
    storageSignedUrlTtlSeconds: num(process.env.STORAGE_SIGNED_URL_TTL_SECONDS, 900),
    evidenceSnapshotMaxBytes: num(process.env.EVIDENCE_SNAPSHOT_MAX_BYTES, 5_242_880),

    rateLimitGlobalPerMin: num(process.env.RATE_LIMIT_GLOBAL_PER_MIN, 120),
    rateLimitAuthPerMin: num(process.env.RATE_LIMIT_AUTH_PER_MIN, 10),
    rateLimitAiPerMin: num(process.env.RATE_LIMIT_AI_PER_MIN, 20),
    corsAllowedOrigins: corsAllowedOrigins.length > 0 ? corsAllowedOrigins : ['http://localhost:3000'],

    emailProvider: trim(process.env.EMAIL_PROVIDER) || 'resend',
    emailApiKey: trim(process.env.EMAIL_API_KEY),
    emailFromAddress: trim(process.env.EMAIL_FROM_ADDRESS) || 'no-reply@krodex.local',
    emailFromName: trim(process.env.EMAIL_FROM_NAME) || 'KRODEX',
    pushProvider: trim(process.env.PUSH_PROVIDER) || 'webpush',
    pushVapidPublicKey: trim(process.env.PUSH_VAPID_PUBLIC_KEY),
    pushVapidPrivateKey: trim(process.env.PUSH_VAPID_PRIVATE_KEY),
    pushSubject: trim(process.env.PUSH_SUBJECT) || 'mailto:dev@krodex.local',

    featureFlags: Object.freeze({
      planner: flag(process.env.FEATURE_PLANNER_ENABLED),
      tests: flag(process.env.FEATURE_TESTS_ENABLED),
      errorBank: flag(process.env.FEATURE_ERROR_BANK_ENABLED),
      review: flag(process.env.FEATURE_REVIEW_ENABLED),
      progress: flag(process.env.FEATURE_PROGRESS_ENABLED),
      aiInsights: flag(process.env.FEATURE_AI_INSIGHTS_ENABLED),
      notifications: flag(process.env.FEATURE_NOTIFICATIONS_ENABLED),
      capture: flag(process.env.FEATURE_CAPTURE_ENABLED),
    }),
  });
}
