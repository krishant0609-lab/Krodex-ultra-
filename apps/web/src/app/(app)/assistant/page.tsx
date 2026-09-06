'use client';
import React, { useState } from 'react';
import { Surface } from '../../../components/surface';
import styles from './assistant.module.css';

const CHATS = [
  { id: 'ch-01', preview: 'Explain the physical intuition behind Lenz\'s Law', time: '2h ago' },
  { id: 'ch-02', preview: 'Walk me through Gauss\'s Theorem for spherical symmetry', time: 'Yesterday' },
  { id: 'ch-03', preview: 'How does capacitance change with dielectric insertion?', time: '3d ago' },
];

export default function AssistantPage() {
  const [input, setInput] = useState('');
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Assistant</h1>
        <p className={styles.subtitle}>Adaptive AI tutor grounded in your personal error history</p>
      </div>
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <p className={styles.sidebarLabel}>Recent Chats</p>
          {CHATS.map((c) => (
            <button key={c.id} className={styles.chatItem}>
              <span className={styles.chatPreview}>{c.preview}</span>
              <span className={styles.chatTime}>{c.time}</span>
            </button>
          ))}
        </div>
        <Surface variant="ink" padding="lg" className={styles.chatArea}>
          <div className={styles.empty}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 13h12M10 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className={styles.emptyText}>Ask anything about your syllabus, errors, or concepts you are studying</p>
          </div>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              placeholder="Ask the assistant..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button className={styles.sendBtn} disabled={!input.trim()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 2L7 9M14 2L9 14L7 9M14 2L2 7L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </Surface>
      </div>
    </div>
  );
}
