/**
 * KRODEX API — Fastify instance + request decorations.
 *
 * Centralizes the typed extensions so route handlers, services,
 * and middleware all see the same shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiEnv } from './config/env';
import { getUserClient } from './db/supabase';
import { UnauthorizedError } from './errors';

export interface RequestAuth {
  userId: string;
  userEmail: string;
  jwt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: RequestAuth;
    supabaseUser: SupabaseClient;
  }
  interface FastifyInstance {
    /** Boot-time env. Frozen. */
    krodexEnv: ApiEnv;
    /** Per-route auth preHandler. */
    authPreHandler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Phase 3 event bus. Decoration is set in `server.ts` (after
     * the Fastify instance is built). The /health route reads
     * `app.eventBus.status()`; route tests do not.
     */
    eventBus?: import('./events/event-bus').EventBus;
  }
}

export function installRequestDecorations(app: FastifyInstance, env: ApiEnv): void {
  app.decorate('krodexEnv', env);
  app.decorateRequest('auth', null);
  app.decorateRequest('supabaseUser', null);
}

export function requireAuth(req: FastifyRequest): RequestAuth {
  if (!req.auth) {
    throw new UnauthorizedError('authentication required');
  }
  return req.auth;
}

/** Build the user-scoped Supabase client for the request. */
export function buildSupabaseUser(env: ApiEnv, jwt: string): SupabaseClient {
  return getUserClient(env, jwt);
}
