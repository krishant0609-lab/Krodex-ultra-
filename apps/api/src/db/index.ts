/**
 * KRODEX API — persistence namespace.
 *
 * Phase 1: exposes the env loader, the two Supabase clients, and the
 * database health probe. Future phases add typed repositories here
 * (one per Phase 1 entity, generated or hand-written).
 */

export * from '../config/env';
export * from './supabase';
export * from './health';
