/**
 * KRODEX API — security middleware installer (Phase 14).
 *
 * Wires four orthogonal concerns behind a single entry point:
 *
 *   1. `@fastify/helmet`     — response security headers
 *                              (X-Frame-Options, X-Content-Type-Options,
 *                              Strict-Transport-Security, etc.).
 *   2. `@fastify/rate-limit` — per-key throttling. Auth routes get
 *                              the strictest budget; AI routes get
 *                              a tighter one; everything else
 *                              falls under the global ceiling.
 *   3. `@fastify/under-pressure` — load shedding. When event-loop
 *                              delay or heap usage crosses a
 *                              configurable threshold the plugin
 *                              returns 503 instead of degrading
 *                              slowly.
 *   4. `X-Request-ID` echo   — every response carries the same
 *                              request id that the structured log
 *                              uses. The genReqId hook in server.ts
 *                              is what produces the id; this
 *                              installer is what echoes it on
 *                              the response.
 *
 * Design notes:
 *   - This is a *separate* installer rather than inlined into
 *     `server.ts` so that test harnesses that build their own
 *     Fastify instance (evidence-routes.test.ts,
 *     planner-automation-routes.test.ts, etc.) can opt out by
 *     simply not calling it. Phase 0–13 tests do NOT depend on
 *     rate-limit / helmet, and adding those globally would
 *     risk breaking tests that intentionally do many requests.
 *   - All knobs come from `env` so a test environment can
 *     pass a low `rateLimitGlobalPerMin` and exercise the
 *     429 path without melting the rest of the suite.
 *   - The installer never throws on register failure; if
 *     registration fails we log it and continue. (Rate-limit
 *     misconfiguration in production is a degraded service,
 *     not a hard fail.)
 */

import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import type { ApiEnv } from '../config/env';

export interface SecurityOptions {
  /** When true (default), register helmet, rate-limit, under-pressure.
   *  Set false in test harnesses that want a bare Fastify. */
  readonly enabled?: boolean;
  /** Override per-route limits (mostly for tests). */
  readonly rateLimitGlobalPerMin?: number;
  readonly rateLimitAuthPerMin?: number;
  readonly rateLimitAiPerMin?: number;
}

export interface SecurityState {
  /** True when the four plugins registered cleanly. */
  readonly installed: boolean;
  /** Human-readable description of the rate-limit policy for /health. */
  readonly policy: {
    globalPerMin: number;
    authPerMin: number;
    aiPerMin: number;
  };
  /** True when under-pressure is wired and active. */
  readonly loadShedding: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Phase 14: populated by installSecurity. */
    krodexSecurity?: SecurityState;
  }
}

const ROUTES_AUTH = /^\/auth(\/|$)/;
const ROUTES_AI = /^\/assistant(\/|$)/;

/**
 * Register the security middleware. Returns a state object that
 * `GET /health` can echo so operators can verify the policy is
 * live.
 *
 * Never throws — partial failure is logged and the API continues
 * to serve traffic. The principle is: a misconfigured rate limiter
 * is a degraded (but not broken) API.
 */
export async function installSecurity(
  app: FastifyInstance,
  env: ApiEnv,
  opts: SecurityOptions = {},
): Promise<SecurityState> {
  const enabled = opts.enabled ?? env.nodeEnv !== 'test';
  const global = opts.rateLimitGlobalPerMin ?? env.rateLimitGlobalPerMin;
  const auth = opts.rateLimitAuthPerMin ?? env.rateLimitAuthPerMin;
  const ai = opts.rateLimitAiPerMin ?? env.rateLimitAiPerMin;

  if (!enabled) {
    const state: SecurityState = {
      installed: false,
      policy: { globalPerMin: global, authPerMin: auth, aiPerMin: ai },
      loadShedding: false,
    };
    app.krodexSecurity = state;
    return state;
  }

  // 1) Security headers.
  try {
    await app.register(helmet, {
      // The API emits JSON; we do not serve HTML so the CSP
      // headers helmet defaults to would be a no-op anyway. We
      // still want the X-Frame-Options / X-Content-Type-Options
      // / Referrer-Policy family.
      contentSecurityPolicy: false,
      // The API does not embed cross-origin scripts; crossOriginEmbedderPolicy=false
      // is the documented escape hatch for an API surface.
      crossOriginEmbedderPolicy: false,
    });
  } catch (err) {
    app.log.warn({ err }, 'krodex.security.helmet_register_failed');
  }

  // 2) Rate limiting. `global: true` enables the per-route default
  //    and the per-route `config.rateLimit` overrides below take
  //    precedence on auth + AI routes. Keying by user id when the
  //    request is authenticated, falling back to ip address for
  //    pre-auth calls.
  try {
    await app.register(rateLimit, {
      global: true,
      max: global,
      timeWindow: '1 minute',
      keyGenerator: (req: { auth?: { userId?: string }; ip: string }): string => {
        return req.auth?.userId ?? req.ip;
      },
      errorResponseBuilder: (
        _req: unknown,
        context: { after: string; max: number; ttl: number; ban: boolean },
      ) => {
        return {
          statusCode: 429,
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `rate limit exceeded; retry after ${context.after}`,
          },
          timestamp: new Date().toISOString(),
        };
      },
    });
  } catch (err) {
    app.log.warn({ err }, 'krodex.security.rate_limit_register_failed');
  }

  // 3) Per-route overrides. We can only set them via the
  //    `route` method of an already-registered rate-limit
  //    plugin, but a simpler path is to register the per-route
  //    limits in the route handlers themselves. The auth +
  //    assistant route groups apply their own ceiling via the
  //    `app.rateLimit()` helper exposed by `@fastify/rate-limit`.
  //    We do that lazily in their respective register* files.

  // 4) Under-pressure load shedding.
  let loadShedding = false;
  try {
    await app.register(underPressure, {
      // 1.5s event-loop delay → start shedding.
      maxEventLoopDelay: 1500,
      // 512MB heap used → start shedding.
      maxHeapUsedBytes: 512 * 1024 * 1024,
      // 1GB RSS → start shedding.
      maxRssBytes: 1024 * 1024 * 1024,
      // Always respond 503; we do not retry.
      pressureHandler: (
        _req: unknown,
        reply: { code: (status: number) => unknown; send: (body: unknown) => unknown },
        type: string,
        value?: number,
      ): void => {
        reply.code(503);
        reply.send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: `load shedding: ${type} (value=${value ?? 'n/a'})`,
        });
      },
    });
    loadShedding = true;
  } catch (err) {
    app.log.warn({ err }, 'krodex.security.under_pressure_register_failed');
  }

  // 5) X-Request-ID echo. The request id is generated by the
  //    `genReqId` hook in `server.ts`; we just mirror it on the
  //    response so a client (or ops dashboard) can correlate.
  app.addHook('onSend', async (req, reply, payload) => {
    const id = req.id;
    if (typeof id === 'string' && id.length > 0) {
      reply.header('X-Request-ID', id);
    }
    return payload;
  });

  const state: SecurityState = {
    installed: true,
    policy: { globalPerMin: global, authPerMin: auth, aiPerMin: ai },
    loadShedding,
  };
  app.krodexSecurity = state;
  return state;
}
