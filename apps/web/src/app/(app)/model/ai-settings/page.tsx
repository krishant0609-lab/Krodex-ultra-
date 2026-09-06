'use client';
import React, { useState } from 'react';
import { Surface } from '../../../../components/surface';
import { Badge } from '../../../../components/badge';
import styles from './ai-settings.module.css';

export default function AISettingsPage() {
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [systemPrompt, setSystemPrompt] = useState(
    'You are an adaptive physics tutor. You have access to the student\'s error history and syllabus state. Prioritize conceptual intuition over formula memorization. When a student makes an error, explain the underlying misconception first, then the correct approach.'
  );
  const [model, setModel] = useState('gpt-4o-mini');

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>AI Settings</h1>
        <p className={styles.subtitle}>Configure the adaptive tutor model, generation parameters, and system prompt</p>
      </div>
      <div className={styles.sections}>
        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>Model</h2>
          <div className={styles.modelPicker}>
            {[
              { id: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: 'Fast, cost-efficient reasoning' },
              { id: 'gpt-4o', label: 'GPT-4o', desc: 'Full reasoning and depth' },
              { id: 'claude-sonnet', label: 'Claude Sonnet', desc: 'Balanced performance' },
            ].map((m) => (
              <button
                key={m.id}
                className={`${styles.modelOption} ${model === m.id ? styles.modelSelected : ''}`}
                onClick={() => setModel(m.id)}
              >
                <div className={styles.modelRadio}>
                  {model === m.id && <span className={styles.modelRadioDot} />}
                </div>
                <div>
                  <p className={styles.modelName}>{m.label}</p>
                  <p className={styles.modelDesc}>{m.desc}</p>
                </div>
                {model === m.id && <Badge variant="sapphire" dot>Active</Badge>}
              </button>
            ))}
          </div>
        </Surface>

        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>Generation Parameters</h2>
          <div className={styles.fields}>
            <div className={styles.field}>
              <div className={styles.fieldMeta}>
                <span className={styles.fieldLabel}>Temperature</span>
                <span className={styles.fieldValue}>{temperature.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className={styles.slider}
              />
              <p className={styles.fieldDesc}>Higher = more creative, lower = more deterministic</p>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldMeta}>
                <span className={styles.fieldLabel}>Max Tokens</span>
                <span className={styles.fieldValue}>{maxTokens.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min="512"
                max="8192"
                step="256"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className={styles.slider}
              />
              <p className={styles.fieldDesc}>Maximum response length per turn</p>
            </div>
          </div>
        </Surface>

        <Surface variant="ink" padding="lg" className={styles.section}>
          <h2 className={styles.sectionTitle}>System Prompt</h2>
          <textarea
            className={styles.textarea}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
          />
          <p className={styles.charCount}>{systemPrompt.length} / 4000 characters</p>
        </Surface>

        <div className={styles.actions}>
          <button className={styles.saveBtn}>Save AI Settings</button>
        </div>
      </div>
    </div>
  );
}
