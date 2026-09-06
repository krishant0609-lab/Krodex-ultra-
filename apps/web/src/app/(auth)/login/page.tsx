'use client';

/**
 * KRODEX web — sign in / sign up (4-stage lamp theme).
 *
 * The 4 lamp stages (each is a meaningful state in the
 * authentication journey):
 *
 *   0. alone       — the page is just opened. The lamp is off.
 *                    The form card is dimly visible but inactive.
 *   1. interaction — the user has focused an input. The lamp
 *                    flickers on briefly. Form card is now interactive.
 *   2. illumination— both email and password fields have content.
 *                    The lamp is fully on, the face is awake.
 *   3. sign-in/up  — the user has pulled the string or pressed
 *                    enter. The lamp glow intensifies and the
 *                    form card is fully revealed.
 *
 * The lamp is the input. The form is the reward.
 */

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useEmailSignIn,
  useEmailSignUp,
  useGoogleSignIn,
  useSignOut,
} from '../../../hooks/use-supabase-auth';
import { useSupabaseAuth } from '../../../lib/auth-context';

type Mode = 'signin' | 'signup';
type Stage = 0 | 1 | 2 | 3;

function LoginPageInner(): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const { status } = useSupabaseAuth();
  const google = useGoogleSignIn();
  const emailIn = useEmailSignIn();
  const emailUp = useEmailSignUp();
  const signOut = useSignOut();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<Stage>(0);
  const emailRef = useRef<HTMLInputElement>(null);

  // Honor ?mode=signup on first mount
  useEffect(() => {
    const m = search?.get('mode');
    if (m === 'signup') setMode('signup');
    else if (m === 'signin') setMode('signin');
  }, [search]);

  // If we already have a session, route to the app immediately.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  // Surface ?error=... returned from the OAuth callback page.
  const oauthError = search?.get('error') ?? null;

  // Stage progression:
  //   0 -> 1: first input focused
  //   1 -> 2: both fields have content
  //   2 -> 3: pull-string click or form submit
  //   Back: both fields empty -> 0, one field -> 1
  useEffect(() => {
    if (stage >= 3) return;
    if (email.length > 0 && password.length > 0) {
      setStage(2);
    } else if (email.length > 0 || password.length > 0) {
      setStage(1);
    } else {
      setStage(0);
    }
  }, [email, password, stage]);

  const onFirstFocus = (): void => {
    if (stage === 0) setStage(1);
  };

  // Pull string: advance one stage at a time so the lamp transitions visibly.
  // 0 -> 1 -> 2 -> 3 (form visible at 3)
  const pullString = (): void => {
    if (stage < 3) {
      setStage((s) => (s + 1) as Stage);
      if (stage === 2) {
        requestAnimationFrame(() => emailRef.current?.focus());
      }
    }
  };

  // Lamp visual configs per stage
  const lampConfigs = [
    {
      name: 'alone',
      themeColor: '#2a2c30',
      themeGlowRGB: '42, 44, 48',
      shadeColor: '#2c2c2c',
      bulbColor: '#1a1a1a',
      lightOpacity: '0',
      glowScale: '0.6',
      glowOpacity: '0',
      faceAwakeOpacity: '0',
      faceSleepOpacity: '1',
    },
    {
      name: 'interaction',
      themeColor: '#6366f1',
      themeGlowRGB: '99, 102, 241',
      shadeColor: '#2d2d4a',
      bulbColor: '#c7d2fe',
      lightOpacity: '0.12',
      glowScale: '0.9',
      glowOpacity: '0.28',
      faceAwakeOpacity: '0',
      faceSleepOpacity: '1',
    },
    {
      name: 'illumination',
      themeColor: '#f59e0b',
      themeGlowRGB: '245, 158, 11',
      shadeColor: '#947463',
      bulbColor: '#fff0e6',
      lightOpacity: '0.18',
      glowScale: '1',
      glowOpacity: '0.35',
      faceAwakeOpacity: '1',
      faceSleepOpacity: '0',
    },
    {
      name: 'signin',
      themeColor: '#fbbf24',
      themeGlowRGB: '251, 191, 36',
      shadeColor: '#a0826c',
      bulbColor: '#fff4e0',
      lightOpacity: '0.22',
      glowScale: '1.15',
      glowOpacity: '0.55',
      faceAwakeOpacity: '1',
      faceSleepOpacity: '0',
    },
  ] as const;

  const config = lampConfigs[stage] ?? lampConfigs[0]!;

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (stage < 3) setStage(3);
    if (mode === 'signin') {
      await emailIn.mutateAsync({ email: email.trim(), password });
      router.replace('/dashboard');
    } else {
      await emailUp.mutateAsync({ email: email.trim(), password });
    }
  };

  const pending = google.isPending || emailIn.isPending || emailUp.isPending;
  const errorMessage =
    google.error?.message ??
    emailIn.error?.message ??
    emailUp.error?.message ??
    oauthError ??
    null;

  // Card is always faintly visible (0.25) so users know a form exists.
  // Stage 1+ = interactive warmth, 2 = nearly full, 3 = complete.
  const cardOpacity = stage === 0 ? 0.22 : stage === 1 ? 0.65 : stage === 2 ? 0.92 : 1;
  const cardScale = stage === 0 ? 'scale(0.97)' : 'scale(1)';

  const rootVars: Record<string, string> = {
    '--theme-color': config.themeColor,
    '--theme-glow-rgb': config.themeGlowRGB,
    '--shade-color': config.shadeColor,
    '--bulb-color': config.bulbColor,
    '--light-opacity': config.lightOpacity,
    '--glow-scale': config.glowScale,
    '--glow-opacity': config.glowOpacity,
    '--card-opacity': String(cardOpacity),
    '--card-scale': cardScale,
  };

  return (
    <main style={{ minHeight: '100dvh', overflowX: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

        .kx-login-root {
          --bg-color: #0b0f14;
          --font-heading: 'Space Grotesk', sans-serif;
          --font-body: 'Poppins', sans-serif;
          --theme-color: #2a2c30;
          --theme-glow-rgb: 42, 44, 48;
          --shade-color: #2c2c2c;
          --bulb-color: #1a1a1a;
          --light-opacity: 0;
          --glow-scale: 0.6;
          --glow-opacity: 0;
          --card-opacity: 0;
          --card-scale: scale(0.96);
        }

        .kx-login-root * { margin: 0; padding: 0; box-sizing: border-box; }

        .kx-login-root {
          background-color: var(--bg-color);
          color: #ffffff;
          font-family: var(--font-body);
          min-height: 100dvh;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow-x: hidden;
        }

        .kx-login-container {
          display: flex; width: 100%; max-width: 1100px;
          min-height: 600px; padding: 2rem; gap: 3rem;
          align-items: center;
        }

        .kx-login-lamp-section {
          flex: 1; display: flex; justify-content: center;
          align-items: center; position: relative;
        }

        .kx-login-lamp-svg {
          width: 100%; max-width: 380px; height: auto;
          overflow: visible;
          filter: drop-shadow(0 20px 40px rgba(0,0,0,0.6));
        }

        .kx-login-shade-main { fill: var(--shade-color); transition: fill 700ms cubic-bezier(0.4, 0, 0.2, 1); }
        .kx-login-shade-inner { fill: var(--bulb-color); transition: fill 700ms cubic-bezier(0.4, 0, 0.2, 1); }
        .kx-login-light-cone { opacity: var(--light-opacity); transition: opacity 700ms cubic-bezier(0.4, 0, 0.2, 1); }
        .kx-login-face-sleep { transition: opacity 400ms ease; }
        .kx-login-face-awake { transition: opacity 400ms ease; }

        .kx-login-pull-string-group {
          cursor: pointer; transform-origin: top;
          transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .kx-login-pull-string-group:hover .kx-login-string-handle { stroke: #ffffff; }
        .kx-login-pull-string-group:active { transform: scaleY(0.85); }

        /* Gentle pulse on the handle to invite a click */
        @keyframes lampPulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        .kx-login-string-handle {
          animation: lampPulse 2.4s ease-in-out infinite;
        }
        .kx-login-pull-string-group:hover .kx-login-string-handle {
          animation: none;
          opacity: 1;
          stroke: #ffffff;
        }

        .kx-login-lamp-ambient-glow {
          position: absolute; width: 320px; height: 320px;
          background: radial-gradient(circle, rgba(var(--theme-glow-rgb), 0.45) 0%, transparent 70%);
          top: 50%; left: 50%;
          transform: translate(-50%, -50%) scale(var(--glow-scale));
          opacity: var(--glow-opacity);
          z-index: -1;
          transition:
            background 700ms cubic-bezier(0.4, 0, 0.2, 1),
            transform 700ms cubic-bezier(0.4, 0, 0.2, 1),
            opacity 700ms cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
        }

        .kx-login-section { flex: 1; display: flex; justify-content: center; align-items: center; }

        .kx-login-card {
          width: 100%; max-width: 420px;
          background: rgba(18, 24, 32, 0.75); backdrop-filter: blur(16px);
          padding: 3rem 2.5rem; border-radius: 24px;
          border: 1.5px solid var(--theme-color);
          box-shadow: 0 0 40px rgba(var(--theme-glow-rgb), 0.15),
                      0 8px 32px rgba(0,0,0,0.4),
                      inset 0 0 20px rgba(255, 255, 255, 0.02);
          transition:
            opacity 500ms cubic-bezier(0.4, 0, 0.2, 1),
            transform 500ms cubic-bezier(0.4, 0, 0.2, 1),
            border-color 700ms ease,
            box-shadow 700ms ease;
          opacity: var(--card-opacity);
          transform: var(--card-scale);
        }

        .kx-login-card-full {
          border-color: var(--theme-color) !important;
          box-shadow: 0 0 70px rgba(var(--theme-glow-rgb), 0.4),
                      0 12px 48px rgba(0,0,0,0.5),
                      inset 0 0 20px rgba(255, 255, 255, 0.04) !important;
        }

        .kx-login-card h2 {
          font-family: var(--font-heading); font-size: 2rem; font-weight: 700;
          text-align: center; margin-bottom: 0.4rem; letter-spacing: -0.02em;
        }
        .kx-login-eyebrow {
          text-align: center; font-size: 0.85rem; color: #888; margin-bottom: 2rem;
          line-height: 1.5;
        }

        .kx-login-input-group { margin-bottom: 1.25rem; display: flex; flex-direction: column; }
        .kx-login-input-group label {
          font-size: 0.82rem; color: #888; margin-bottom: 0.5rem; font-weight: 500;
          letter-spacing: 0.03em; text-transform: uppercase;
        }

        .kx-login-input-group input {
          background: rgba(255,255,255,0.04); border: 1.5px solid rgba(255,255,255,0.08);
          padding: 1rem 1.2rem; border-radius: 12px; color: #fff; outline: none;
          font-family: inherit; font-size: 1rem;
          transition: border-color 0.3s ease, box-shadow 0.3s ease, background 0.3s ease;
        }
        .kx-login-input-group input::placeholder { color: #555; }
        .kx-login-input-group input:focus {
          border-color: var(--theme-color);
          background: rgba(255,255,255,0.07);
          box-shadow: 0 0 16px rgba(var(--theme-glow-rgb), 0.25);
        }

        .kx-login-btn {
          width: 100%; padding: 1rem; border: none; border-radius: 12px;
          background: var(--theme-color); color: #fff;
          font-size: 1rem; font-weight: 600; cursor: pointer;
          margin-top: 0.75rem; transition: all 0.35s ease;
          font-family: inherit; letter-spacing: 0.01em;
        }
        .kx-login-btn:hover:not(:disabled) { filter: brightness(1.15); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
        .kx-login-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

        .kx-login-google {
          width: 100%; padding: 1rem; border: 1.5px solid rgba(255,255,255,0.1); border-radius: 12px;
          background: rgba(255,255,255,0.03); color: #ddd;
          font-size: 1rem; font-weight: 600; cursor: pointer;
          margin-bottom: 0.5rem; transition: all 0.3s ease;
          font-family: inherit; display: inline-flex; align-items: center;
          justify-content: center; gap: 0.75rem;
        }
        .kx-login-google:hover:not(:disabled) {
          background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2);
          transform: translateY(-1px);
        }
        .kx-login-google:disabled { opacity: 0.55; cursor: not-allowed; }
        .kx-login-google-mark {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.5rem; height: 1.5rem; border-radius: 999px;
          background: #fff; color: #0b0f14; font-weight: 700; font-size: 0.75rem;
          font-family: var(--font-heading);
        }

        .kx-login-divider {
          display: flex; align-items: center; gap: 0.75rem;
          color: #555; font-size: 0.78rem; letter-spacing: 0.06em;
          text-transform: uppercase; margin: 1rem 0;
        }
        .kx-login-divider::before, .kx-login-divider::after {
          content: ''; flex: 1 1 auto; height: 1px; background: rgba(255,255,255,0.08);
        }

        .kx-login-meta {
          display: block; text-align: center; margin-top: 1.25rem;
          color: #666; text-decoration: none; font-size: 0.85rem;
          background: transparent; border: 0; cursor: pointer; font-family: inherit;
          padding: 0; width: 100%; transition: color 0.2s ease;
        }
        .kx-login-meta:hover { color: #fff; }

        .kx-login-error {
          margin-top: 1rem; padding: 0.75rem 1rem; border-radius: 12px;
          background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fca5a5; font-size: 0.85rem; text-align: center;
        }

        .kx-login-hint {
          margin-top: 1.5rem; text-align: center;
          color: #555; font-size: 0.82rem;
          transition: opacity 400ms ease, color 600ms ease;
          min-height: 1.5rem;
        }
        .kx-login-hint-active { color: rgba(var(--theme-glow-rgb), 1); }
        .kx-login-hint-hidden { opacity: 0; }

        @media (max-width: 768px) {
          .kx-login-container { flex-direction: column; min-height: auto; padding: 1.5rem; gap: 1.5rem; }
          .kx-login-lamp-svg { max-width: 220px; }
          .kx-login-card { padding: 2rem 1.5rem; }
        }
      `}</style>

      <div className="kx-login-root" style={rootVars}>
        <div className="kx-login-container">
          {/* ── Lamp Section ── */}
          <div className="kx-login-lamp-section">
            <div className="kx-login-lamp-ambient-glow" />
            <svg
              className="kx-login-lamp-svg"
              viewBox="0 0 300 460"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="Interactive lamp — pull the string to light it"
              data-testid="login-lamp-svg"
              data-stage={config.name}
            >
              <defs>
                <linearGradient id="kxLCone" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <clipPath id="kxMouthClip">
                  <path d="M 125 158 Q 150 195 175 158 Z" />
                </clipPath>
              </defs>

              {/* Light cone */}
              <polygon
                points="80,180 220,180 350,460 -50,460"
                fill="url(#kxLCone)"
                className="kx-login-light-cone"
              />
              {/* Base */}
              <ellipse cx="150" cy="410" rx="65" ry="18" fill="#0e0e10" />
              <ellipse cx="150" cy="405" rx="65" ry="18" fill="#2a2c30" />
              {/* Pole */}
              <rect x="140" y="180" width="20" height="230" fill="#222428" rx="2" />
              <rect x="142" y="180" width="8" height="230" fill="#3a3c42" />
              {/* Inner bulb glow */}
              <ellipse cx="150" cy="175" rx="90" ry="22" className="kx-login-shade-inner" />

              {/* Pull string */}
              <g
                className="kx-login-pull-string-group"
                onClick={pullString}
                role="button"
                tabIndex={0}
                aria-label={stage >= 3 ? 'Lamp is on — form is ready' : 'Pull the string to light the lamp'}
                data-testid="login-lamp-toggle"
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pullString(); } }}
              >
                <line x1="105" y1="180" x2="105" y2="285" stroke="#444" strokeWidth={3} />
                <line
                  x1="105" y1="285" x2="105" y2="315"
                  stroke="#777"
                  strokeWidth={6}
                  strokeLinecap="round"
                  className="kx-login-string-handle"
                />
              </g>

              {/* Lamp shade */}
              <path
                d="M 92 55 Q 150 38 208 55 L 245 175 Q 150 198 55 175 Z"
                className="kx-login-shade-main"
              />

              {/* Sleeping face */}
              <g style={{ opacity: config.faceSleepOpacity }}>
                <path d="M 113 128 Q 124 140 135 128" stroke="#111" strokeWidth={4.5} fill="none" strokeLinecap="round" />
                <path d="M 165 128 Q 176 140 187 128" stroke="#111" strokeWidth={4.5} fill="none" strokeLinecap="round" />
              </g>

              {/* Awake face */}
              <g style={{ opacity: config.faceAwakeOpacity }}>
                <path d="M 113 128 Q 124 112 135 128" stroke="#111" strokeWidth={4.5} fill="none" strokeLinecap="round" />
                <path d="M 165 128 Q 176 112 187 128" stroke="#111" strokeWidth={4.5} fill="none" strokeLinecap="round" />
                <g>
                  <path d="M 125 155 Q 150 192 175 155 Z" fill="#111" />
                  <path d="M 140 165 Q 150 190 160 165 Z" fill="#f87171" clipPath="url(#kxMouthClip)" />
                </g>
              </g>
            </svg>
          </div>

          {/* ── Form Section ── */}
          <div className="kx-login-section">
            <div
              className={'kx-login-card' + (stage === 3 ? ' kx-login-card-full' : '')}
              data-testid="login-card"
              data-stage={config.name}
            >
              <h2>{mode === 'signin' ? 'Welcome back' : 'Create account'}</h2>
              <p className="kx-login-eyebrow">
                {mode === 'signin'
                  ? 'Sign in to continue your learning journey'
                  : 'Set up your account to get started'}
              </p>

              {/* Google OAuth — always available */}
              <button
                type="button"
                className="kx-login-google"
                onClick={() => google.mutate()}
                disabled={pending}
                data-testid="login-google"
              >
                <span className="kx-login-google-mark" aria-hidden="true">G</span>
                {google.isPending ? 'Redirecting…' : 'Continue with Google'}
              </button>

              <div className="kx-login-divider" role="separator" aria-label="or">
                <span>or</span>
              </div>

              {/* Email + password form */}
              <form onSubmit={onSubmit} data-testid="login-form" noValidate>
                <div className="kx-login-input-group">
                  <label htmlFor="kx-login-email">Email address</label>
                  <input
                    ref={emailRef}
                    id="kx-login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={onFirstFocus}
                    required
                    data-testid="login-email"
                  />
                </div>

                <div className="kx-login-input-group">
                  <label htmlFor="kx-login-password">Password</label>
                  <input
                    id="kx-login-password"
                    type="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={onFirstFocus}
                    required
                    minLength={mode === 'signup' ? 8 : 1}
                    data-testid="login-password"
                  />
                </div>

                <button
                  type="submit"
                  className="kx-login-btn"
                  disabled={pending}
                  data-testid="login-submit"
                >
                  {emailIn.isPending
                    ? 'Signing in…'
                    : emailUp.isPending
                      ? 'Creating account…'
                      : mode === 'signin'
                        ? 'Sign in'
                        : 'Create account'}
                </button>

                {errorMessage ? (
                  <p className="kx-login-error" role="alert" data-testid="login-error">
                    {errorMessage}
                  </p>
                ) : null}
              </form>

              {/* Mode toggle */}
              <button
                type="button"
                className="kx-login-meta"
                onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
                disabled={pending}
                data-testid="login-toggle"
              >
                {mode === 'signin'
                  ? "Don't have an account? Sign up free"
                  : 'Already have an account? Sign in'}
              </button>

              {status === 'authenticated' ? (
                <button
                  type="button"
                  className="kx-login-meta"
                  onClick={() => signOut.mutate()}
                  data-testid="login-signout"
                  style={{ marginTop: '0.5rem' }}
                >
                  Sign out of this device
                </button>
              ) : null}
            </div>

            {/* Stage hint */}
            <p
              className={
                'kx-login-hint' +
                (stage === 0
                  ? ''
                  : stage === 1 || stage === 2
                    ? ' kx-login-hint-active'
                    : ' kx-login-hint-hidden')
              }
              data-testid="login-hint"
            >
              {stage === 0
                ? '↑ Click the lamp string to ignite the glow'
                : stage === 1
                  ? 'Keep typing — or pull the string to intensify'
                  : stage === 2
                    ? '↑ Pull the string to reveal the form'
                    : ''}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
