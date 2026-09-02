'use client';

/**
 * KRODEX web — Settings (index).
 *
 *   /settings
 *
 * Phase 7.10 visual layer:
 *  - Eyebrow "Profile", title "Settings", and a calm
 *    description that names the read/write nature (these
 *    are your own user + profile rows).
 *  - Two editorial sections:
 *      1. Account — display name and timezone (PATCH
 *         /users/me).
 *      2. Profile — grade, board, exam target, study
 *         goal (PATCH /users/me/profile).
 *  - The fields are populated from the API and edits are
 *    submitted via the existing PATCH hooks. Save buttons
 *    are disabled while a request is in flight.
 *  - 7-state contract honored: loading, error, populated.
 *    There is no empty state — settings always have a
 *    row to update, even if the values are empty.
 *
 * Hooks used (no new server state):
 *  - useCurrentUser()
 *  - useUpdateCurrentUser()
 *  - useCurrentUserProfile()
 *  - useUpdateCurrentUserProfile()
 *
 * No new fields. The form mirrors the columns on
 * `public.users` and `public.profiles`.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { PageShell } from '../../../components/page-shell';
import { ApiError } from '../../../lib/api-client';
import {
  useCurrentUser,
  useCurrentUserProfile,
  useUpdateCurrentUser,
  useUpdateCurrentUserProfile,
} from '../../../hooks/use-users';
import styles from './settings.module.css';

export default function SettingsPage(): JSX.Element {
  const user = useCurrentUser();
  const profile = useCurrentUserProfile();
  const updateUser = useUpdateCurrentUser();
  const updateProfile = useUpdateCurrentUserProfile();

  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [grade, setGrade] = useState('');
  const [board, setBoard] = useState('');
  const [examTarget, setExamTarget] = useState('');
  const [studyGoal, setStudyGoal] = useState('');

  useEffect(() => {
    if (user.data) {
      setDisplayName(user.data.display_name ?? '');
      setTimezone(user.data.timezone ?? '');
    }
  }, [user.data]);

  useEffect(() => {
    if (profile.data) {
      setGrade(profile.data.grade ?? '');
      setBoard(profile.data.board ?? '');
      setExamTarget(profile.data.exam_target ?? '');
      setStudyGoal(profile.data.study_goal ?? '');
    }
  }, [profile.data]);

  const isLoading = user.isLoading || profile.isLoading;
  const isError = user.isError || profile.isError;
  const error = user.error ?? profile.error;

  const onSaveUser = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    await updateUser.mutateAsync({
      display_name: displayName,
      timezone,
    });
  };

  const onSaveProfile = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    await updateProfile.mutateAsync({
      grade: grade || null,
      board: board || null,
      exam_target: examTarget || null,
      study_goal: studyGoal || null,
    });
  };

  return (
    <PageShell
      title="Settings"
      eyebrow="Profile"
      description="Your account and study profile. Edits are saved to the user and profile rows you already own."
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <div className={styles.formGrid}>
        <section className={styles.card} aria-label="Account">
          <header className={styles.cardHeader}>
            <p className={styles.cardEyebrow}>Account</p>
            <h2 className={styles.cardHeading}>Display name & timezone</h2>
            <p className={styles.cardDescription}>
              How you appear across the app and the timezone the planner uses.
            </p>
          </header>
          <form
            onSubmit={onSaveUser}
            data-testid="settings-user-form"
            className={styles.form}
          >
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={styles.input}
                data-testid="settings-display-name"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Timezone (IANA)</span>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="UTC"
                className={styles.input}
                data-testid="settings-timezone"
              />
            </label>
            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.primaryAction}
                disabled={updateUser.isPending}
                data-testid="settings-user-save"
              >
                {updateUser.isPending ? 'Saving…' : 'Save account'}
              </button>
              {updateUser.isError ? (
                <p
                  className={styles.errorMeta}
                  role="alert"
                  data-testid="settings-user-error"
                >
                  {updateUser.error instanceof ApiError
                    ? `${updateUser.error.code} (${updateUser.error.status})`
                    : 'Save failed.'}
                </p>
              ) : null}
              {updateUser.isSuccess ? (
                <p
                  className={styles.successMeta}
                  role="status"
                  data-testid="settings-user-success"
                >
                  Saved.
                </p>
              ) : null}
            </div>
          </form>
        </section>

        <section className={styles.card} aria-label="Profile">
          <header className={styles.cardHeader}>
            <p className={styles.cardEyebrow}>Profile</p>
            <h2 className={styles.cardHeading}>Study context</h2>
            <p className={styles.cardDescription}>
              Used by the planner and the student model. Leave blank if not
              relevant.
            </p>
          </header>
          <form
            onSubmit={onSaveProfile}
            data-testid="settings-profile-form"
            className={styles.form}
          >
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Grade</span>
              <input
                type="text"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className={styles.input}
                data-testid="settings-grade"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Board</span>
              <input
                type="text"
                value={board}
                onChange={(e) => setBoard(e.target.value)}
                className={styles.input}
                data-testid="settings-board"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Exam target</span>
              <input
                type="text"
                value={examTarget}
                onChange={(e) => setExamTarget(e.target.value)}
                className={styles.input}
                data-testid="settings-exam-target"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Study goal</span>
              <input
                type="text"
                value={studyGoal}
                onChange={(e) => setStudyGoal(e.target.value)}
                className={styles.input}
                data-testid="settings-study-goal"
              />
            </label>
            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.primaryAction}
                disabled={updateProfile.isPending}
                data-testid="settings-profile-save"
              >
                {updateProfile.isPending ? 'Saving…' : 'Save profile'}
              </button>
              {updateProfile.isError ? (
                <p
                  className={styles.errorMeta}
                  role="alert"
                  data-testid="settings-profile-error"
                >
                  {updateProfile.error instanceof ApiError
                    ? `${updateProfile.error.code} (${updateProfile.error.status})`
                    : 'Save failed.'}
                </p>
              ) : null}
              {updateProfile.isSuccess ? (
                <p
                  className={styles.successMeta}
                  role="status"
                  data-testid="settings-profile-success"
                >
                  Saved.
                </p>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </PageShell>
  );
}
