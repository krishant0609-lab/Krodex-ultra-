/**
 * KRODEX — notification preferences service.
 *
 * Per Phase 12 plan, every student has a `notification_preferences`
 * JSON blob stored in `profiles.settings`. The blob controls:
 *   - quiet_hours: time window during which non-critical notifications
 *     are suppressed
 *   - enabled_kinds: per-kind opt-in list (empty = all enabled)
 *   - disabled_kinds: per-kind opt-out list (always wins over enabled)
 *   - in_app_enabled / email_enabled / push_enabled: per-channel toggles
 *
 * Fail-open policy (per plan §25): if a preference lookup fails, the
 * caller MUST treat the kind as enabled and assume the user is NOT
 * in quiet hours. Better to over-notify than to silently drop alerts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@krodex/shared';

export interface QuietHoursConfig {
  enabled: boolean;
  /** HH:MM (24h) in the user's local timezone. */
  start: string;
  /** HH:MM (24h) in the user's local timezone. */
  end: string;
}

export interface NotificationPreferences {
  quiet_hours: QuietHoursConfig;
  enabled_kinds: readonly string[];
  disabled_kinds: readonly string[];
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.freeze({
  quiet_hours: { enabled: false, start: '22:00', end: '08:00' },
  enabled_kinds: [],
  disabled_kinds: [],
  in_app_enabled: true,
  email_enabled: false,
  push_enabled: false,
});

const PREFERENCES_KEY = 'notification_preferences';

/** Read a preferences blob from a Json settings dict; merge in defaults. */
export function preferencesFromSettings(settings: Json | null | undefined): NotificationPreferences {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled_kinds: [...DEFAULT_NOTIFICATION_PREFERENCES.enabled_kinds], disabled_kinds: [...DEFAULT_NOTIFICATION_PREFERENCES.disabled_kinds] };
  }
  const obj = settings as Record<string, unknown>;
  const raw = obj[PREFERENCES_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled_kinds: [...DEFAULT_NOTIFICATION_PREFERENCES.enabled_kinds], disabled_kinds: [...DEFAULT_NOTIFICATION_PREFERENCES.disabled_kinds] };
  }
  return mergePreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, enabled_kinds: [...DEFAULT_NOTIFICATION_PREFERENCES.enabled_kinds], disabled_kinds: [...DEFAULT_NOTIFICATION_PREFERENCES.disabled_kinds] }, raw as Record<string, unknown>);
}

/** Merge a partial patch into a base preferences object. */
function mergePreferences(
  base: NotificationPreferences,
  patch: Record<string, unknown>,
): NotificationPreferences {
  const out: NotificationPreferences = { ...base, enabled_kinds: [...base.enabled_kinds], disabled_kinds: [...base.disabled_kinds] };
  if (typeof patch.quiet_hours === 'object' && patch.quiet_hours !== null && !Array.isArray(patch.quiet_hours)) {
    const qh = patch.quiet_hours as Record<string, unknown>;
    out.quiet_hours = {
      enabled: typeof qh.enabled === 'boolean' ? qh.enabled : base.quiet_hours.enabled,
      start: typeof qh.start === 'string' ? qh.start : base.quiet_hours.start,
      end: typeof qh.end === 'string' ? qh.end : base.quiet_hours.end,
    };
  }
  if (Array.isArray(patch.enabled_kinds)) {
    out.enabled_kinds = patch.enabled_kinds.filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(patch.disabled_kinds)) {
    out.disabled_kinds = patch.disabled_kinds.filter((x): x is string => typeof x === 'string');
  }
  if (typeof patch.in_app_enabled === 'boolean') out.in_app_enabled = patch.in_app_enabled;
  if (typeof patch.email_enabled === 'boolean') out.email_enabled = patch.email_enabled;
  if (typeof patch.push_enabled === 'boolean') out.push_enabled = patch.push_enabled;
  if (typeof patch.created_at === 'string') out.created_at = patch.created_at;
  if (typeof patch.updated_at === 'string') out.updated_at = patch.updated_at;
  return out;
}

/**
 * Read a user's notification preferences.
 *
 * Returns the defaults when the profile is missing or the JSON blob is
 * absent. Never throws on missing data (fail-open per plan §25).
 */
export async function getPreferences(
  client: SupabaseClient,
  userId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from('profiles')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    // Fail-open: return defaults.
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled_kinds: [], disabled_kinds: [] };
  }
  return preferencesFromSettings(data?.settings as Json | null | undefined);
}

/**
 * Persist a patch into `profiles.settings.notification_preferences`.
 * The patch is merged into the existing blob; other keys in `settings`
 * are preserved.
 */
export async function updatePreferences(
  client: SupabaseClient,
  userId: string,
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from('profiles')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw new Error(`updatePreferences read failed: ${error.message}`);
  }
  const currentSettings = (data?.settings as Json | null | undefined) ?? {};
  const currentObj = (currentSettings && typeof currentSettings === 'object' && !Array.isArray(currentSettings)
    ? (currentSettings as Record<string, unknown>)
    : {});
  const current = preferencesFromSettings(currentSettings);
  const now = new Date().toISOString();
  const next = mergePreferences(current, patch as Record<string, unknown>);
  if (!next.created_at) next.created_at = now;
  next.updated_at = now;
  const mergedSettings: Record<string, unknown> = {
    ...currentObj,
    [PREFERENCES_KEY]: next,
  };

  // Upsert: when no profile row exists yet, this creates one
  // keyed on user_id. The profiles.user_id unique constraint
  // makes the upsert safe across concurrent calls.
  const { data: updated, error: updErr } = await client
    .from('profiles')
    .upsert(
      { user_id: userId, settings: mergedSettings as Json },
      { onConflict: 'user_id' },
    )
    .select('settings')
    .single();
  if (updErr || !updated) {
    throw new Error(`updatePreferences write failed: ${updErr?.message ?? 'no row returned'}`);
  }
  return preferencesFromSettings(updated.settings as Json | null | undefined);
}

/**
 * Decide whether a kind is enabled for a user.
 * - `disabled_kinds` always wins.
 * - `enabled_kinds` empty = all enabled (the default).
 */
export function isKindEnabled(
  prefs: NotificationPreferences,
  kind: string,
): boolean {
  if (prefs.disabled_kinds.includes(kind)) return false;
  if (prefs.enabled_kinds.length === 0) return true;
  return prefs.enabled_kinds.includes(kind);
}

/**
 * Decide whether a channel is enabled for a user.
 */
export function isChannelEnabled(
  prefs: NotificationPreferences,
  channel: 'in_app' | 'email' | 'push',
): boolean {
  if (channel === 'in_app') return prefs.in_app_enabled;
  if (channel === 'email') return prefs.email_enabled;
  return prefs.push_enabled;
}

/**
 * Decide whether the given wall-clock instant is within the user's
 * quiet-hours window. `now` is interpreted in the user's timezone.
 *
 * The window is inclusive of `start` and exclusive of `end`. If the
 * window crosses midnight (e.g. 22:00 → 08:00), any time after start
 * OR before end is in quiet hours.
 *
 * If the inputs are invalid (bad timezone, malformed HH:MM, or
 * `quiet_hours.enabled === false`), the function returns false
 * (fail-open — better to notify than to silently drop).
 */
export function isInQuietHours(
  prefs: NotificationPreferences,
  timezone: string,
  now: Date,
): boolean {
  if (!prefs.quiet_hours.enabled) return false;
  const { start, end } = prefs.quiet_hours;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
    return false;
  }
  // Convert "now" to the user's timezone. We use Intl.DateTimeFormat
  // because it is the only platform primitive available without a
  // library dependency; the formatter is well-defined for IANA tz.
  let hhmm: string | null = null;
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || 'UTC',
    });
    hhmm = fmt.format(now);
  } catch {
    return false; // invalid timezone — fail-open
  }
  if (!hhmm) return false;
  // Normalize: Intl may return "24:00" in some locales; treat as "00:00".
  if (hhmm.startsWith('24:')) hhmm = '00:' + hhmm.slice(3);
  if (start === end) return false; // zero-length window
  if (start < end) {
    return hhmm >= start && hhmm < end;
  }
  // Crosses midnight: 22:00 → 08:00 means in quiet hours if hhmm >= 22:00 OR hhmm < 08:00
  return hhmm >= start || hhmm < end;
}
