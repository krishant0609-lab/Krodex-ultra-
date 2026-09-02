/**
 * KRODEX — shared types and utilities.
 *
 * This package is the source of truth for cross-app contracts (API ↔ Web).
 * Domain types, event payloads, and progress-dimension enums defined here
 * MUST be reused by both apps/api and apps/web rather than re-declared.
 *
 * Phase 1: the DB namespace (./db) ships the full set of row/insert/update
 * interfaces for every Phase 1 table plus the CHECK-constrained string
 * unions used by Postgres. Everything mirrors the migrations under
 * supabase/migrations/.
 */

export * from './db';
export * from './api';
export * from './events';

export const KRODEX_VERSION = '0.1.0-phase4';
