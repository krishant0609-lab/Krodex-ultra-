'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Sidebar } from '../../components/sidebar';
import styles from './app-shell-client.module.css';

interface TopBarProps {
  title?: string;
  breadcrumb?: { label: string; href?: string }[];
  action?: React.ReactNode;
}

function TopBar({ title, breadcrumb, action }: TopBarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarLeft}>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={crumb.label}>
                {i > 0 && <span className={styles.breadcrumbSep}>/</span>}
                {crumb.href ? (
                  <a href={crumb.href} className={styles.breadcrumbLink}>{crumb.label}</a>
                ) : (
                  <span className={styles.breadcrumbCurrent}>{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        {title && <h1 className={styles.pageTitle}>{title}</h1>}
      </div>
      {action && <div className={styles.topbarRight}>{action}</div>}
    </header>
  );
}

interface AppShellClientProps {
  title?: string;
  breadcrumb?: { label: string; href?: string }[];
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShellClient({ title, breadcrumb, action, children }: AppShellClientProps) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar title={title} breadcrumb={breadcrumb} action={action} />
        <motion.main
          className={styles.content}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
