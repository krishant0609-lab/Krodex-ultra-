'use client';
import React from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '24px',
        fontFamily: 'var(--kd-font-ui)',
        color: 'var(--kd-text-primary)',
        background: 'var(--kd-ink-1)',
        padding: '40px',
        textAlign: 'center',
      }}
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="22" stroke="var(--kd-crimson)" strokeWidth="1.5" />
        <path d="M24 14v12M24 32v2" stroke="var(--kd-crimson)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div>
        <h1 style={{ fontFamily: 'var(--kd-font-display)', fontSize: '22px', fontWeight: 500, margin: '0 0 8px', color: 'var(--kd-text-primary)' }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--kd-text-muted)', margin: 0 }}>
          {error?.message ?? 'An unexpected error occurred'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={reset}
          style={{
            padding: '10px 20px',
            background: 'var(--kd-sapphire)',
            border: 'none',
            borderRadius: 'var(--kd-radius-md)',
            color: 'white',
            fontFamily: 'var(--kd-font-ui)',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <a
          href="/login"
          style={{
            padding: '10px 20px',
            background: 'none',
            border: '1px solid var(--kd-ink-4)',
            borderRadius: 'var(--kd-radius-md)',
            color: 'var(--kd-text-secondary)',
            fontFamily: 'var(--kd-font-ui)',
            fontSize: '14px',
            textDecoration: 'none',
          }}
        >
          Back to login
        </a>
      </div>
    </div>
  );
}
