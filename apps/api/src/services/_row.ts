/**
 * KRODEX API — type-cast helpers for Supabase query results.
 *
 * The shared Supabase Database type only declares a subset of the
 * Phase 1 tables, so query results come back as
 * `Readonly<Record<string, unknown>>` for the rest. Going through
 * `unknown` keeps the cast explicit and survives strict mode.
 *
 * These helpers do NOT lie about correctness — the runtime rows
 * are the source of truth; the call site is responsible for the
 * shape it expects.
 */

export function asRow<T>(value: unknown): T {
  return value as T;
}

export function asRows<T>(value: readonly unknown[]): T[] {
  return value as T[];
}
