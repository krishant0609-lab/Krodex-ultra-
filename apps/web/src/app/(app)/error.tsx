'use client';
import React from 'react';

export default function AppErrorPage({
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
        minHeight: '60vh',
        gap: '24px',
        fontFamily: 'var(--kd-font-ui)',
        color: 'var(--kd-text-primary)',
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
          Page error
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--kd-text-muted)', margin: 0 }}>
          {error?.message ?? 'An unexpected error occurred in the app'}
        </p>
      </div>
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
    </div>
  );
}
