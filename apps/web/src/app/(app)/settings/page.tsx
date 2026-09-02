'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { PageShell } from '../../../components/page-shell';
import {
  useCurrentUser,
  useCurrentUserProfile,
  useUpdateCurrentUser,
  useUpdateCurrentUserProfile,
} from '../../../hooks/use-users';

export default function SettingsPage(): JSX.Element {
  const user = useCurrentUser();
  const profile = useCurrentUserProfile();
  const updateUser = useUpdateCurrentUser();
  const updateProfile = useUpdateCurrentUserProfile();

  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [grade, setGrade] = useState('');
  const [examTarget, setExamTarget] = useState('');

  useEffect(() => {
    if (user.data) {
      setDisplayName(user.data.display_name ?? '');
      setTimezone(user.data.timezone ?? '');
    }
  }, [user.data]);

  useEffect(() => {
    if (profile.data) {
      setGrade(profile.data.grade ?? '');
      setExamTarget(profile.data.exam_target ?? '');
    }
  }, [profile.data]);

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
      exam_target: examTarget || null,
    });
  };

  return (
    <PageShell
      title="Settings"
      description="Your account and preferences."
      isLoading={user.isLoading || profile.isLoading}
      isError={user.isError || profile.isError}
      error={user.error ?? profile.error}
    >
      <section>
        <h2 style={{ fontSize: '1.125rem', margin: '0 0 0.5rem' }}>User</h2>
        <form
          onSubmit={onSaveUser}
          data-testid="settings-user-form"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '24rem' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.875rem' }}>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.875rem' }}>Timezone (IANA)</span>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC"
              style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
            />
          </label>
          <button
            type="submit"
            disabled={updateUser.isPending}
            data-testid="settings-user-save"
            style={{
              padding: '0.4rem 0.75rem',
              border: '1px solid #111',
              background: '#111',
              color: '#fff',
              borderRadius: '0.25rem',
              alignSelf: 'flex-start',
            }}
          >
            {updateUser.isPending ? 'Saving…' : 'Save user'}
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: '1.125rem', margin: '1rem 0 0.5rem' }}>Profile</h2>
        <form
          onSubmit={onSaveProfile}
          data-testid="settings-profile-form"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '24rem' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.875rem' }}>Grade</span>
            <input
              type="text"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.875rem' }}>Exam target</span>
            <input
              type="text"
              value={examTarget}
              onChange={(e) => setExamTarget(e.target.value)}
              style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
            />
          </label>
          <button
            type="submit"
            disabled={updateProfile.isPending}
            data-testid="settings-profile-save"
            style={{
              padding: '0.4rem 0.75rem',
              border: '1px solid #111',
              background: '#111',
              color: '#fff',
              borderRadius: '0.25rem',
              alignSelf: 'flex-start',
            }}
          >
            {updateProfile.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>
    </PageShell>
  );
}
