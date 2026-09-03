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
 *
 * Step 3 wires the classification-suggest route to the orchestrator.
 * Steps 4 + 5 + 6 wire the assistant query and proposal confirm
 * routes.
 */

import type { FastifyInstance } from 'fastify';
import { ok, requireAuth } from './_helpers';
import { parseBody, parseParams } from '../validation/parse';
import { IdParam } from '../validation/schemas';
import { ProposalConfirmBodySchema } from '../ai/schemas';

export function registerAssistantRoutes(app: FastifyInstance): void {
  // /assistant/queries
  app.post('/assistant/queries', { preHandler: app.authPreHandler }, async (req, reply) => {
    requireAuth(req);
    // Real implementation arrives in Step 4 (assistant grounding pipeline)
    // + Step 6 (route wiring). For now, return an explicit NOT IMPLEMENTED
    // payload so the route table is stable and the auth preHandler is
    // exercised in Step 1's typecheck.
    return ok<{ implemented: false; note: string }>(reply, {
      implemented: false,
      note: 'Phase 8 /assistant/queries lands in Step 4 + Step 6.',
    });
  });

  // /assistant/proposals/:id/confirm
  app.post(
    '/assistant/proposals/:id/confirm',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(ProposalConfirmBodySchema, req.body);
      // Real implementation arrives in Step 5 (proposal pipeline) +
      // Step 6. For now, validate the body and return a stub so the
      // route is reachable from typecheck onward.
      return ok<{
        executed: boolean;
        note: string;
        userId: string;
        proposalId: string;
      }>(reply, {
        executed: body.confirmed,
        note: 'Phase 8 /assistant/proposals/:id/confirm lands in Step 5 + Step 6.',
        userId: auth.userId,
        proposalId: params.id,
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
