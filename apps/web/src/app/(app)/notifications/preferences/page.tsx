'use client';

/**
 * KRODEX web — Notification preferences.
 *
 *   /notifications/preferences
 *
 * Phase 12 visual layer:
 *  - Eyebrow "Inbox", title "Notification preferences", and
 *    a calm description that names the read/write nature
 *    (these are your own notification preferences — the
 *    system respects them before notifying you).
 *  - Three editorial cards:
 *      1. Quiet hours — toggle + start/end times
 *      2. Per-kind opt-outs — disable specific notification
 *         kinds from the inbox taxonomy
 *      3. Channels — in_app, email, push toggles
 *  - Save button submits a PATCH that merges the patch into
 *    the existing settings (server-side).
 *  - 7-state contract honored: loading, error, populated.
 *    There is no empty state — preferences always have a
 *    row to update.
 *
 * Hooks used (no new server state):
 *  - useNotificationPreferences()
 *  - useUpdateNotificationPreferences()
 *
 * No new server routes — the API is shared with the api app.
 */

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PageShell } from '../../../../components/page-shell';
import { ApiError } from '../../../../lib/api-client';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../../../../hooks/use-notification-preferences';
import styles from './preferences.module.css';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface KindDescriptor {
  id: string;
  title: string;
  description: string;
}

const NOTIFICATION_KINDS: readonly KindDescriptor[] = [
  { id: 'error_recorded', title: 'Error recorded', description: 'A new error was added to your error book.' },
  { id: 'error_reopened', title: 'Error reopened', description: 'A previously resolved error came back.' },
  { id: 'attempt_analyzed', title: 'Attempt analyzed', description: 'A test attempt finished with at least one wrong answer.' },
  { id: 'review_due', title: 'Review due', description: 'A scheduled review is approaching its due time.' },
  { id: 'review_overdue', title: 'Review overdue', description: 'A scheduled review is past its due time.' },
  { id: 'review_outcome_recorded', title: 'Review outcome', description: 'A review session finished with a recorded outcome.' },
  { id: 'task_missed', title: 'Task missed', description: 'A planner task missed its due date.' },
  { id: 'task_completed', title: 'Task completed', description: 'A planner task was completed.' },
  { id: 'task_upcoming', title: 'Task upcoming', description: 'A planner task is approaching in the next few hours.' },
  { id: 'backlog_recovery', title: 'Backlog recovery', description: 'A missed task was moved to the recovery backlog.' },
];

export default function NotificationPreferencesPage(): JSX.Element {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  // quiet hours
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');

  // per-kind opt-outs (disabled_kinds); empty enabled_kinds = all
  const [disabledKinds, setDisabledKinds] = useState<readonly string[]>([]);

  // channels
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(false);
  const [push, setPush] = useState(false);

  useEffect(() => {
    if (prefs.data) {
      setQuietEnabled(prefs.data.quiet_hours.enabled);
      setQuietStart(prefs.data.quiet_hours.start);
      setQuietEnd(prefs.data.quiet_hours.end);
      setDisabledKinds([...prefs.data.disabled_kinds]);
      setInApp(prefs.data.in_app_enabled);
      setEmail(prefs.data.email_enabled);
      setPush(prefs.data.push_enabled);
    }
  }, [prefs.data]);

  const toggleKind = (id: string): void => {
    setDisabledKinds((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
    );
  };

  const isValid = TIME_RE.test(quietStart) && TIME_RE.test(quietEnd);

  const onSave = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!isValid) return;
    // Swallow the rejection: the mutation's `error` state is the
    // source of truth for the errorMeta strip; the form handler
    // should never propagate the rejection to React's event loop.
    try {
      await update.mutateAsync({
        quiet_hours: {
          enabled: quietEnabled,
          start: quietStart,
          end: quietEnd,
        },
        disabled_kinds: disabledKinds,
        in_app_enabled: inApp,
        email_enabled: email,
        push_enabled: push,
      });
    } catch {
      // The error is already surfaced via update.error; nothing to do.
    }
  };

  return (
    <PageShell
      title="Notification preferences"
      eyebrow="Inbox"
      description="Control when and how the system notifies you. Preferences are evaluated before each notification is created."
      isLoading={prefs.isLoading}
      isError={prefs.isError}
      error={prefs.error}
      actions={
        <Link
          href="/notifications"
          className={styles.primaryAction}
          data-testid="notification-prefs-back"
          style={{ textDecoration: 'none' }}
        >
          Back to inbox
        </Link>
      }
    >
      <form
        onSubmit={onSave}
        data-testid="notification-prefs-form"
        className={styles.form}
      >
        <section className={styles.card} aria-label="Quiet hours">
          <header className={styles.cardHeader}>
            <p className={styles.cardEyebrow}>Quiet hours</p>
            <h2 className={styles.cardHeading}>When to stay quiet</h2>
            <p className={styles.cardDescription}>
              During quiet hours, non-critical notifications are suppressed.
              Times are evaluated in your account timezone.
            </p>
          </header>
          <div className={styles.toggleRow}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={quietEnabled}
                onChange={(e) => setQuietEnabled(e.target.checked)}
                data-testid="notification-prefs-quiet-enabled"
              />
              <span>Enable quiet hours</span>
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Start (HH:MM)</span>
              <input
                type="text"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className={styles.input}
                placeholder="22:00"
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                data-testid="notification-prefs-quiet-start"
                disabled={!quietEnabled}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>End (HH:MM)</span>
              <input
                type="text"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className={styles.input}
                placeholder="08:00"
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                data-testid="notification-prefs-quiet-end"
                disabled={!quietEnabled}
              />
            </label>
          </div>
          {!isValid ? (
            <p className={styles.errorMeta} role="alert" data-testid="notification-prefs-time-error">
              Times must be in HH:MM (24h) format.
            </p>
          ) : null}
        </section>

        <section className={styles.card} aria-label="Notification kinds">
          <header className={styles.cardHeader}>
            <p className={styles.cardEyebrow}>Kinds</p>
            <h2 className={styles.cardHeading}>Disable specific kinds</h2>
            <p className={styles.cardDescription}>
              Disabled kinds are never created, regardless of channel toggles.
              Leave a kind on to receive it through the channels you enable below.
            </p>
          </header>
          <div className={styles.kindGrid}>
            {NOTIFICATION_KINDS.map((kind) => {
              const disabled = disabledKinds.includes(kind.id);
              return (
                <div key={kind.id} className={styles.kindItem} data-kind={kind.id}>
                  <div className={styles.kindHeader}>
                    <span className={styles.kindTitle}>{kind.title}</span>
                    <label className={styles.toggleLabel}>
                      <input
                        type="checkbox"
                        checked={disabled}
                        onChange={() => toggleKind(kind.id)}
                        data-testid={`notification-prefs-kind-${kind.id}`}
                        aria-label={`Disable ${kind.title}`}
                      />
                      <span>Off</span>
                    </label>
                  </div>
                  <p className={styles.kindDesc}>{kind.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.card} aria-label="Channels">
          <header className={styles.cardHeader}>
            <p className={styles.cardEyebrow}>Channels</p>
            <h2 className={styles.cardHeading}>How to notify you</h2>
            <p className={styles.cardDescription}>
              In-app notifications appear in your inbox immediately. Email and
              push are scaffolded for a future release — the in-app channel
              remains the source of truth.
            </p>
          </header>
          <div className={styles.toggleRow}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={inApp}
                onChange={(e) => setInApp(e.target.checked)}
                data-testid="notification-prefs-channel-in-app"
              />
              <span>In-app</span>
            </label>
            <p className={styles.toggleHelp}>Always delivered to the inbox.</p>
          </div>
          <div className={styles.toggleRow}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={email}
                onChange={(e) => setEmail(e.target.checked)}
                data-testid="notification-prefs-channel-email"
              />
              <span>Email</span>
            </label>
            <p className={styles.toggleHelp}>Scaffold only — delivery infrastructure arrives in a later release.</p>
          </div>
          <div className={styles.toggleRow}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={push}
                onChange={(e) => setPush(e.target.checked)}
                data-testid="notification-prefs-channel-push"
              />
              <span>Push</span>
            </label>
            <p className={styles.toggleHelp}>Scaffold only — delivery infrastructure arrives in a later release.</p>
          </div>
        </section>

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.primaryAction}
            disabled={update.isPending || !isValid}
            data-testid="notification-prefs-save"
          >
            {update.isPending ? 'Saving…' : 'Save preferences'}
          </button>
          {update.isError ? (
            <p
              className={styles.errorMeta}
              role="alert"
              data-testid="notification-prefs-error"
            >
              {update.error instanceof ApiError
                ? `${update.error.code} (${update.error.status})`
                : 'Save failed.'}
            </p>
          ) : null}
          {update.isSuccess ? (
            <p
              className={styles.successMeta}
              role="status"
              data-testid="notification-prefs-success"
            >
              Saved.
            </p>
          ) : null}
        </div>
      </form>
    </PageShell>
  );
}
