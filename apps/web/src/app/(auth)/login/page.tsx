'use client';

/**
 * KRODEX web — sign in / sign up (4-stage lamp theme).
 *
 * Real Supabase Auth (production path):
 *  - Google OAuth (signInWithOAuth) — primary, since Google
 *    is enabled on the production Supabase project.
 *  - Email + password (signInWithPassword / signUp) — works
 *    for both sign-in and sign-up. The mode toggle swaps the
 *    submit label and the helper text.
 *
 * The 4 lamp stages (each is a meaningful state in the
 * authentication journey):
 *
 *   0. alone       — the page is just opened. The lamp is off
 *                    and the form card is hidden. Quiet,
 *                    ambient, dark.
 *   1. interaction — the user has focused an input. The lamp
 *                    flickers on briefly (still dark) so the
 *                    room "reacts" to the touch. Form card
 *                    still hidden.
 *   2. illumination— both email and password fields have
 *                    content. The lamp is fully on, the light
 *                    cone is visible, the face is awake. The
 *                    form card begins to appear but is still
 *                    partially translucent.
 *   3. sign-in/up  — the user has pulled the string (or
 *                    pressed enter). The lamp glow intensifies
 *                    and the form card is fully visible.
 *
 * The lamp is the input. The form is the reward. No fake
 * "loading shimmer" states. The SupabaseAuthProvider
 * (lib/auth-context.tsx) listens to the auth state and
 * writes the Supabase access token (ES256) into the
 * in-memory auth-store that the api-client reads. The
 * KRODEX API prehandler validates the same access token
 * with `supabase.auth.getUser(jwt)` and forwards it
 * unchanged to PostgREST so RLS keeps enforcing user
 * ownership.
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

  // Honor ?mode=signup on first mount so the landing page
  // "Get started" CTA lands on the sign-up form.
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
  //   0 -> 1: any input focused
  //   1 -> 2: both fields have content
  //   2 -> 3: user pulls the string or presses enter
  //   3 stays until submit
  useEffect(() => {
    if (stage >= 3) return;
    if (email.length > 0 && password.length > 0) {
      setStage(2);
    } else if (email.length > 0 || password.length > 0) {
      setStage(1);
    } else if (stage === 1) {
      // User cleared all fields; drop back to alone.
      setStage(0);
    }
  }, [email, password, stage]);

  const onFirstFocus = (): void => {
    if (stage === 0) setStage(1);
  };

  const pullString = (): void => {
    setStage(3);
    // After the stage transition, focus the email field so
    // keyboard users land in the form.
    requestAnimationFrame(() => {
      emailRef.current?.focus();
    });
  };

  const lampStates = [
    {
      // 0 — alone
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
      // 1 — interaction (flicker, still cool)
      name: 'interaction',
      themeColor: '#5a5347',
      themeGlowRGB: '90, 83, 71',
      shadeColor: '#3a3a3a',
      bulbColor: '#5a4632',
      lightOpacity: '0.04',
      glowScale: '0.85',
      glowOpacity: '0.18',
      faceAwakeOpacity: '0',
      faceSleepOpacity: '1',
    },
    {
      // 2 — illumination (warm, awake face, cone visible)
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
      // 3 — sign-in/sign-up (intensified glow)
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

  const config = lampStates[stage] ?? lampStates[0]!;
  const _lampIsOn = stage >= 2;
  const formVisible = stage >= 2;

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

  const pending =
    google.isPending || emailIn.isPending || emailUp.isPending;
  const errorMessage =
    google.error?.message ??
    emailIn.error?.message ??
    emailUp.error?.message ??
    oauthError ??
    null;

  // CSS variables drive the lamp palette and the focus glow.
  const rootVars: Record<string, string> = {
    '--theme-color': config.themeColor,
    '--theme-glow-rgb': config.themeGlowRGB,
    '--shade-color': config.shadeColor,
    '--bulb-color': config.bulbColor,
    '--light-opacity': config.lightOpacity,
    '--glow-scale': config.glowScale,
    '--glow-opacity': config.glowOpacity,
  };

  return (
    <main style={{ minHeight: '100dvh', overflowX: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');

        .kx-login-root {
          --bg-color: #0b0f14;
          --font-family: 'Poppins', sans-serif;
          --theme-color: #2a2c30;
          --theme-glow-rgb: 42, 44, 48;
          --shade-color: #2c2c2c;
          --bulb-color: #1a1a1a;
          --light-opacity: 0;
          --glow-scale: 0.6;
          --glow-opacity: 0;
        }

        .kx-login-root * { margin: 0; padding: 0; box-sizing: border-box; }

        .kx-login-root {
          background-color: var(--bg-color);
          color: #ffffff;
          font-family: var(--font-family);
          min-height: 100dvh;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow-x: hidden;
        }

        .kx-login-container {
          display: flex; width: 100%; max-width: 1100px;
          min-height: 600px; padding: 2rem; gap: 2rem;
          align-items: center;
        }

        .kx-login-lamp-section {
          flex: 1; display: flex; justify-content: center;
          align-items: center; position: relative;
        }

        .kx-login-lamp-svg {
          width: 100%; max-width: 350px; height: auto;
          overflow: visible;
          filter: drop-shadow(0 20px 30px rgba(0,0,0,0.5));
        }

        .kx-login-shade-main { fill: var(--shade-color); transition: fill 700ms cubic-bezier(0.4, 0, 0.2, 1); }
        .kx-login-shade-inner { fill: var(--bulb-color); transition: fill 700ms cubic-bezier(0.4, 0, 0.2, 1); }
        .kx-login-light-cone { opacity: var(--light-opacity); transition: opacity 700ms cubic-bezier(0.4, 0, 0.2, 1); }
        .kx-login-face-sleep { transition: opacity 400ms ease; }
        .kx-login-face-awake { opacity: 0; transition: opacity 400ms ease; }

        .kx-login-pull-string-group {
          cursor: pointer; transform-origin: top;
          transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .kx-login-pull-string-group:hover .kx-login-string-handle { stroke: #ffffff; }
        .kx-login-pull-string-group:active { transform: scaleY(0.85); }

        .kx-login-lamp-ambient-glow {
          position: absolute; width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(var(--theme-glow-rgb), 0.4) 0%, transparent 70%);
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
          width: 100%; max-width: 400px;
          background: rgba(18, 24, 32, 0.6); backdrop-filter: blur(12px);
          padding: 3rem 2.5rem; border-radius: 20px;
          border: 2px solid var(--theme-color);
          box-shadow: 0 0 30px rgba(var(--theme-glow-rgb), 0.2),
                      inset 0 0 15px rgba(255, 255, 255, 0.02);
          transition:
            opacity 600ms cubic-bezier(0.4, 0, 0.2, 1),
            transform 600ms cubic-bezier(0.4, 0, 0.2, 1),
            border-color 700ms ease,
            box-shadow 700ms ease;
          opacity: 0;
          transform: translateY(28px);
          pointer-events: none;
        }

        .kx-login-card-visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }

        .kx-login-card-full {
          border-color: var(--theme-color);
          box-shadow: 0 0 50px rgba(var(--theme-glow-rgb), 0.35),
                      inset 0 0 15px rgba(255, 255, 255, 0.03);
        }

        .kx-login-card h2 { font-size: 2rem; font-weight: 600; text-align: center; margin-bottom: 0.5rem; }
        .kx-login-card .kx-login-eyebrow {
          text-align: center; font-size: 0.85rem; color: #a0a0a0; margin-bottom: 1.75rem;
        }

        .kx-login-input-group { margin-bottom: 1.25rem; display: flex; flex-direction: column; }
        .kx-login-input-group label { font-size: 0.85rem; color: #a0a0a0; margin-bottom: 0.5rem; font-weight: 500; }

        .kx-login-input-group input {
          background: #151a21; border: 1px solid #2a2c30;
          padding: 1rem 1.2rem; border-radius: 10px; color: #fff; outline: none;
          font-family: inherit; font-size: 1rem;
          transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }
        .kx-login-input-group input:focus {
          border-color: var(--theme-color);
          box-shadow: 0 0 10px rgba(var(--theme-glow-rgb), 0.4);
        }

        .kx-login-btn {
          width: 100%; padding: 1rem; border: none; border-radius: 10px;
          background: var(--theme-color); color: #fff;
          font-size: 1rem; font-weight: 600; cursor: pointer;
          margin-top: 0.5rem; transition: all 0.4s ease;
          font-family: inherit;
        }
        .kx-login-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-2px); }
        .kx-login-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .kx-login-google {
          width: 100%; padding: 1rem; border: 1px solid #2a2c30; border-radius: 10px;
          background: #151a21; color: #fff;
          font-size: 1rem; font-weight: 600; cursor: pointer;
          margin-bottom: 1.25rem; transition: all 0.3s ease;
          font-family: inherit; display: inline-flex; align-items: center;
          justify-content: center; gap: 0.6rem;
        }
        .kx-login-google:hover:not(:disabled) {
          background: #1c222b; transform: translateY(-2px);
        }
        .kx-login-google:disabled { opacity: 0.6; cursor: not-allowed; }
        .kx-login-google-mark {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.4rem; height: 1.4rem; border-radius: 999px;
          background: #fff; color: #0b0f14; font-weight: 700;
          font-family: 'Poppins', sans-serif;
        }

        .kx-login-divider {
          display: flex; align-items: center; gap: 0.75rem;
          color: #777; font-size: 0.8rem; letter-spacing: 0.05em;
          text-transform: uppercase; margin: 0.5rem 0 1rem;
        }
        .kx-login-divider::before, .kx-login-divider::after {
          content: ''; flex: 1 1 auto; height: 1px; background: #2a2c30;
        }

        .kx-login-meta {
          display: block; text-align: center; margin-top: 1.25rem;
          color: #777; text-decoration: none; font-size: 0.85rem;
          background: transparent; border: 0; cursor: pointer; font-family: inherit;
          padding: 0; width: 100%;
        }
        .kx-login-meta:hover { color: #fff; }

        .kx-login-error {
          margin-top: 1rem; padding: 0.75rem 1rem; border-radius: 10px;
          background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.4);
          color: #fca5a5; font-size: 0.85rem; text-align: center;
        }

        .kx-login-hint {
          margin-top: 1.5rem;
          text-align: center;
          color: #5a5a5a;
          font-size: 0.85rem;
          transition: opacity 600ms ease, color 700ms ease;
          opacity: 0.7;
        }
        .kx-login-hint-active { color: rgba(var(--theme-glow-rgb), 0.95); opacity: 1; }
        .kx-login-hint-hidden { opacity: 0; pointer-events: none; }

        @media (max-width: 768px) {
          .kx-login-container { flex-direction: column; min-height: auto; }
          .kx-login-lamp-svg { max-width: 250px; }
        }
      `}</style>

      <div className="kx-login-root" style={rootVars}>
        <div className="kx-login-container">
          <div className="kx-login-lamp-section">
            <div className="kx-login-lamp-ambient-glow" />
            <svg
              className="kx-login-lamp-svg"
              viewBox="0 0 300 450"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="Cute interactive lamp"
              data-testid="login-lamp-svg"
              data-stage={config.name}
            >
              <defs>
                <linearGradient id="kxLoginLightCone" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <clipPath id="kxLoginMouthClip">
                  <path d="M 125 155 Q 150 190 175 155 Z" />
                </clipPath>
              </defs>

              <polygon
                points="90,180 210,180 320,450 -20,450"
                fill="url(#kxLoginLightCone)"
                className="kx-login-light-cone"
              />
              <ellipse cx="150" cy="400" rx="60" ry="15" fill="#151515" />
              <ellipse cx="150" cy="395" rx="60" ry="15" fill="#3a3c40" />
              <rect x="140" y="180" width="20" height="220" fill="#2a2c30" />
              <rect x="142" y="180" width="8" height="220" fill="#4a4c50" />
              <ellipse cx="150" cy="175" rx="90" ry="20" className="kx-login-shade-inner" />

              <g
                className="kx-login-pull-string-group"
                onClick={pullString}
                role="button"
                aria-label={stage >= 3 ? 'Lamp on — form ready' : 'Pull the lamp string to continue'}
                data-testid="login-lamp-toggle"
              >
                <line x1="105" y1="180" x2="105" y2="280" stroke="#555" strokeWidth={3} />
                <line
                  x1="105"
                  y1="280"
                  x2="105"
                  y2="310"
                  stroke="#888"
                  strokeWidth={6}
                  strokeLinecap="round"
                  className="kx-login-string-handle"
                />
              </g>

              <path
                d="M 95 60 Q 150 45 205 60 L 240 175 Q 150 195 60 175 Z"
                className="kx-login-shade-main"
              />

              <g className="kx-login-face-sleep" style={{ opacity: config.faceSleepOpacity }}>
                <path
                  d="M 115 130 Q 125 140 135 130"
                  stroke="#111"
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M 165 130 Q 175 140 185 130"
                  stroke="#111"
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                />
              </g>

              <g className="kx-login-face-awake" style={{ opacity: config.faceAwakeOpacity }}>
                <path
                  d="M 115 130 Q 125 115 135 130"
                  stroke="#111"
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M 165 130 Q 175 115 185 130"
                  stroke="#111"
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                />
                <g>
                  <path d="M 125 155 Q 150 190 175 155 Z" fill="#111" />
                  <path
                    d="M 140 165 Q 150 190 160 165 Z"
                    fill="#f87171"
                    clipPath="url(#kxLoginMouthClip)"
                  />
                </g>
              </g>
            </svg>
          </div>

          <div className="kx-login-section">
            <div
              className={
                'kx-login-card' +
                (formVisible ? ' kx-login-card-visible' : '') +
                (stage === 3 ? ' kx-login-card-full' : '')
              }
              data-testid="login-card"
              data-stage={config.name}
            >
              <h2>{mode === 'signin' ? 'Welcome Back' : 'Create Account'}</h2>
              <p className="kx-login-eyebrow">
                {mode === 'signin'
                  ? 'Sign in to continue your KRODEX journey'
                  : 'Set up an email + password to get started'}
              </p>

              <button
                type="button"
                className="kx-login-google"
                onClick={() => google.mutate()}
                disabled={pending}
                data-testid="login-google"
              >
                <span className="kx-login-google-mark" aria-hidden="true">
                  G
                </span>
                {google.isPending ? 'Opening Google…' : 'Continue with Google'}
              </button>

              <div className="kx-login-divider" role="separator" aria-label="or">
                <span>or</span>
              </div>

              <form
                onSubmit={onSubmit}
                data-testid="login-form"
                noValidate
              >
                <div className="kx-login-input-group">
                  <label htmlFor="kx-login-email">Email</label>
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
                        ? 'Login'
                        : 'Create account'}
                </button>

                {errorMessage ? (
                  <p className="kx-login-error" role="alert" data-testid="login-error">
                    {errorMessage}
                  </p>
                ) : null}
              </form>

              <button
                type="button"
                className="kx-login-meta"
                onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
                disabled={pending}
                data-testid="login-toggle"
              >
                {mode === 'signin'
                  ? "Don't have an account? Sign up"
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

            <p
              className={
                'kx-login-hint' +
                (stage === 0
                  ? ''
                  : stage === 1
                    ? ' kx-login-hint-active'
                    : ' kx-login-hint-hidden')
              }
              data-testid="login-hint"
            >
              {stage === 0
                ? 'Touch the email field to wake the lamp.'
                : stage === 1
                  ? 'Now type a password — the lamp is listening.'
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
