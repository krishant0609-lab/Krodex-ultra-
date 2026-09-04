/**
 * KRODEX API — Phase 8 assistant orchestrator.
 *
 * The single seam between the HTTP layer and the AI pipelines.
 * Every Phase 8 endpoint (classification-suggest, /assistant/queries,
 * proposal confirm) goes through one of the methods on this
 * service so the auth, evidence assembly, and error-translation
 * logic lives in exactly one place.
 *
 * Per Implementation Plan §334–342, Phase 8 Plan §5, and PRD §33:
 *
 *   - Auth: ownership is enforced *before* the AI sees anything.
 *     `buildClassificationEvidence` and the assistant bundle both
 *     run under the per-request user client, so the RLS scope is
 *     the authenticated student.
 *   - Evidence: the model only ever sees the minimal payload
 *     described in `ai/evidence.ts`. No raw rows, no other
 *     students' data.
 *   - Failure: the AI never blocks the user. If the provider is
 *     unavailable or returns invalid output, this service throws
 *     a `DependencyUnavailableError` and the route renders the
 *     deterministic fallback surface (manual classification form,
 *     "AI unavailable" message on /assistant).
 *
 * The full assistant Q&A flow (`/assistant/queries`) and the
 * proposal-confirm flow (`/assistant/proposals/:id/confirm`) land
 * in Steps 4 + 5 + 6. This file ships Step 3's classify path
 * only, plus the singleton factory the routes import.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AiMessage,
  AiProvider,
  AiRequest,
} from '../ai/provider';
import {
  AiOutputInvalidError,
  DependencyUnavailableError,
  NotFoundError,
  isAppError,
} from '../errors';
import {
  buildAssistantEvidence,
  buildClassificationEvidence,
  type AssistantEvidenceBundle,
  type ClassificationEvidence,
} from '../ai/evidence';
import {
  normalizeClassifierError,
  suggestClassification,
} from '../ai/classifier';
import {
  answerAssistantQuery,
  normalizeAssistantError,
} from '../ai/assistant';
import { classifyIntent } from '../ai/intent';
import type {
  AssistantProposalT,
  AssistantResponseT,
  ClassificationSuggestionResponseT,
  ClassificationSuggestionT,
} from '../ai/schemas';
import type { ApiEnv } from '../config/env';

export interface AssistantServiceDeps {
  /** The configured provider (already wrapped in `RetryingProvider`). */
  readonly provider: AiProvider;
  /** Frozen env from the boot loader. */
  readonly env: ApiEnv;
  /** Model id used for simple JSON outputs (classification, short answers). */
  readonly modelDefault: string;
  /** Model id used for longer, multi-step reasoning (the assistant Q&A path). */
  readonly modelReasoning: string;
  /** Clock seam for deterministic tests. */
  readonly now?: () => Date;
}

/**
 * Build the assistant service from a frozen env. The provider
 * is created via `createProvider` and wrapped in the retrying
 * singleton so callers (routes, tests) never construct the
 * provider themselves.
 */
export function createAssistantService(env: ApiEnv, provider: AiProvider): AssistantService {
  return new AssistantService({
    provider,
    env,
    modelDefault: env.aiModelDefault,
    modelReasoning: env.aiModelReasoning,
    now: () => new Date(),
  });
}

export interface ClassifyErrorResult extends ClassificationSuggestionResponseT {}

/**
 * The orchestrator. Holds the provider + env references and
 * exposes one method per Phase 8 endpoint.
 *
 * The methods are deliberately tiny — they wire evidence +
 * classifier + error normalization, and they do NOT touch the
 * database. Mutations always go through the existing domain
 * services in the route handler after the student confirms a
 * proposal (Steps 5 + 6).
 */
export class AssistantService {
  private readonly provider: AiProvider;
  private readonly env: ApiEnv;
  private readonly modelDefault: string;
  private readonly modelReasoning: string;
  private readonly now: () => Date;

  /**
   * Read-only access to the configured provider. Phase 9's
   * capture pipeline uses the same provider for background
   * classification as the foreground assistant service, so it
   * needs a way to reach the singleton. Read-only — callers
   * must not reconfigure the provider.
   */
  get configuredProvider(): AiProvider {
    return this.provider;
  }

  constructor(deps: AssistantServiceDeps) {
    this.provider = deps.provider;
    this.env = deps.env;
    this.modelDefault = deps.modelDefault;
    this.modelReasoning = deps.modelReasoning;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Non-authoritative classification suggestion for one error.
   *
   * The returned object is the same shape the route hands the
   * client. The student is expected to either accept it
   * (which writes `mistake_type` via `PATCH /errors/:id` —
   * the existing domain surface) or override it manually.
   *
   * @param client  The per-request Supabase client (RLS-scoped).
   * @param userId  The authenticated student.
   * @param errorId The error to suggest a classification for.
   */
  async classifyError(
    client: SupabaseClient,
    userId: string,
    errorId: string,
  ): Promise<ClassifyErrorResult> {
    // 1) Auth + evidence. Ownership is enforced by
    //    `assertOwned` inside `buildClassificationEvidence`.
    const evidence = await buildClassificationEvidence(client, userId, errorId, this.now);

    // 2) If the caller has no AI key configured, surface the same
    //    "AI unavailable" envelope the rest of Phase 8 uses.
    if (!this.env.aiApiKey) {
      throw new DependencyUnavailableError('AI provider not configured', {
        context: { provider: this.env.aiProvider, hasApiKey: false },
      });
    }

    // 3) The model call. We pick `modelDefault` for classification:
    //    it's a short, single-shot JSON call; reasoning-grade
    //    models are reserved for the /assistant Q&A path.
    let suggestion: ClassificationSuggestionT;
    try {
      suggestion = await suggestClassification(this.provider, this.modelDefault, evidence);
    } catch (err) {
      normalizeClassifierError(err);
    }
    // The `normalizeClassifierError` helper re-throws on failure,
    // so the line below is unreachable in the failure path. The
    // non-null assertion is for the type-checker only.
    suggestion = suggestion!;

    return {
      suggestion,
      // The evidence ids the model was allowed to cite. The UI
      // shows this so the student can verify each claim maps to
      // a real record.
      candidateSourceIds: collectCandidateSourceIds(evidence),
    };
  }

  /**
   * Non-authoritative Q&A against the student's own records.
   *
   * Flow:
   *   1. Classify the question's intent (rule-based, see
   *      `ai/intent.ts`).
   *   2. Pull a server-side, RLS-scoped evidence bundle (capped
   *      at 10 errors / 10 reviews / 10 topics).
   *   3. Call the model. The model's response is Zod-validated
   *      and the citation-ownership guard rejects any id outside
   *      the bundle.
   *   4. If the response includes a `proposal` (only allowed
   *      when the intent is `recommendation`), attach a
   *      server-generated id, a server-generated `createdAt`,
   *      and store it in the in-process TTL map so the student
   *      can confirm it on the next call.
   *
   * The route handler returns the `AssistantResponse` to the
   * client. The proposal (if any) lives only in the in-process
   * map — never in the database — until the student confirms.
   *
   * The AI never mutates state. Even when a `create_task` or
   * `schedule_review` proposal is returned, the only side effect
   * here is putting an entry in the TTL map. The actual write
   * happens in `confirmProposal`, after explicit student
   * confirmation, via the existing domain services.
   *
   * @param client    The per-request Supabase client (RLS-scoped).
   * @param userId    The authenticated student.
   * @param input     The student's question + optional context.
   */
  async answerQuery(
    client: SupabaseClient,
    userId: string,
    input: AnswerQueryInput,
  ): Promise<AnswerQueryResult> {
    if (!this.env.aiApiKey) {
      throw new DependencyUnavailableError('AI provider not configured', {
        context: { provider: this.env.aiProvider, hasApiKey: false },
      });
    }

    const intent = classifyIntent(input.question);

    const bundle = await buildAssistantEvidence(
      client,
      userId,
      { errorLimit: 10, reviewLimit: 10, topicLimit: 10 },
      this.now,
    );

    let response: AssistantResponseT;
    try {
      response = await answerAssistantQuery(
        this.provider,
        this.modelReasoning,
        input.question,
        intent,
        bundle,
      );
    } catch (err) {
      normalizeAssistantError(err);
    }
    response = response!;

    // The model may include a proposal (only on `recommendation`).
    // We overwrite the model-supplied id and createdAt with
    // server-generated values and store the proposal in the
    // in-process TTL map. The route returns the *new* id back to
    // the client so the confirm endpoint can find it.
    if (response.proposal) {
      const serverProposal: AssistantProposalT = {
        ...response.proposal,
        id: makeProposalId(),
        createdAt: this.now().getTime(),
      };
      // Lazy import to avoid a hard dependency between the
      // service and the proposer module — the route never reads
      // the import side-effects.
      const { storeProposal } = await import('../ai/proposer');
      storeProposal(userId, serverProposal, this.now);
      response = { ...response, proposal: serverProposal };
    }

    return {
      response,
      // The full evidence id set, for the UI to verify the model's
      // citations. Same shape as the classification path.
      candidateSourceIds: collectAssistantCandidateSourceIds(bundle),
    };
  }

  /**
   * Confirm or reject a proposal. The student explicitly opts in
   * (or out); the AI is never allowed to execute a mutation
   * without this round-trip.
   *
   * On confirm, the proposal is dispatched to the matching
   * domain service. The domain service enforces its own
   * ownership + validation — this method does not duplicate
   * that.
   *
   * On reject, the proposal is removed from the TTL map and
   * no mutation is performed.
   *
   * On expiry (TTL elapsed) or unknown id, this throws
   * `NotFoundError` so the route returns 404.
   */
  async confirmProposal(
    userId: string,
    input: ConfirmProposalInput,
  ): Promise<ConfirmProposalResult> {
    const { lookupProposal, deleteProposal } = await import('../ai/proposer');
    const proposal = lookupProposal(userId, input.proposalId, this.now);
    if (!proposal) {
      throw new NotFoundError(`proposal ${input.proposalId} not found`);
    }
    if (!input.confirmed) {
      deleteProposal(userId, input.proposalId);
      return { proposal, executed: false };
    }
    // The route is responsible for the actual domain call. We
    // return the proposal so the route can dispatch it. Keeping
    // the side effect out of the orchestrator is intentional —
    // it makes the orchestrator trivially testable and matches
    // the Phase 8 invariant: "AI never mutates the database".
    // The actual write is performed by the route handler via the
    // existing planner / review service.
    return { proposal, executed: true };
  }
}

function collectCandidateSourceIds(ev: ClassificationEvidence): string[] {
  const ids: string[] = [ev.error.id];
  if (ev.question) ids.push(ev.question.id);
  if (ev.topic) ids.push(ev.topic.id);
  for (const r of ev.recentByTopic) ids.push(r.id);
  return ids;
}

/**
 * Collect every record id the assistant was allowed to cite in
 * the supplied bundle. The UI uses this to verify that each
 * `source.id` the model emitted corresponds to a real record.
 */
function collectAssistantCandidateSourceIds(
  bundle: AssistantEvidenceBundle,
): string[] {
  const ids: string[] = [];
  for (const e of bundle.errors) ids.push(e.id);
  for (const r of bundle.reviews) ids.push(r.id);
  for (const t of bundle.topics) ids.push(t.id);
  return ids;
}

/**
 * Generate a server-side id for a new proposal. The model's
 * `proposal.id` is never trusted; the orchestrator always
 * overwrites it. `crypto.randomUUID` is available in both
 * Node 19+ and the Fastify runtime.
 */
function makeProposalId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Defensive fallback for environments without Web Crypto.
  return `prop_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Re-export error helpers so route handlers do not have to
 * import from two places.
 */
export { AiOutputInvalidError, DependencyUnavailableError, isAppError };

/**
 * Stub shape returned by Step 4 (assistant Q&A) and Step 5
 * (proposals) until those steps land. Keeping them here as type
 * aliases documents the public surface of the orchestrator and
 * keeps the route file's import list stable across the three
 * implementation steps.
 */
export interface AnswerQueryInput {
  readonly question: string;
  readonly context?: string;
}

export interface AnswerQueryResult {
  readonly response: AssistantResponseT;
  /**
   * Every record id the assistant was allowed to cite. The UI
   * uses this to verify that each `source.id` the model emitted
   * corresponds to a real record.
   */
  readonly candidateSourceIds: string[];
}

export interface ConfirmProposalInput {
  readonly proposalId: string;
  readonly confirmed: boolean;
}

export interface ConfirmProposalResult {
  readonly proposal: AssistantProposalT;
  readonly executed: boolean;
}

/**
 * Convenience type re-exports for the Step 6 route.
 */
export type {
  AssistantProposalT,
  AssistantResponseT,
  ClassificationSuggestionResponseT,
  ClassificationSuggestionT,
  AiMessage,
  AiRequest,
};
