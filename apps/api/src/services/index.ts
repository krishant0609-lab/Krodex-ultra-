/**
 * KRODEX API — domain services namespace.
 *
 * Services own the business rules; routes orchestrate. The split
 * keeps the Fastify handlers small and lets the services be unit
 * tested against a mocked Supabase client without booting HTTP.
 */

export * as users from './users';
export * as syllabus from './syllabus';
export * as tests from './tests';
export * as errors from './errors';
export * as review from './review';
export * as planner from './planner';
export * as backlog from './backlog';
export * as progress from './progress';
