/**
 * KRODEX web — date formatters.
 *
 * Shared, dependency-free, deterministic formatters used by
 * dashboard, surface list rows, and editorial chrome. All
 * formatters accept ISO 8601 strings (the only date format
 * KRODEX stores or returns — see packages/shared/src/db/types).
 *
 * No locale parameter: a single, English-language display
 * matches the rest of the editorial shell. UTC is preserved
 * (we never convert to a user's local timezone in the
 * presentation layer).
 *
 * Returns `null` for invalid input so callers can render
 * "Unknown" rather than "Invalid Date".
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function safeDate(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  if (!ISO_DATE.test(iso) && !ISO_TIMESTAMP.test(iso)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * "Mon · 7 Mar" — short, deterministic, used by list rows.
 */
export function formatShortDate(iso: string | null | undefined): string | null {
  const d = safeDate(iso);
  if (!d) return null;
  const wd = WEEKDAYS[d.getUTCDay()];
  if (wd === undefined) return null;
  const day = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  if (monthIdx < 0 || monthIdx > 11) return null;
  const month = MONTHS[monthIdx]?.slice(0, 3);
  if (!month) return null;
  return `${wd.slice(0, 3)} · ${day} ${month}`;
}

/**
 * "Monday, 7 March 2026" — long, used by the hero strip.
 */
export function formatLongDate(iso: string | null | undefined): string | null {
  const d = safeDate(iso);
  if (!d) return null;
  const wd = WEEKDAYS[d.getUTCDay()];
  const monthIdx = d.getUTCMonth();
  if (!wd || monthIdx < 0 || monthIdx > 11) return null;
  const month = MONTHS[monthIdx];
  if (!month) return null;
  return `${wd}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/**
 * "2026-03-07" — the canonical ISO date (UTC).
 */
export function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * "Due 14:30" — used for time-of-day relative to today.
 * Returns "Due —" when input is unparseable.
 */
export function formatTimeOfDay(iso: string | null | undefined): string | null {
  const d = safeDate(iso);
  if (!d) return null;
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Coerces a date-only string or timestamp to its UTC date.
 * "2026-03-07T23:00:00Z" -> "2026-03-07".
 */
export function toIsoDateOnly(iso: string | null | undefined): string | null {
  const d = safeDate(iso);
  if (!d) return null;
  return toIsoDate(d);
}
