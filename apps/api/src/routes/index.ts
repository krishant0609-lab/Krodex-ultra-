/**
 * KRODEX API — route registration entry point.
 *
 * One call from `server.ts` registers every authenticated and
 * unauthenticated endpoint. The order is not important for
 * Fastify; the auth preHandler is installed at the app level
 * (see server-decorations.ts) and routes opt in by listing it
 * in their `preHandler`.
 */

import type { FastifyInstance } from 'fastify';
import { registerUserRoutes } from './users';
import { registerAuthRoutes } from './auth';
import { registerSyllabusRoutes } from './syllabus';
import { registerTestRoutes } from './tests';
import { registerErrorRoutes } from './errors';
import { registerReviewRoutes } from './review';
import { registerPlannerRoutes } from './planner';
import { registerBacklogRoutes } from './backlog';
import { registerProgressRoutes } from './progress';
import { registerAnalyticsRoutes } from './analytics';
import { registerStudentModelRoutes } from './student-model';
import { registerAssistantRoutes } from './assistant';
import { registerEvidenceRoutes } from './evidence';
import { registerReviewSessionRoutes } from './review-session';
import { registerOpsRoutes } from './ops';

export function registerAllRoutes(app: FastifyInstance): void {
  registerAuthRoutes(app);
  registerUserRoutes(app);
  registerSyllabusRoutes(app);
  registerTestRoutes(app);
  registerErrorRoutes(app);
  registerReviewRoutes(app);
  registerPlannerRoutes(app);
  registerBacklogRoutes(app);
  registerProgressRoutes(app);
  registerAnalyticsRoutes(app);
  registerStudentModelRoutes(app);
  registerAssistantRoutes(app);
  registerEvidenceRoutes(app);
  registerReviewSessionRoutes(app);
  // Phase 16 M8: service-role-only ops monitor.
  registerOpsRoutes(app);
}
