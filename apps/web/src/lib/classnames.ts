/**
 * KRODEX web — class-name composition helpers.
 *
 * `cx(...)` accepts any mix of strings, falsy values, and
 * undefined (which is the type of CSS-module class lookups
 * under noUncheckedIndexedAccess). Falsy values are dropped.
 *
 * `cls(parts)` is the same helper, but takes an array — for
 * the common case of conditional className construction.
 *
 * Keeping this in `lib/` (not `components/`) because it's
 * pure logic, no JSX, and a few non-component modules (tests,
 * tooling) may want to use it.
 */

export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}

export function cls(parts: ClassValue[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}
