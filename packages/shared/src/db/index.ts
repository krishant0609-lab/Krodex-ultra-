/**
 * KRODEX — shared DB namespace.
 *
 * Re-exports every row/insert/update type and every enum union
 * used by the persistence layer. The API server (apps/api) and
 * the web app (apps/web) both consume this from @krodex/shared.
 */

export * from './enums';
export * from './enum-values';
export * from './types';
