/**
 * KRODEX — NotificationPreferencesService unit tests.
 */

import { describe, expect, it } from 'vitest';
import { makeFakeSupabase } from '../../test-utils/fake-supabase';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getPreferences,
  isChannelEnabled,
  isInQuietHours,
  isKindEnabled,
  preferencesFromSettings,
  updatePreferences,
} from '../notification-preferences-service';

const USER_A = '00000000-0000-0000-0000-00000000000a';

describe('preferencesFromSettings', () => {
  it('returns defaults when settings is null', () => {
    const out = preferencesFromSettings(null);
    expect(out).toMatchObject({
      quiet_hours: { enabled: false, start: '22:00', end: '08:00' },
      enabled_kinds: [],
      disabled_kinds: [],
      in_app_enabled: true,
      email_enabled: false,
      push_enabled: false,
    });
  });

  it('returns defaults when the notification_preferences key is missing', () => {
    const out = preferencesFromSettings({ theme: 'dark' });
    expect(out.quiet_hours.enabled).toBe(false);
    expect(out.in_app_enabled).toBe(true);
  });

  it('merges a stored blob over defaults', () => {
    const out = preferencesFromSettings({
      notification_preferences: {
        quiet_hours: { enabled: true, start: '21:00', end: '07:30' },
        disabled_kinds: ['review_due'],
        in_app_enabled: false,
      },
    });
    expect(out.quiet_hours).toEqual({ enabled: true, start: '21:00', end: '07:30' });
    expect(out.disabled_kinds).toEqual(['review_due']);
    expect(out.in_app_enabled).toBe(false);
    // email/push stay at defaults
    expect(out.email_enabled).toBe(false);
  });
});

describe('getPreferences', () => {
  it('returns defaults when no profile row exists (fail-open)', async () => {
    const client = makeFakeSupabase({ tables: { profiles: [] } });
    const out = await getPreferences(client, USER_A);
    expect(out).toMatchObject(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('returns defaults when the DB read errors (fail-open)', async () => {
    const client = makeFakeSupabase({ tables: { profiles: [] }, errorOn: 'db down' });
    const out = await getPreferences(client, USER_A);
    expect(out).toMatchObject(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('returns the persisted blob when present', async () => {
    const client = makeFakeSupabase({
      tables: {
        profiles: [
          {
            id: 'p1',
            user_id: USER_A,
            settings: { notification_preferences: { disabled_kinds: ['task_missed'] } },
          },
        ],
      },
    });
    const out = await getPreferences(client, USER_A);
    expect(out.disabled_kinds).toEqual(['task_missed']);
    // quiet_hours falls back to defaults
    expect(out.quiet_hours.enabled).toBe(false);
  });
});

describe('updatePreferences', () => {
  it('merges the patch into the existing settings without dropping other keys', async () => {
    const client = makeFakeSupabase({
      tables: {
        profiles: [
          {
            id: 'p1',
            user_id: USER_A,
            settings: { theme: 'dark', notification_preferences: { disabled_kinds: ['old'] } },
          },
        ],
      },
    });
    const out = await updatePreferences(client, USER_A, { disabled_kinds: ['review_due'] });
    expect(out.disabled_kinds).toEqual(['review_due']);
    expect(out.created_at).toBeDefined();
    expect(out.updated_at).toBeDefined();
    // `theme` was preserved in the same JSON blob
    const rows = (client as unknown as { __rows: (t: string) => unknown[] }).__rows('profiles');
    const settings = (rows[0] as { settings: { theme?: string; notification_preferences?: unknown } }).settings;
    expect(settings.theme).toBe('dark');
    expect(settings.notification_preferences).toBeDefined();
  });

  it('creates a new profile-shaped settings blob when none exists', async () => {
    const client = makeFakeSupabase({ tables: { profiles: [] } });
    const out = await updatePreferences(client, USER_A, { in_app_enabled: false });
    expect(out.in_app_enabled).toBe(false);
    // First save records created_at and updated_at
    expect(out.created_at).toBeDefined();
    expect(out.updated_at).toBeDefined();
  });

  it('preserves created_at on subsequent updates and bumps updated_at', async () => {
    const earlier = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const client = makeFakeSupabase({
      tables: {
        profiles: [
          {
            id: 'p1',
            user_id: USER_A,
            settings: { notification_preferences: { created_at: earlier, updated_at: earlier, disabled_kinds: ['a'] } },
          },
        ],
      },
    });
    const out = await updatePreferences(client, USER_A, { disabled_kinds: ['b'] });
    expect(out.created_at).toBe(earlier);
    expect(out.updated_at).not.toBe(earlier);
    expect(out.disabled_kinds).toEqual(['b']);
  });
});

describe('isKindEnabled', () => {
  it('treats disabled_kinds as authoritative', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled_kinds: ['review_due'], disabled_kinds: ['review_due'] };
    expect(isKindEnabled(prefs, 'review_due')).toBe(false);
  });

  it('allows a kind when enabled_kinds is empty (default = all enabled)', () => {
    expect(isKindEnabled({ ...DEFAULT_NOTIFICATION_PREFERENCES }, 'review_due')).toBe(true);
  });

  it('restricts to enabled_kinds when non-empty', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled_kinds: ['task_missed'] };
    expect(isKindEnabled(prefs, 'task_missed')).toBe(true);
    expect(isKindEnabled(prefs, 'review_due')).toBe(false);
  });
});

describe('isChannelEnabled', () => {
  it('maps channels to their respective booleans', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, in_app_enabled: true, email_enabled: false, push_enabled: false };
    expect(isChannelEnabled(prefs, 'in_app')).toBe(true);
    expect(isChannelEnabled(prefs, 'email')).toBe(false);
    expect(isChannelEnabled(prefs, 'push')).toBe(false);
  });
});

describe('isInQuietHours', () => {
  it('returns false when quiet hours are disabled', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, quiet_hours: { enabled: false, start: '22:00', end: '08:00' } };
    const midnight = new Date('2026-09-04T19:00:00.000Z'); // 00:30 IST
    expect(isInQuietHours(prefs, 'Asia/Kolkata', midnight)).toBe(false);
  });

  it('detects time within a same-day window (e.g. 09:00–17:00)', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, quiet_hours: { enabled: true, start: '09:00', end: '17:00' } };
    // 10:00 UTC, 15:30 IST — inside
    const inside = new Date('2026-09-04T10:00:00.000Z');
    expect(isInQuietHours(prefs, 'Asia/Kolkata', inside)).toBe(true);
    // 04:00 UTC, 09:30 IST — inside (window is 09:00–17:00)
    const alsoInside = new Date('2026-09-04T04:00:00.000Z');
    expect(isInQuietHours(prefs, 'Asia/Kolkata', alsoInside)).toBe(true);
    // 02:00 UTC, 07:30 IST — outside
    const outside = new Date('2026-09-04T02:00:00.000Z');
    expect(isInQuietHours(prefs, 'Asia/Kolkata', outside)).toBe(false);
  });

  it('handles cross-midnight windows (e.g. 22:00 → 08:00)', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, quiet_hours: { enabled: true, start: '22:00', end: '08:00' } };
    // 2026-09-04 23:30 IST = 18:00 UTC — inside (after 22:00)
    const lateNight = new Date('2026-09-04T18:00:00.000Z');
    expect(isInQuietHours(prefs, 'Asia/Kolkata', lateNight)).toBe(true);
    // 2026-09-04 03:00 IST = 21:30 UTC previous day — inside (before 08:00)
    const earlyMorning = new Date('2026-09-03T21:30:00.000Z');
    expect(isInQuietHours(prefs, 'Asia/Kolkata', earlyMorning)).toBe(true);
    // 2026-09-04 12:00 IST = 06:30 UTC — outside
    const noon = new Date('2026-09-04T06:30:00.000Z');
    expect(isInQuietHours(prefs, 'Asia/Kolkata', noon)).toBe(false);
  });

  it('returns false (fail-open) on bad time strings', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, quiet_hours: { enabled: true, start: 'bad', end: 'worse' } };
    expect(isInQuietHours(prefs, 'UTC', new Date())).toBe(false);
  });

  it('returns false (fail-open) on bad timezones', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, quiet_hours: { enabled: true, start: '22:00', end: '08:00' } };
    expect(isInQuietHours(prefs, 'Not/AReal_Zone', new Date())).toBe(false);
  });

  it('treats start===end as no window', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, quiet_hours: { enabled: true, start: '12:00', end: '12:00' } };
    expect(isInQuietHours(prefs, 'UTC', new Date('2026-09-04T12:00:00.000Z'))).toBe(false);
  });
});
