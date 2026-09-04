/**
 * KRODEX API — /tests routes.
 *
 *   GET    /tests                       — list test definitions
 *   POST   /tests                       — create a test definition
 *   GET    /tests/:id                   — read a test definition
 *   PATCH  /tests/:id                   — update a test definition
 *   POST   /tests/:id/questions         — attach a question
 *   GET    /tests/:id/questions         — list attached questions
 *   POST   /tests/:id/attempts          — start a fresh attempt
 *   GET    /tests/attempts              — list attempts
 *   GET    /tests/attempts/:id          — read an attempt
 *   GET    /tests/attempts/:id/answers  — list answers
 *   POST   /tests/attempts/:id/answers  — record an answer
 *   POST   /tests/attempts/:id/submit   — grade the attempt
 *
 * The submit endpoint invokes the Postgres RPC
 * `submit_test_attempt`; everything else uses the per-request
 * user client so RLS owns the rows.
 */

import type { FastifyInstance } from 'fastify';
import type {
  TestAnswerRow,
  TestAttemptRow,
  TestDefinitionRow,
  TestQuestionRow,
} from '@krodex/shared';
import { ok, okPage, requireAuth, withIdempotency } from './_helpers';
import { parseBody, parseParams, parseQuery } from '../validation/parse';
import {
  AnswerTestQuestionBody,
  AttachTestQuestionBody,
  CreateTestDefinitionBody,
  FromErrorsTestBody,
  IdParam,
  ListTestAttemptsQuery,
  ListTestDefinitionsQuery,
  StartTestAttemptBody,
  UpdateTestDefinitionBody,
} from '../validation/schemas';
import type { FromErrorsTestBodyT } from '../validation/schemas';
import * as tests from '../services/tests';
import { generateErrorPoolTest } from '../services/error-pool-test-generator';
import * as bridge from '../services/attempt-capture-bridge';
import { ForbiddenError } from '../errors';
import type { ApiSuccessEnvelope } from '@krodex/shared';

export function registerTestRoutes(app: FastifyInstance): void {
  app.get('/tests', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListTestDefinitionsQuery, req.query);
    const items = await tests.listTestDefinitions(req.supabaseUser, auth.userId, {
      ...(q.state ? { state: q.state } : {}),
      ...(q.source_kind ? { source_kind: q.source_kind } : {}),
    });
    return ok<readonly TestDefinitionRow[]>(reply, items);
  });

  app.post('/tests', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(CreateTestDefinitionBody, req.body);
    const created = await tests.createTestDefinition(req.supabaseUser, auth.userId, {
      title: body.title,
      source_kind: body.source_kind,
      source_payload: body.source_payload,
      intended_count: body.intended_count,
      duration_minutes: body.duration_minutes ?? null,
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    return ok<TestDefinitionRow>(reply, created, 201);
  });

  /**
   * POST /tests/from-errors
   *
   * Phase 10: compose a deterministic custom test from a set of
   * ErrorEntry ids. The service is idempotent at the data level:
   * the (sorted) id set is the pool signature, and a second call
   * with the same set returns the existing test with
   * `isNew: false`. The route is additionally wrapped in
   * `withIdempotency` so a client retry with the same
   * `Idempotency-Key` returns the prior response without
   * re-running the service call.
   */
  app.post(
    '/tests/from-errors',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const body = parseBody(FromErrorsTestBody, req.body);
      await withIdempotency<
        FromErrorsTestBodyT,
        { testId: string; questionCount: number; isNew: boolean }
      >({
        env: app.krodexEnv,
        req,
        reply,
        body,
        route: 'POST /tests/from-errors',
        action: async () => {
          const result = await generateErrorPoolTest(req.supabaseUser, auth.userId, {
            errorIds: body.errorIds,
            ...(body.title ? { title: body.title } : {}),
            questionsPerError: body.questionsPerError,
          });
          return {
            testId: result.testId,
            questionCount: result.questionCount,
            isNew: result.isNew,
          };
        },
        envelope: (data, requestId, timestamp) => ({
          success: true,
          data,
          requestId,
          timestamp,
        }),
      });
      return reply;
    },
  );

  app.get('/tests/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const row = await tests.getTestDefinition(req.supabaseUser, auth.userId, params.id);
    return ok<TestDefinitionRow>(reply, row);
  });

  app.patch('/tests/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(UpdateTestDefinitionBody, req.body);
    const row = await tests.updateTestDefinition(req.supabaseUser, auth.userId, params.id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.duration_minutes !== undefined ? { duration_minutes: body.duration_minutes } : {}),
      ...(body.state ? { state: body.state } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    return ok<TestDefinitionRow>(reply, row);
  });

  app.post('/tests/:id/questions', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(AttachTestQuestionBody, req.body);
    const row = await tests.attachTestQuestion(
      req.supabaseUser,
      auth.userId,
      params.id,
      body.question_id,
      body.display_order,
    );
    return ok<TestQuestionRow>(reply, row, 201);
  });

  app.get('/tests/:id/questions', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const items = await tests.listTestQuestions(req.supabaseUser, auth.userId, params.id);
    return ok<readonly TestQuestionRow[]>(reply, items);
  });

  app.post('/tests/:id/attempts', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const body = parseBody(StartTestAttemptBody, req.body);
    if (params.id !== body.test_id) {
      throw new ForbiddenError('test_id mismatch', { context: { paramsId: params.id, bodyId: body.test_id } });
    }
    const attempt = await tests.startTestAttempt(req.supabaseUser, auth.userId, body.test_id);
    return ok<TestAttemptRow>(reply, attempt, 201);
  });

  app.get('/tests/attempts', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const q = parseQuery(ListTestAttemptsQuery, req.query);
    const items = await tests.listTestAttempts(req.supabaseUser, auth.userId, {
      ...(q.test_id ? { test_id: q.test_id } : {}),
      ...(q.state ? { state: q.state } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return ok<readonly TestAttemptRow[]>(reply, items);
  });

  app.get('/tests/attempts/:id', { preHandler: app.authPreHandler }, async (req, reply) => {
    const auth = requireAuth(req);
    const params = parseParams(IdParam, req.params);
    const attempt = await tests.getTestAttempt(req.supabaseUser, auth.userId, params.id);
    return ok<TestAttemptRow>(reply, attempt);
  });

  app.get(
    '/tests/attempts/:id/answers',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const items = await tests.listTestAnswers(req.supabaseUser, auth.userId, params.id);
      return ok<readonly TestAnswerRow[]>(reply, items);
    },
  );

  app.post(
    '/tests/attempts/:id/answers',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      const body = parseBody(AnswerTestQuestionBody, req.body);
      const answer = await tests.recordAnswer(req.supabaseUser, auth.userId, params.id, {
        question_id: body.question_id,
        selected_option_ids: body.selected_option_ids,
        free_text: body.free_text ?? null,
        duration_ms: body.duration_ms ?? null,
      });
      return ok<TestAnswerRow>(reply, answer, 201);
    },
  );

  app.post(
    '/tests/attempts/:id/submit',
    { preHandler: app.authPreHandler },
    async (req, reply) => {
      const auth = requireAuth(req);
      const params = parseParams(IdParam, req.params);
      // Submit is the durable unit. The capture pipeline runs as
      // post-commit work: it must never roll back the grade and
      // must never fail the submit response. The submit RPC has
      // already written test_attempts and error_entries; the
      // bridge is best-effort.
      const result = await withIdempotency({
        env: app.krodexEnv,
        req,
        reply,
        // The body is empty for submit; we hash an empty object.
        body: { attempt_id: params.id },
        route: 'POST /tests/attempts/:id/submit',
        action: () => tests.submitTestAttempt(req.supabaseUser, auth.userId, params.id),
        envelope: (data, requestId, timestamp): ApiSuccessEnvelope<tests.SubmitTestAttemptResult> => ({
          success: true,
          data,
          requestId,
          timestamp,
        }),
      });
      // Fan out the capture pipeline per wrong answer. Bridge is
      // internally failure-tolerant: it returns a per-question
      // failure list and never throws. The outer try/catch is a
      // defensive backstop for unexpected infrastructure errors.
      try {
        await bridge.runCaptureForAttempt(req.supabaseUser, {
          userId: auth.userId,
          attemptId: params.id,
          storageBucket: app.krodexEnv.storageBucketErrorEvidence,
          aiProvider: app.assistantService.configuredProvider,
        });
      } catch (err) {
        req.log.warn(
          { err, attemptId: params.id },
          'capture bridge threw after submit; attempt grading preserved',
        );
      }
      return result;
    },
  );
}
