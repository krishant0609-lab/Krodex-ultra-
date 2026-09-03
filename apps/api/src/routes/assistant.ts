/**
 * KRODEX API — /assistant routes.
 *
 *   POST /assistant/queries                    — evidence-grounded Q&A
 *   POST /assistant/proposals/:id/confirm      — student confirms or rejects a proposal
 *   POST /errors/:id/classification-suggest    — non-authoritative classification suggestion
 *
 * Phase 8 / Implementation Plan §330–366. The AI is non-authoritative:
 * it suggests and proposes, the student decides. Every mutation goes
 * through the same domain services the normal UI uses.
 *
 * The AI is wired through `app.assistantService` (set in
 * `server-decorations.ts` at boot). Tests inject a fake service by
 * overriding the decoration before the routes are registered.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams } from '../validation/parse';
import { IdParam } from '../validation/schemas';
import {
  AssistantQueryBodySchema,
  ProposalConfirmBodySchema,
  type AssistantProposalT,
} from '../ai/schemas';
import { createPlannerTask, type CreatePlannerTaskInput } from '../services/planner';
import { scheduleReview, type ScheduleReviewInput } from '../services/review';

/**
 * Strict payload schemas for the two proposal kinds Phase 8
 * supports. The AI is allowed to set *some* fields (title,
 * strategy, due_at) but the route fills in defaults (plan_date,
 * metadata, schedule timestamps) before calling the domain
 * service. This is the second-layer validation: the orchestrator
 * verified the proposal's affected record ids, the dispatcher
 * verifies the proposal's payload shape.
 */
const CreateTaskPayloadSchema = z.object({
  title: z.string().min(1).max(200),
  plan_date: z.string().min(1).max(20).optional(),
  planned_minutes: z.number().int().min(1).max(600).optional(),
  subject_id: z.string().min(1).max(64).nullable().optional(),
  topic_id: z.string().min(1).max(64).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

const ScheduleReviewPayloadSchema = z.object({
  error_id: z.string().min(1).max(64),
  strategy: z.enum(['standard', 'spaced', 'focused', 'retest_only']),
  due_at: z.string().min(1).max(40),
});

/** A proposal the AI may suggest for the `create_task` kind. */
interface CreateTaskResult {
  readonly kind: 'create_task';
  readonly taskId: string;
}

/** A proposal the AI may suggest for the `schedule_review` kind. */
interface ScheduleReviewResult {
  readonly kind: 'schedule_review';
  readonly reviewId: string;
}

type DispatchResult = CreateTaskResult | ScheduleReviewResult;

export function registerAssistantRoutes(app: FastifyInstance): void {
  // /assistant/queries
  //
  // Step 6 wires the orchestrator. The route validates the body
  // and requires auth, then defers entirely to the assistant
  // service. Errors (auth, AI unavailable, hallucination, etc.)
  // propagate through Fastify's error handler with the right
  // HTTP status:
  //   401 UNAUTHORIZED          — no JWT
  //   400 VALIDATION            — body fails Zod parse
  //   503 DEPENDENCY_UNAVAILABLE — no AI key / provider 5xx /
  //                              AiOutputInvalid (translated by
  //                              normalizeAssistantError)
  app.post('/assistant/queries', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(AssistantQueryBodySchema, req.body);
    const result = await app.assistantService.answerQuery(req.supabaseUser, auth.userId, {
      question: body.question,
      context: body.context,
    });
    return ok(reply, result);
  });

  // /assistant/proposals/:id/confirm
  //
  // The student explicitly opts in (or out). On confirm, the
  // route dispatches the proposal to the matching domain
  // service — the AI is never allowed to write to the database
  // itself. On reject, the proposal is removed from the TTL
  // map and no mutation is performed.
  //
  // Errors:
  //   401 UNAUTHORIZED
  //   400 VALIDATION
  //   404 NOT_FOUND            — proposal expired or unknown
  //   503 DEPENDENCY_UNAVAILABLE — proposal payload is malformed
  //                              for the requested kind
  app.post(
    '/assistant/proposals/:id/confirm',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(ProposalConfirmBodySchema, req.body);
      const result = await app.assistantService.confirmProposal(auth.userId, {
        proposalId: params.id,
        confirmed: body.confirmed,
      });
      if (!result.executed) {
        // Reject: orchestrator already removed the entry. No
        // mutation. The route returns the proposal back so the
        // UI can render the rejected card.
        return ok(reply, {
          executed: false,
          proposal: result.proposal,
        });
      }
      // Confirm: dispatch the proposal to the matching domain
      // service. The dispatcher is the only place the AI's
      // payload hits the write path.
      const dispatched = await dispatchProposal(
        app,
        req.supabaseUser,
        auth.userId,
        result.proposal,
      );
      return ok(reply, {
        executed: true,
        proposal: result.proposal,
        dispatched,
      });
    },
  );

  // /errors/:id/classification-suggest
  //
  // Step 3 wires the orchestrator. The route validates params +
  // requires auth, then defers entirely to the assistant service.
  // Errors (auth, AI unavailable, hallucination, etc.) propagate
  // through Fastify's error handler with the right HTTP status:
  //   401 UNAUTHORIZED     — no JWT
  //   404 NOT_FOUND        — error not found
  //   403 FORBIDDEN        — not owned by the caller
  //   503 DEPENDENCY_UNAVAILABLE — no AI key / provider 5xx / hallucination
  //   422 AI_OUTPUT_INVALID — provider returned non-JSON (raised by the
  //                            adapter; orchestrator also translates it to
  //                            503 via `normalizeClassifierError`, so in
  //                            practice the route only ever returns 503)
  app.post(
    '/errors/:id/classification-suggest',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const result = await app.assistantService.classifyError(
        req.supabaseUser,
        auth.userId,
        params.id,
      );
      return ok(reply, result);
    },
  );
}

/**
 * Dispatch a confirmed proposal to its matching domain service.
 *
 * The dispatcher validates the proposal's `payload` against the
 * strict per-kind Zod schema, fills in any defaults the AI
 * didn't supply (today's date, default review strategy), and
 * calls the existing Phase 2 service. The service enforces its
 * own ownership + validation — the dispatcher does not duplicate
 * that.
 *
 * If the payload is malformed (the AI emitted a `create_task`
 * with no `title`, etc.), the dispatcher throws
 * `DependencyUnavailableError` so the route returns 503 and the
 * UI shows the deterministic fallback.
 */
async function dispatchProposal(
  app: FastifyInstance,
  client: Parameters<typeof createPlannerTask>[0],
  userId: string,
  proposal: AssistantProposalT,
): Promise<DispatchResult> {
  if (proposal.kind === 'create_task') {
    const parsed = CreateTaskPayloadSchema.safeParse(proposal.payload);
    if (!parsed.success) {
      throw new (await import('../errors')).DependencyUnavailableError(
        'AI proposal payload is invalid for create_task',
        { context: { issues: parsed.error.issues } },
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    const input: CreatePlannerTaskInput = {
      title: parsed.data.title,
      plan_date: parsed.data.plan_date ?? today,
      planned_minutes: parsed.data.planned_minutes ?? null,
      subject_id: parsed.data.subject_id ?? null,
      topic_id: parsed.data.topic_id ?? null,
      description: parsed.data.description ?? null,
      metadata: { source: 'assistant', proposalId: proposal.id },
    };
    const task = await createPlannerTask(client, userId, input);
    return { kind: 'create_task', taskId: task.id };
  }
  if (proposal.kind === 'schedule_review') {
    const parsed = ScheduleReviewPayloadSchema.safeParse(proposal.payload);
    if (!parsed.success) {
      throw new (await import('../errors')).DependencyUnavailableError(
        'AI proposal payload is invalid for schedule_review',
        { context: { issues: parsed.error.issues } },
      );
    }
    const input: ScheduleReviewInput = {
      error_id: parsed.data.error_id,
      strategy: parsed.data.strategy,
      due_at: parsed.data.due_at,
      metadata: { source: 'assistant', proposalId: proposal.id },
    };
    const review = await scheduleReview(client, userId, input);
    return { kind: 'schedule_review', reviewId: review.id };
  }
  // The schema rejects unknown kinds at parse time, so this is
  // unreachable. The exhaustive check is here for type safety.
  const exhaustive: never = proposal.kind;
  throw new (await import('../errors')).DependencyUnavailableError(
    'AI proposal kind is not supported',
    { context: { kind: exhaustive } },
  );
}
