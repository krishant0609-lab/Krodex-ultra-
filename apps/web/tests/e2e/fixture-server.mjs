/* eslint-disable */
/**
 * KRODEX e2e fixture API server.
 *
 * A self-contained Node HTTP server that returns the same envelope
 * shapes the real Phase 5 API returns. It is NOT a copy of the API
 * — it is a thin, truthful stub:
 *
 *  - Every endpoint returns either a { success: true, data: ... }
 *    envelope or a { success: false, error: { code, message } }
 *    envelope, matching @krodex/shared's envelope contract.
 *  - Default data is empty (zero rows, null, {}) — i.e. the
 *    "cold start" truth the user lands on for every surface.
 *  - /auth/dev-token mints a stub bearer token (no signature
 *    verification on the client; the fixture is trusted). This
 *    lets the browser exercise the real login form.
 *  - Per-endpoint overrides (seed-1) let individual Playwright
 *    tests opt into populated fixtures via a small set of
 *    X-Seed-Data headers or env-flag variants. Empty by default.
 *
 * Why this server exists:
 *  - We must not touch apps/api, packages/shared, or supabase.
 *  - We need a real HTTP server (not page.route) so the dev-token
 *    mint goes through the same code path as production.
 *  - The dev server (next dev) is the only thing we run inside
 *    Playwright's webServer, and it needs NEXT_PUBLIC_API_BASE_URL
 *    set to this server's URL.
 *
 * Usage: node tests/e2e/fixture-server.mjs [port]
 *   default port: 4000
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.FIXTURE_PORT ?? process.argv[2] ?? 4000);
const NOW = new Date('2026-09-03T12:00:00.000Z').toISOString();
function currentSeed() {
  return process.env.FIXTURE_SEED ?? 'empty';
}

function ok(data) {
  return { success: true, data };
}

function err(code, message, status = 400) {
  return { body: { success: false, error: { code, message } }, status };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function emptyPage() {
  return { items: [], nextCursor: null };
}

// Per-endpoint data. Empty by default. Some endpoints get a minimal
// populated shape under SEED === 'populated' so visual tests can
// check that the "with-data" state renders without overflowing.
const seedPopulated = {
  // For visual tests, we only need enough data to prove layout
  // doesn't overflow. No fabricated identifiers — see SEED.md.
  '/syllabus/subjects': { items: [], nextCursor: null },
  '/syllabus/topics': { items: [], nextCursor: null },
  '/syllabus/sub-topics': { items: [], nextCursor: null },
};

function dataFor(path, method) {
  // Specialised endpoints.
  if (path === '/auth/dev-token' && method === 'POST') return null; // handled inline
  if (path === '/users/me') return ok({ id: 'user-fixture', display_name: 'Fixture User', timezone: 'UTC' });
  if (path === '/users/me/profile') return ok({ id: 'user-fixture', display_name: 'Fixture User', timezone: 'UTC' });
  if (path === '/student-model') return ok({
    snapshot: {
      userId: 'user-fixture',
      evidenceWindowDays: 28,
      features: {},
      overallConfidence: 'limited',
      computedAt: NOW,
    },
    windowDays: 28,
  });

  // First-party NOT_FOUND for known-id deep links so the page
  // surfaces its honest empty-state card.
  if (/^\/tests\/[a-z0-9-]+$/.test(path) && method === 'GET') {
    return err('NOT_FOUND', 'Test not found', 404);
  }
  if (/^\/tests\/attempts\/[a-z0-9-]+$/.test(path) && method === 'GET') {
    return err('NOT_FOUND', 'Attempt not found', 404);
  }
  // Phase 8: under the ai-classification seed, the synthetic error
  // id `error-unclassified` is returned as a real row with
  // `mistake_type: null` so the AI suggestion card renders. Other
  // ids still 404.
  if (/^\/errors\/[a-z0-9-]+$/.test(path) && method === 'GET') {
    const id = path.split('/').pop();
    if (currentSeed() === 'ai-classification' && id === 'error-unclassified') {
      return ok({
        id,
        user_id: 'user-fixture',
        question_id: null,
        status: 'active',
        mistake_type: null,
        remark: 'I misread the second sentence.',
        source_attempt_id: null,
        first_seen_at: NOW,
        last_seen_at: NOW,
        resolved_at: null,
        recurrence_count: 0,
        metadata: {},
        created_at: NOW,
        updated_at: NOW,
      });
    }
    if (currentSeed() === 'ai-classification-unavailable' && id === 'error-unclassified') {
      return ok({
        id,
        user_id: 'user-fixture',
        question_id: null,
        status: 'active',
        mistake_type: null,
        remark: 'I misread the second sentence.',
        source_attempt_id: null,
        first_seen_at: NOW,
        last_seen_at: NOW,
        resolved_at: null,
        recurrence_count: 0,
        metadata: {},
        created_at: NOW,
        updated_at: NOW,
      });
    }
    return err('NOT_FOUND', 'Error not found', 404);
  }
  if (/^\/review\/schedules\/[a-z0-9-]+$/.test(path) && method === 'GET') {
    return err('NOT_FOUND', 'Review schedule not found', 404);
  }

  // Phase 8: POST /errors/:id/classification-suggest
  // Under seed=ai-classification returns a real suggestion; under
  // seed=ai-classification-unavailable returns 503.
  if (/^\/errors\/[a-z0-9-]+\/classification-suggest$/.test(path) && method === 'POST') {
    if (currentSeed() === 'ai-classification-unavailable') {
      return err('DEPENDENCY_UNAVAILABLE', 'AI provider not configured', 503);
    }
    return ok({
      suggestion: {
        suggestedCategory: 'misread',
        rationale: 'The remark mentions misreading the second sentence.',
        confidence: 0.82,
        sourceIds: ['error-unclassified'],
      },
      candidateSourceIds: ['error-unclassified'],
    });
  }

  // Phase 8: PATCH /errors/:id — accept the write, return the
  // updated row. The fixture is trusted: the test asserts that
  // *some* PATCH fires with the suggested category in the body.
  // We return a populated row whose `mistake_type` reflects the
  // student's most recent write — the test does not depend on
  // exact body parsing here.
  if (/^\/errors\/[a-z0-9-]+$/.test(path) && method === 'PATCH') {
    const id = path.split('/').pop();
    return ok({
      id,
      user_id: 'user-fixture',
      question_id: null,
      status: 'active',
      mistake_type: 'misread',
      remark: 'I misread the second sentence.',
      source_attempt_id: null,
      first_seen_at: NOW,
      last_seen_at: NOW,
      resolved_at: null,
      recurrence_count: 0,
      metadata: {},
      created_at: NOW,
      updated_at: NOW,
    });
  }

  // Phase 8: POST /assistant/queries
  //   seed=ai-assistant            → 200 with answer + sources + proposal
  //   seed=ai-assistant-empty      → 200 with answer, no sources
  //   seed=ai-assistant-unavailable → 503 DEPENDENCY_UNAVAILABLE
  //   seed=ai-assistant-invalid    → 422 AI_OUTPUT_INVALID
  //   default                      → 200 with a plain answer (no proposal)
  if (path === '/assistant/queries' && method === 'POST') {
    if (currentSeed() === 'ai-assistant-unavailable') {
      return err('DEPENDENCY_UNAVAILABLE', 'AI provider not configured', 503);
    }
    if (currentSeed() === 'ai-assistant-invalid') {
      return err('AI_OUTPUT_INVALID', 'AI output did not match the expected schema', 422);
    }
    if (currentSeed() === 'ai-assistant-empty') {
      return ok({
        response: {
          answer: 'I have nothing to draw on yet.',
          sources: [],
        },
        candidateSourceIds: [],
      });
    }
    if (currentSeed() === 'ai-assistant') {
      return ok({
        response: {
          answer:
            'Review Arithmetic next; you have one open error on it (see err-1).',
          sources: [
            { kind: 'error', id: 'err-1', excerpt: 'I misread the second sentence.' },
            { kind: 'topic', id: 'topic-arithmetic', excerpt: 'name: Arithmetic' },
          ],
          proposal: {
            id: 'proposal-abc',
            kind: 'create_task',
            description: 'Schedule a 30-min review of Arithmetic on Friday.',
            affectedRecords: ['topic-arithmetic'],
            payload: {
              title: 'Review Arithmetic',
              duration_minutes: 30,
              topic_id: 'topic-arithmetic',
              due_at: '2026-09-04T17:00:00.000Z',
            },
            createdAt: Date.parse('2026-09-03T12:00:00.000Z'),
          },
        },
        candidateSourceIds: ['err-1', 'topic-arithmetic'],
      });
    }
    // Default — keep the surface honest: an answer with a single
    // synthesised source so the page renders cleanly when an E2E
    // spec forgets to set a seed. The assistant route is mounted
    // in the nav on every page, so the dev-server warmup can
    // incidentally exercise it.
    return ok({
      response: {
        answer: 'No records match your question yet.',
        sources: [],
      },
      candidateSourceIds: [],
    });
  }

  // Phase 8: POST /assistant/proposals/:id/confirm
  //   seed=ai-assistant-not-found  → 404 NOT_FOUND
  //   default                      → 200 with executed:true + dispatched row
  // The dispatch shape mirrors what the real API returns for a
  // 'create_task' proposal that successfully created a planner
  // task. We don't actually create anything; the fixture is
  // trusted and the test only asserts the page transitions to
  // the "Applied" band.
  if (/^\/assistant\/proposals\/[a-z0-9-]+\/confirm$/.test(path) && method === 'POST') {
    const id = path.split('/')[3];
    if (currentSeed() === 'ai-assistant-not-found') {
      return err('NOT_FOUND', 'proposal expired', 404);
    }
    return ok({
      executed: true,
      proposal: {
        id,
        kind: 'create_task',
        description: 'Schedule a 30-min review of Arithmetic on Friday.',
        affectedRecords: ['topic-arithmetic'],
        payload: {},
        createdAt: Date.parse('2026-09-03T12:00:00.000Z'),
      },
      dispatched: { kind: 'create_task', taskId: 'task-new' },
    });
  }

  // Paginated list endpoints.
  if (path === '/tests' || path === '/tests/attempts' || path === '/errors' ||
      path === '/review/schedules' || path === '/notifications' ||
      path === '/planner/tasks' || path === '/backlog' ||
      path === '/progress/evidence') {
    return ok(emptyPage());
  }

  // Per-test questions (empty).
  if (/^\/tests\/[a-z0-9-]+\/questions$/.test(path)) return ok([]);

  // Per-attempt answers (empty).
  if (/^\/tests\/attempts\/[a-z0-9-]+\/answers$/.test(path)) return ok([]);

  // Syllabus tree (empty).
  if (path === '/syllabus/subjects' || path === '/syllabus/topics' || path === '/syllabus/sub-topics') {
    return ok([]);
  }

  // Analytics (empty objects — the insights page renders empty
  // sections when these are missing).
  if (path.startsWith('/analytics/')) return ok({});

  // Default: empty success envelope.
  return ok({});
}

async function handler(req, res) {
  // CORS for the Next dev server's origin (we don't actually need
  // CORS for same-origin from inside the browser, but be safe).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Health.
  if (path === '/health' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', seed: currentSeed() }));
    return;
  }

  // Test-only: flip the active seed at runtime so a single
  // fixture process can serve tests with different data shapes.
  // Intentionally unauthenticated; this endpoint only exists
  // when running the fixture server and is never reachable
  // from the real app or from production code paths.
  if (path === '/__fixture/seed' && method === 'POST') {
    const body = await readJsonBody(req);
    if (typeof body?.seed === 'string' && /^[a-z0-9-]+$/.test(body.seed)) {
      // eslint-disable-next-line no-undef
      process.env.FIXTURE_SEED = body.seed;
      // eslint-disable-next-line no-undef
      const newSeed = process.env.FIXTURE_SEED;
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify(ok({ seed: newSeed })));
      return;
    }
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: { code: 'BAD_REQUEST', message: 'invalid seed' } }));
    return;
  }

  // POST /auth/dev-token — the one mutation we need to support so
  // the browser login form can mint a token. We do not verify the
  // body shape; the fixture is trusted and the client only needs a
  // truthful envelope with a non-empty token.
  if (path === '/auth/dev-token' && method === 'POST') {
    await readJsonBody(req);
    const token = `fixture.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
    const ttl = 3600;
    const expires_at = new Date(Date.now() + ttl * 1000).toISOString();
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(ok({ token, expires_at })));
    return;
  }

  // Per-endpoint route.
  const result = dataFor(path, method);
  if (result && 'status' in result) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = result.status;
    res.end(JSON.stringify(result.body));
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify(result ?? ok({})));
}

const server = createServer((req, res) => {
  handler(req, res).catch((e) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: { code: 'INTERNAL', message: String(e) } }));
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[fixture] KRODEX e2e fixture API listening on http://localhost:${PORT} (seed=${currentSeed()})`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
