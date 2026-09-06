'use client';
import React, { useState } from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './settings.module.css';

export default function SettingsPage() {
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark');
  const [notifications, setNotifications] = useState(true);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Application preferences, account, and system configuration</p>
      </div>
      <div className={styles.sections}>
        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.field}>
            <div className={styles.fieldMeta}>
              <span className={styles.fieldLabel}>Theme</span>
              <span className={styles.fieldDesc}>Color scheme for the interface</span>
            </div>
            <div className={styles.toggleGroup}>
              {(['dark', 'light', 'system'] as const).map((t) => (
                <button
                  key={t}
                  className={`${styles.toggle} ${theme === t ? styles.toggleActive : ''}`}
                  onClick={() => setTheme(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </Surface>

        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <div className={styles.field}>
            <div className={styles.fieldMeta}>
              <span className={styles.fieldLabel}>Event Bus Alerts</span>
              <span className={styles.fieldDesc}>Receive inbox notifications from scheduler and error bus</span>
            </div>
            <button
              className={`${styles.switch} ${notifications ? styles.switchOn : ''}`}
              onClick={() => setNotifications(!notifications)}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
        </Surface>

        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <div className={styles.accountInfo}>
            <div className={styles.avatar}>
              <span className={styles.avatarInitial}>K</span>
            </div>
            <div>
              <p className={styles.accountName}>krodex-dev@proton.me</p>
              <p className={styles.accountMeta}>Supabase Auth · Member since Sep 2026</p>
            </div>
          </div>
          <div className={styles.actions}>
            <button className={styles.dangerBtn}>Sign Out</button>
          </div>
        </Surface>
      </div>
    </div>
  );
}
