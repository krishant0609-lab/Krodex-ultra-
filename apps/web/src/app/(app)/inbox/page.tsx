'use client';
import React from 'react';
import { Surface } from '../../../components/surface';
import { Badge } from '../../../components/badge';
import styles from './inbox.module.css';

const MESSAGES = [
  { id: 'MSG-103', from: 'Scheduler', subject: '3 reviews due today', time: '09:00', read: false, type: 'review' },
  { id: 'MSG-102', from: 'Error Bus', subject: 'New conceptual gap: Quantum Tunneling', time: 'Yesterday', read: true, type: 'gap' },
  { id: 'MSG-101', from: 'Analytics', subject: 'Weekly insight report ready', time: '2d ago', read: true, type: 'report' },
  { id: 'MSG-100', from: 'Scheduler', subject: 'Lenz\'s Law review overdue by 4h', time: '3d ago', read: true, type: 'review' },
];

export default function InboxPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Inbox</h1>
        <p className={styles.subtitle}>Notifications from the event bus — scheduler, error bus, and analytics</p>
      </div>
      <div className={styles.messages}>
        {MESSAGES.map((m) => (
          <Surface
            key={m.id}
            variant={m.read ? 'ink' : 'glass'}
            className={styles.message}
            padding="md"
          >
            <div className={styles.messageHead}>
              <div className={styles.messageMeta}>
                <span className={styles.messageFrom}>{m.from}</span>
                <Badge
                  variant={
                    m.type === 'review' ? 'crimson' :
                    m.type === 'gap' ? 'amber' : 'sapphire'
                  }
                >
                  {m.type}
                </Badge>
              </div>
              <span className={styles.messageTime}>{m.time}</span>
            </div>
            <p className={styles.messageSubject}>{m.subject}</p>
          </Surface>
        ))}
      </div>
    </div>
  );
}
