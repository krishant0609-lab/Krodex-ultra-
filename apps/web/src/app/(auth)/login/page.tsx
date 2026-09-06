'use client';

/**
 * KRODEX web — sign in / sign up (4-stage lamp theme).
 *
 * Four meaningful stages:
 *   0. alone        — lamp is off, breathing gently
 *   1. interaction  — user touched lamp or string; lamp flickers indigo
 *   2. illumination — both fields have content; warm amber glow
 *   3. sign-in      — string pulled / form submitted; full warm illumination
 *
 * Desktop: lamp left, form right — same horizontal plane, no scroll needed.
 * Mobile:  lamp top, form below — natural vertical stack.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useEmailSignIn,
  useEmailSignUp,
  useGoogleSignIn,
  useSignOut,
} from '../../../hooks/use-supabase-auth';
import { useSupabaseAuth } from '../../../lib/auth-context';

/* ─── Types ─────────────────────────────────────────────── */
type Mode  = 'signin' | 'signup';
type Stage = 0 | 1 | 2 | 3;

/* ─── Lamp configs per stage ────────────────────────────── */
const LAMP_CONFIGS = [
  {
    name: 'alone',
    themeColor:   '#1e2128',
    glowRGB:      '30, 33, 40',
    shadeColor:  '#262830',
    bulbColor:    '#181a1e',
    lightOpacity: 0,
    glowOpacity:  0,
    glowScale:    0.55,
    faceAwake:    0,
    faceSleep:    1,
    cordColor:    '#3a3d46',
    handleColor:  '#555870',
    breathe:      true,
  },
  {
    name: 'interaction',
    themeColor:   '#4f46e5',
    glowRGB:      '79, 70, 229',
    shadeColor:  '#2d2d52',
    bulbColor:    '#a5b4fc',
    lightOpacity: 0.08,
    glowOpacity:  0.22,
    glowScale:    0.82,
    faceAwake:    0,
    faceSleep:    1,
    cordColor:    '#3a3d46',
    handleColor:  '#7c7fa8',
    breathe:      true,
  },
  {
    name: 'illumination',
    themeColor:   '#d97706',
    glowRGB:      '217, 119, 6',
    shadeColor:  '#7a5a42',
    bulbColor:    '#fff0d6',
    lightOpacity: 0.14,
    glowOpacity:  0.30,
    glowScale:    0.95,
    faceAwake:    1,
    faceSleep:    0,
    cordColor:    '#8a7055',
    handleColor:  '#c8a882',
    breathe:      false,
  },
  {
    name: 'sign-in',
    themeColor:   '#f59e0b',
    glowRGB:      '245, 158, 11',
    shadeColor:  '#9a7050',
    bulbColor:    '#fff8ee',
    lightOpacity: 0.20,
    glowOpacity:  0.48,
    glowScale:    1.10,
    faceAwake:    1,
    faceSleep:    0,
    cordColor:    '#a08060',
    handleColor:  '#e8c890',
    breathe:      false,
  },
] as const;

/* ─── Component ──────────────────────────────────────────── */
function LoginPageInner(): JSX.Element {
  const router  = useRouter();
  const search  = useSearchParams();
  const { status } = useSupabaseAuth();
  const google    = useGoogleSignIn();
  const emailIn   = useEmailSignIn();
  const emailUp   = useEmailSignUp();
  const signOut   = useSignOut();

  const [mode,   setMode]   = useState<Mode>('signin');
  const [email,  setEmail]  = useState('');
  const [pwd,   setPwd]    = useState('');
  const [stage, setStage]  = useState<Stage>(0);

  const emailRef  = useRef<HTMLInputElement>(null);
  const lampRef  = useRef<SVGSVGElement>(null);

  /* Cord physics state */
  const [cordPull,    setCordPull]    = useState(0);   // 0–1 (0 = rest, 1 = fully pulled)
  const [cordSwing,    setCordSwing]   = useState(0);   // -1 to 1 (damped oscillation)
  const [isDragging,   setIsDragging]  = useState(false);

  const dragStartY = useRef<number>(0);

  /* ── URL params ─────────────────────────────────────── */
  useEffect(() => {
    const m = search?.get('mode');
    if (m === 'signup') setMode('signup');
    else if (m === 'signin') setMode('signin');
  }, [search]);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  const oauthError = search?.get('error') ?? null;

  /* ── Auto-advance stage based on field content ──────── */
  useEffect(() => {
    if (stage >= 3) return;
    if (email.length > 0 && pwd.length > 0) setStage(2);
    else if (email.length > 0 || pwd.length > 0) setStage(1);
    else setStage(0);
  }, [email, pwd, stage]);

  /* ── Cord swing: damped oscillation ────────────────── */
  const swingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isDragging) {
      if (swingRef.current) { clearInterval(swingRef.current); swingRef.current = null; }
      return;
    }
    swingRef.current = setInterval(() => {
      setCordSwing(prev => {
        const next = prev * 0.88;
        return Math.abs(next) < 0.003 ? 0 : next;
      });
    }, 16);
    return () => { if (swingRef.current) { clearInterval(swingRef.current); swingRef.current = null; } };
  }, [isDragging]);

  /* ── Lamp / string interaction ────────────────────── */
  const handleLampClick = useCallback((): void => {
    if (stage < 3) setStage(s => (s + 1) as Stage);
    if (stage === 2) requestAnimationFrame(() => emailRef.current?.focus());
  }, [stage]);

  /* Pointer drag on the cord */
  const handleCordPointerDown = useCallback((e: PointerEvent<SVGGElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartY.current = e.clientY;
    /* Initial swing in the pull direction */
    setCordSwing(prev => prev + 0.06);
  }, []);

  const handleCordPointerMove = useCallback((e: PointerEvent<SVGGElement>): void => {
    if (!isDragging) return;
    const delta = (dragStartY.current - e.clientY) / 100; // 100px = full pull
    setCordPull(Math.min(1, Math.max(0, delta)));
    /* Slight tilt in drag direction */
    setCordSwing(Math.max(-0.08, Math.min(0.08, delta * 0.04)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // isDragging read inside; early-return guard avoids stale closure

  const handleCordPointerUp = useCallback((e: PointerEvent<SVGGElement>): void => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
    const wasPulled = cordPull > 0.4;
    setCordPull(0);
    if (wasPulled) {
      /* Swing in opposite direction of pull */
      setCordSwing(-cordPull * 0.25);
      handleLampClick();
    } else {
      setCordSwing(-0.04);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cordPull, handleLampClick]); // isDragging only controls branch, not return value

  /* ── Form submit ─────────────────────────────────────── */
  const onSubmit = useCallback(async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!email.trim() || !pwd) return;
    if (stage < 3) {
      setStage(3);
      setCordPull(0);
      setCordSwing(-0.15);
    }
    if (mode === 'signin') {
      await emailIn.mutateAsync({ email: email.trim(), password: pwd });
      router.replace('/dashboard');
    } else {
      await emailUp.mutateAsync({ email: email.trim(), password: pwd });
    }
  }, [email, pwd, stage, mode, emailIn, emailUp, router]);

  /* ── Derived state ─────────────────────────────────── */
  const pending = google.isPending || emailIn.isPending || emailUp.isPending;
  const errorMessage =
    google.error?.message ??
    emailIn.error?.message ??
    emailUp.error?.message ??
    oauthError ??
    null;

  const cfg = LAMP_CONFIGS[stage];

  const cardOpacity = stage === 0 ? 0.18 : stage === 1 ? 0.62 : stage === 2 ? 0.92 : 1;
  const cardScale   = stage === 0 ? 'scale(0.97)' : 'scale(1)';

  /* Cord SVG transform: pull + swing rotation */
  const cordDx = cordPull * 12 + cordSwing * 6;
  const cordRotation = cordSwing * 3; // degrees
  const handleY = cordPull * 32;

  /* ── Render ─────────────────────────────────────────── */
  return (
    <main>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

        /* ── Reset & Root ─────────────────────────────── */
        .lp * { margin: 0; padding: 0; box-sizing: border-box; }

        .lp {
          --bg: #0b0f14;
          --font-head: 'Space Grotesk', sans-serif;
          --font-body: 'Poppins', sans-serif;
          --tc: #1e2128;
          --tgr: 30,33,40;
          --sc: #262830;
          --bc: #181a1e;
          --lo: 0;
          --go: 0;
          --gs: 0.55;
          --co: 0;
          --cs: 1;
          --cc: #3a3d46;
          --hc: #555870;
          background: var(--bg);
          color: #fff;
          font-family: var(--font-body);
          min-height: 100dvh;
          min-height: 100svh;
          display: grid;
          place-items: center;
          overflow-x: hidden;
        }

        /* ── Layout grid ──────────────────────────────── */
        .lp-grid {
          width: 100%;
          max-width: 1160px;
          padding: 1.5rem 2rem;
          display: grid;
          grid-template-columns: minmax(280px, 1.05fr) minmax(300px, 0.95fr);
          align-items: center;
          gap: clamp(1.5rem, 4vw, 4rem);
          min-height: 0; /* allow content to shrink */
        }

        /* ── Lamp side ─────────────────────────────────── */
        .lp-lamp {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          cursor: pointer;
        }

        .lp-ambient {
          position: absolute;
          inset: -60px;
          background: radial-gradient(circle, rgba(var(--tgr),0.4) 0%, transparent 70%);
          opacity: var(--go);
          transform: scale(var(--gs));
          transition: background 800ms cubic-bezier(0.4,0,0.2,1),
                      opacity 800ms cubic-bezier(0.4,0,0.2,1),
                      transform 800ms cubic-bezier(0.4,0,0.2,1);
          pointer-events: none;
          border-radius: 50%;
          z-index: 0;
        }

        .lp-lamp-svg {
          width: 100%;
          max-width: 340px;
          overflow: visible;
          filter: drop-shadow(0 16px 40px rgba(0,0,0,0.7));
          position: relative;
          z-index: 1;
          transition: filter 800ms ease;
        }

        /* Shade */
        .lp-shade { fill: var(--sc); transition: fill 800ms cubic-bezier(0.4,0,0.2,1); }
        .lp-shade-highlight { fill: rgba(255,255,255,0.06); }

        /* Bulb */
        .lp-bulb { fill: var(--bc); transition: fill 800ms cubic-bezier(0.4,0,0.2,1); }

        /* Light cone */
        .lp-cone {
          opacity: var(--lo);
          transition: opacity 800ms cubic-bezier(0.4,0,0.2,1);
        }

        /* Base & pole */
        .lp-base  { fill: #0e0f14; }
        .lp-pole  { fill: #22252c; }
        .lp-pole-hi { fill: #30343d; }

        /* Cord — a thin path with curvature */
        .lp-cord {
          stroke: var(--cc);
          stroke-width: 2.5;
          fill: none;
          stroke-linecap: round;
          transition: stroke 600ms ease;
        }

        /* Handle — a small rounded rectangle knob */
        .lp-handle {
          fill: var(--hc);
          transition: fill 600ms ease;
          rx: 4; ry: 4;
        }

        /* Faces */
        .lp-face-sleep { transition: opacity 400ms ease; }
        .lp-face-awake { transition: opacity 400ms ease; }

        /* Hint text under lamp */
        .lp-hint {
          margin-top: 1.5rem;
          font-size: 0.78rem;
          color: #4a4e5a;
          letter-spacing: 0.04em;
          text-align: center;
          transition: color 500ms ease, opacity 500ms ease;
          min-height: 1.2rem;
        }
        .lp-hint-active { color: rgba(var(--tgr),0.9); }
        .lp-hint-gone   { opacity: 0; }

        /* ── Form side ────────────────────────────────── */
        .lp-form {
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }

        .lp-card {
          background: rgba(14,18,26,0.72);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1.5px solid var(--tc);
          border-radius: 24px;
          padding: clamp(1.75rem, 3vw, 2.5rem);
          box-shadow: 0 0 48px rgba(var(--tgr),0.12),
                      0 12px 40px rgba(0,0,0,0.5),
                      inset 0 0 24px rgba(255,255,255,0.02);
          transition:
            opacity 550ms cubic-bezier(0.4,0,0.2,1),
            transform 550ms cubic-bezier(0.4,0,0.2,1),
            border-color 700ms ease,
            box-shadow 700ms ease;
          opacity: var(--co);
          transform: var(--cs);
        }

        .lp-card-full {
          border-color: var(--tc) !important;
          box-shadow: 0 0 80px rgba(var(--tgr),0.35),
                      0 16px 56px rgba(0,0,0,0.6),
                      inset 0 0 28px rgba(255,255,255,0.04) !important;
        }

        .lp-title {
          font-family: var(--font-head);
          font-size: clamp(1.6rem, 3vw, 2.1rem);
          font-weight: 700;
          letter-spacing: -0.025em;
          text-align: center;
          margin-bottom: 0.35rem;
        }
        .lp-eyebrow {
          text-align: center;
          font-size: 0.84rem;
          color: #636a78;
          margin-bottom: 1.75rem;
          line-height: 1.5;
        }

        /* Google button */
        .lp-google {
          width: 100%;
          padding: 0.85rem 1.2rem;
          border: 1.5px solid rgba(255,255,255,0.09);
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
          color: #ccc;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          font-family: var(--font-body);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.7rem;
          margin-bottom: 0.4rem;
          transition: background 250ms ease, border-color 250ms ease, transform 200ms ease;
        }
        .lp-google:hover:not(:disabled) {
          background: rgba(255,255,255,0.07);
          border-color: rgba(255,255,255,0.18);
          transform: translateY(-1px);
        }
        .lp-google:disabled { opacity: 0.5; cursor: not-allowed; }
        .lp-google-g { display:inline-flex; align-items:center; justify-content:center;
          width:1.4rem; height:1.4rem; border-radius:999px; background:#fff;
          color:#0b0f14; font-weight:700; font-size:0.7rem; font-family:var(--font-head); }

        /* Divider */
        .lp-divider { display:flex; align-items:center; gap:0.75rem; margin: 1rem 0;
          color:#404552; font-size:0.75rem; letter-spacing:0.07em; text-transform:uppercase; }
        .lp-divider::before, .lp-divider::after { content:''; flex:1; height:1px; background:rgba(255,255,255,0.06); }

        /* Inputs */
        .lp-field { display:flex; flex-direction:column; margin-bottom: 1rem; }
        .lp-label { font-size:0.78rem; color:#5a6070; font-weight:500; letter-spacing:0.05em;
          text-transform:uppercase; margin-bottom:0.45rem; }
        .lp-input {
          background: rgba(255,255,255,0.04);
          border: 1.5px solid rgba(255,255,255,0.08);
          padding: 0.85rem 1.1rem;
          border-radius: 12px;
          color: #fff;
          font-family: var(--font-body);
          font-size: 0.97rem;
          outline: none;
          transition: border-color 280ms ease, box-shadow 280ms ease, background 280ms ease;
        }
        .lp-input::placeholder { color: #404552; }
        .lp-input:focus {
          border-color: var(--tc);
          background: rgba(255,255,255,0.065);
          box-shadow: 0 0 0 3px rgba(var(--tgr),0.18), 0 0 18px rgba(var(--tgr),0.12);
        }

        /* Submit */
        .lp-submit {
          width: 100%;
          padding: 0.9rem;
          border: none;
          border-radius: 12px;
          background: var(--tc);
          color: #fff;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          font-family: var(--font-body);
          margin-top: 0.5rem;
          transition: filter 280ms ease, transform 220ms ease, box-shadow 280ms ease, background 400ms ease;
          letter-spacing: 0.01em;
        }
        .lp-submit:hover:not(:disabled) {
          filter: brightness(1.12);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        }
        .lp-submit:active:not(:disabled) { transform: translateY(0); }
        .lp-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        /* Error */
        .lp-error {
          margin-top: 0.9rem;
          padding: 0.7rem 1rem;
          border-radius: 10px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.25);
          color: #fca5a5;
          font-size: 0.83rem;
          text-align: center;
        }

        /* Toggle mode */
        .lp-toggle {
          display: block;
          width: 100%;
          margin-top: 1rem;
          padding: 0;
          background: none;
          border: none;
          color: #4a5060;
          font-size: 0.84rem;
          cursor: pointer;
          font-family: var(--font-body);
          transition: color 200ms ease;
          text-align: center;
        }
        .lp-toggle:hover { color: #c0c8d8; }

        /* ── Responsive ────────────────────────────────── */
        @media (max-width: 900px) {
          .lp-grid {
            grid-template-columns: 1fr;
            gap: 2rem;
            padding: 1.25rem 1.5rem;
          }
          .lp-lamp { flex-direction: row; gap: 2rem; justify-content: center; }
          .lp-lamp-svg { max-width: 200px; }
          .lp-hint { margin-top: 0; }
          .lp-form { align-items: center; }
          .lp-card { width: 100%; max-width: 440px; }
        }

        @media (max-width: 480px) {
          .lp-grid { padding: 1rem; gap: 1.5rem; }
          .lp-lamp-svg { max-width: 160px; }
          .lp-card { padding: 1.5rem 1.25rem; border-radius: 20px; }
        }

        /* ── Accessibility ─────────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }

        /* Focus visible */
        .lp-google:focus-visible,
        .lp-input:focus-visible,
        .lp-submit:focus-visible,
        .lp-toggle:focus-visible {
          outline: 2px solid rgba(var(--tgr),0.7);
          outline-offset: 2px;
        }
      `}</style>

      <div
        className="lp"
        style={{
          '--tc': cfg.themeColor,
          '--tgr': cfg.glowRGB,
          '--sc': cfg.shadeColor,
          '--bc': cfg.bulbColor,
          '--lo': cfg.lightOpacity,
          '--go': cfg.glowOpacity,
          '--gs': cfg.glowScale,
          '--co': cardOpacity,
          '--cs': cardScale,
          '--cc': cfg.cordColor,
          '--hc': cfg.handleColor,
        } as React.CSSProperties}
      >
        <div className="lp-grid">
          {/* ── Lamp side ───────────────────────────────── */}
          <div
            className="lp-lamp"
            onClick={handleLampClick}
            role="button"
            tabIndex={0}
            aria-label="Click the lamp to advance"
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLampClick(); } }}
          >
            <div className="lp-ambient" />

            <svg
              ref={lampRef}
              className="lp-lamp-svg"
              viewBox="0 0 300 460"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              data-stage={cfg.name}
            >
              <defs>
                {/* Light cone gradient */}
                <linearGradient id="coneGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%"   stopColor="#fff"    stopOpacity="0.92" />
                  <stop offset="55%"  stopColor="#fff"    stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#fff"    stopOpacity="0.00" />
                </linearGradient>
                {/* Warm glow gradient for bulb */}
                <radialGradient id="bulbGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%"   stopColor="#fffde7" stopOpacity="1" />
                  <stop offset="100%" stopColor="#fffde7" stopOpacity="0" />
                </radialGradient>
                {/* Cord shadow */}
                <filter id="cordShadow">
                  <feDropShadow dx="1" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.4" />
                </filter>
                {/* Shade inner shadow */}
                <radialGradient id="shadeInner" cx="50%" cy="30%" r="60%">
                  <stop offset="0%"   stopColor="rgba(255,255,255,0.08)" />
                  <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                </radialGradient>
                {/* Mouth clip for smile */}
                <clipPath id="mouthClip">
                  <path d="M 122 155 Q 150 195 178 155 Z" />
                </clipPath>
              </defs>

              {/* ── Light cone (below shade) ── */}
              <polygon
                points="70,178 230,178 380,460 -80,460"
                fill="url(#coneGrad)"
                className="lp-cone"
              />

              {/* ── Base ── */}
              <ellipse cx="150" cy="408" rx="68" ry="20" className="lp-base" />
              <ellipse cx="150" cy="403" rx="66" ry="18" fill="#1e2128" />

              {/* ── Pole ── */}
              <rect x="139" y="175" width="22" height="233" rx="2" className="lp-pole" />
              <rect x="143" y="175" width="7"  height="233" rx="1" className="lp-pole-hi" />

              {/* ── Cord (realistic curved path, not a straight line) ── */}
              {/* A gentle S-curve hanging cord with physics applied */}
              <path
                className="lp-cord"
                d={`M 150,175
                    C 148,200 ${152 + cordSwing * 8},225
                      ${150 + cordDx},285`}
                style={{
                  filter: 'url(#cordShadow)',
                  stroke: cfg.cordColor,
                }}
              />

              {/* ── Handle / knob on the cord ── */}
              <rect
                className="lp-handle"
                x={144 + cordDx * 0.5}
                y={280 + handleY}
                width="12"
                height="30"
                rx="5"
                ry="5"
                style={{
                  transform: `rotate(${cordRotation}deg)`,
                  transformOrigin: `${150 + cordDx * 0.5 + 6}px ${280 + handleY}px`,
                  transition: isDragging ? 'none' : 'transform 400ms cubic-bezier(0.34,1.56,0.64,1)',
                }}
              />

              {/* ── Shade (interactive — large hitbox) ── */}
              <path
                d="M 88 52 Q 150 34 212 52 L 250 172 Q 150 196 50 172 Z"
                className="lp-shade"
                onClick={e => { e.stopPropagation(); handleLampClick(); }}
                style={{ cursor: 'pointer' }}
              />
              {/* Shade inner highlight */}
              <path
                d="M 88 52 Q 150 34 212 52 L 250 172 Q 150 196 50 172 Z"
                fill="url(#shadeInner)"
              />

              {/* ── Inner bulb glow ── */}
              <ellipse cx="150" cy="172" rx="92" ry="24" className="lp-bulb" />
              {/* Warm light bloom inside shade */}
              <ellipse
                cx="150" cy="168" rx="40" ry="16"
                fill="url(#bulbGlow)"
                opacity={stage >= 1 ? cfg.lightOpacity * 4 : 0}
                style={{ transition: 'opacity 800ms ease' }}
              />

              {/* ── Sleeping face (stage 0–1) ── */}
              <g className="lp-face-sleep" style={{ opacity: cfg.faceSleep }}>
                {/* Left eye — closed arc */}
                <path d="M 112 128 Q 124 141 136 128" stroke="#0a0a0e" strokeWidth="4.5"
                      fill="none" strokeLinecap="round" />
                {/* Right eye — closed arc */}
                <path d="M 164 128 Q 176 141 188 128" stroke="#0a0a0e" strokeWidth="4.5"
                      fill="none" strokeLinecap="round" />
              </g>

              {/* ── Awake face (stage 2–3) ── */}
              <g className="lp-face-awake" style={{ opacity: cfg.faceAwake }}>
                {/* Left eye — open, arched */}
                <path d="M 112 126 Q 124 111 136 126" stroke="#0a0a0e" strokeWidth="4.5"
                      fill="none" strokeLinecap="round" />
                {/* Right eye — open, arched */}
                <path d="M 164 126 Q 176 111 188 126" stroke="#0a0a0e" strokeWidth="4.5"
                      fill="none" strokeLinecap="round" />
                {/* Mouth — smile */}
                <path d="M 122 155 Q 150 193 178 155 Z" fill="#0a0a0e" />
                <path d="M 136 166 Q 150 188 164 166 Z" fill="#f87171" clipPath="url(#mouthClip)" />
              </g>

              {/* ── Interactive cord group (pointer drag) ── */}
              {/* Invisible fat hitbox around the cord + handle */}
              <rect
                x="118"
                y="170"
                width="64"
                height="160"
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onPointerDown={handleCordPointerDown}
                onPointerMove={handleCordPointerMove}
                onPointerUp={handleCordPointerUp}
                onPointerCancel={handleCordPointerUp}
              />
            </svg>

            {/* Hint */}
            <p
              className={
                'lp-hint' +
                (stage === 0 ? '' : stage === 1 || stage === 2 ? ' lp-hint-active' : ' lp-hint-gone')
              }
            >
              {stage === 0
                ? '↑ tap the lamp or pull the cord'
                : stage === 1
                  ? 'keep going — or pull the cord'
                  : stage === 2
                    ? '↑ pull the cord to unlock'
                    : ''}
            </p>
          </div>

          {/* ── Form side ────────────────────────────────── */}
          <div className="lp-form">
            <div
              className={'lp-card' + (stage === 3 ? ' lp-card-full' : '')}
              data-stage={cfg.name}
            >
              <h1 className="lp-title">
                {mode === 'signin' ? 'Welcome back' : 'Create account'}
              </h1>
              <p className="lp-eyebrow">
                {mode === 'signin'
                  ? 'Sign in to continue your learning journey'
                  : 'Set up your account to get started'}
              </p>

              {/* Google */}
              <button
                type="button"
                className="lp-google"
                onClick={() => google.mutate()}
                disabled={pending}
              >
                <span className="lp-google-g" aria-hidden="true">G</span>
                {google.isPending ? 'Redirecting…' : 'Continue with Google'}
              </button>

              <div className="lp-divider"><span>or</span></div>

              {/* Email + Password form */}
              <form onSubmit={onSubmit} noValidate>
                <div className="lp-field">
                  <label className="lp-label" htmlFor="lp-email">Email address</label>
                  <input
                    ref={emailRef}
                    id="lp-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="lp-input"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="lp-field">
                  <label className="lp-label" htmlFor="lp-pwd">Password</label>
                  <input
                    id="lp-pwd"
                    type="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                    className="lp-input"
                    value={pwd}
                    onChange={e => setPwd(e.target.value)}
                    required
                    minLength={mode === 'signup' ? 8 : 1}
                  />
                </div>

                <button
                  type="submit"
                  className="lp-submit"
                  disabled={pending}
                >
                  {emailIn.isPending
                    ? 'Signing in…'
                    : emailUp.isPending
                      ? 'Creating account…'
                      : mode === 'signin' ? 'Sign in' : 'Create account'}
                </button>

                {errorMessage ? (
                  <p className="lp-error" role="alert">{errorMessage}</p>
                ) : null}
              </form>

              {/* Mode toggle */}
              <button
                type="button"
                className="lp-toggle"
                onClick={() => setMode(m => m === 'signin' ? 'signup' : 'signin')}
                disabled={pending}
              >
                {mode === 'signin'
                  ? "Don't have an account? Sign up free"
                  : 'Already have an account? Sign in'}
              </button>

              {status === 'authenticated' ? (
                <button
                  type="button"
                  className="lp-toggle"
                  onClick={() => signOut.mutate()}
                  style={{ marginTop: '0.5rem', color: '#7a3a3a' }}
                >
                  Sign out of this device
                </button>
              ) : null}
            </div>
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
