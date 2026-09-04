/**
 * KRODEX API — entry point.
 *
 * Phase 0: boot Fastify, expose a single GET /health route.
 * Phase 1: the /health route also reports persistence layer state
 *          (configured / ok / degraded / unreachable) via
 *          dbHealth().
 * Phase 2: every domain route is mounted. The auth preHandler
 *          enforces JWT verification + Supabase user lookup.
 *          Every authenticated route declares
 *          `preHandler: app.authPreHandler`.
 * Phase 3: the event bus (outbox worker + scheduled jobs) is
 *          built and started after the HTTP server is listening.
 *          GET /health reports its status.
 * Phase 4: the event bus grew a 4th handler (analytics rollup)
 *          and a 3rd scheduled job (5-minute analytics recompute,
 *          D-9 Class C). The dashboards endpoint surfaces the six
 *          PRD §24 metrics + the composite. The /health phase
 *          field reads '4'.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { KRODEX_VERSION } from '@krodex/shared';
import { dbHealth, loadEnv } from './db';
import { installErrorHandler } from './errors/error-handler';
import { installAuthPreHandler } from './auth/prehandler';
import { installRequestDecorations } from './server-decorations';
import { installSecurity } from './security/install-security';
import { registerAllRoutes } from './routes';
import { ok } from './routes/_helpers';
import { buildEventBus, type EventBus, type EventBusStatus } from './events/event-bus';

export interface BuildServerResult {
  app: FastifyInstance;
  eventBus: EventBus;
}

export async function buildServer(): Promise<FastifyInstance> {
  const result = await buildServerWithEventBus();
  // buildServer() is the contract used by tests and by the
  // legacy integration harness; it must return a server whose
  // /health is 'ok'. The bus is started here (rather than by
  // main()) so that test harnesses and ad-hoc invocations of
  // buildServer() get a fully running stack. main() additionally
  // installs the graceful-shutdown handler that the test path
  // does not need.
  result.eventBus.start();
  return result.app;
}

/**
 * Internal: build the Fastify app and the event bus, attaching the
 * event bus to the app under `app.eventBus` so /health can read it.
 *
 * The event bus is started by `main()` *after* `app.listen()` so a
 * slow boot does not block the listener from accepting connections.
 * Tests that want to start the bus manually (e.g. for end-to-end
 * event-bus tests) can call `result.eventBus.start()` themselves.
 */
export async function buildServerWithEventBus(): Promise<BuildServerResult> {
  const env = loadEnv();
  const app = Fastify({
    logger: { level: env.logLevel },
    disableRequestLogging: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.length > 0) return incoming;
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    },
  });

  await app.register(cors, {
    origin: [...env.corsAllowedOrigins],
    credentials: true,
  });

  // Order matters: decorate first so subsequent preHandlers can
  // attach to a known shape.
  installRequestDecorations(app, env);
  installErrorHandler(app);
  installAuthPreHandler(app, env);
  // Phase 14: rate-limit + helmet + under-pressure + request-id
  // echo. Skipped in test mode so per-route test harnesses
  // (which build their own Fastify and register only one route
  // group) do not hit the global limit during a single test
  // file. The dedicated security test installs it explicitly
  // with low ceilings to exercise the 429 path.
  await installSecurity(app, env);

  // Build (do not start) the event bus so /health can read its
  // status even when the bus is disabled. main() starts it.
  type AppLogFn = (obj: unknown, msg?: string) => void;
  const log: { info: AppLogFn; warn: AppLogFn; error: AppLogFn } = {
    info: ((obj: unknown, msg?: string) => app.log.info(obj, msg)) as AppLogFn,
    warn: ((obj: unknown, msg?: string) => app.log.warn(obj, msg)) as AppLogFn,
    error: ((obj: unknown, msg?: string) => app.log.error(obj, msg)) as AppLogFn,
  };
  const eventBus = buildEventBus(env, log);
  app.decorate('eventBus', eventBus);

  app.get('/health', async (request, reply) => {
    const db = await dbHealth(env);
    const bus: EventBusStatus = eventBus.status();
    const sec = app.krodexSecurity;
    return ok(reply, {
      // The API itself is up and answering. The event bus status
      // is its own sub-field; clients who care (k8s probes,
      // operator dashboards) inspect event_bus.running.
      status: 'ok',
      service: 'krodex-api',
      version: KRODEX_VERSION,
      phase: '4',
      timestamp: new Date().toISOString(),
      db,
      event_bus: {
        running: bus.running,
        reason: bus.reason,
        worker: bus.worker,
        scheduler: bus.scheduler,
      },
      // Phase 14: surface the security policy so operators
      // and k8s probes can confirm the rate-limit / helmet /
      // under-pressure plugins are live.
      security: sec
        ? {
            installed: sec.installed,
            policy: sec.policy,
            load_shedding: sec.loadShedding,
          }
        : null,
    });
  });

  // Domain routes. Auth is enforced per-route via the
  // `preHandler: app.authPreHandler` option; only /health and
  // /auth/dev-token are public.
  registerAllRoutes(app);

  return { app, eventBus };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const { app, eventBus } = await buildServerWithEventBus();
  try {
    await app.listen({ port: env.apiPort, host: env.apiHost });
    app.log.info(`KRODEX API listening on http://${env.apiHost}:${env.apiPort}`);
    // Start the event bus after the listener is up so the worker
    // does not block accept().
    eventBus.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown: stop the worker before closing Fastify.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'krodex.api.shutdown_initiated');
    try {
      eventBus.stop();
      await app.close();
      app.log.info('krodex.api.shutdown_complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'krodex.api.shutdown_failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
