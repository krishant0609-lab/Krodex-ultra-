'use client';

// KRODEX lamp-auth - physical pull-cord, progressive 4-stage illumination
// Stage 0: sleeping/dark | Stage 1: interaction | Stage 2: illumination | Stage 3: form active

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

type Mode  = 'signin' | 'signup';
type Stage = 0 | 1 | 2 | 3;

const PULL_FULL_PX  = 110;
const PULL_ACTIVATE = 0.45;
const CORD_MAX_DY   = 52;
const SWING_DAMPING  = 0.86;
const SWING_MIN       = 0.003;

const STAGE_PALETTE: Record<Stage, Record<string, string | number>> = {
  0: {
    bg:'#070910',cardBg:'rgba(8,11,22,0)',cardBorder:'rgba(255,255,255,0)',cardShadow:'transparent',cardShadowActive:'transparent',cardGlow:'transparent',
    shadeFill:'#1a1c26',shadeHighlight:'rgba(255,255,255,0.03)',
    poleFill:'#1c1f2a',poleHi:'#262936',baseFill:'#0d0f18',
    cordStroke:'#2a2d3a',handleFill:'#363a4a',handleShadow:'rgba(0,0,0,0.5)',
    bulbFill:'#0c0e18',bulbGlowFill:'#fffde7',bulbGlowOpacity:0,
    coneFill:'#fffde7',coneOpacity:0,
    ambientRgb:'12,14,22',ambientOpacity:0,ambientScale:0.55,lampScale:0.96,
    faceSleepOpacity:1,faceAwakeOpacity:0,
    eyeStroke:'#0a0c14',mouthFill:'#0a0c14',tongueFill:'#c06060',
    hintColor:'#3a3e52',hintOpacity:1,formOpacity:0,formScale:0.94,formTranslateY:12,
    eyebrowColor:'rgba(255,255,255,0)',
  },
  1: {
    bg:'#090b14',cardBg:'rgba(12,15,30,0)',cardBorder:'rgba(255,255,255,0)',cardShadow:'transparent',cardShadowActive:'transparent',cardGlow:'transparent',
    shadeFill:'#1f2240',shadeHighlight:'rgba(129,140,248,0.08)',
    poleFill:'#1e2240',poleHi:'#2a2f55',baseFill:'#0e1020',
    cordStroke:'#363a55',handleFill:'#4a5078',handleShadow:'rgba(79,70,229,0.25)',
    bulbFill:'#181c40',bulbGlowFill:'#c7d2ff',bulbGlowOpacity:0.12,
    coneFill:'#c7d2ff',coneOpacity:0,
    ambientRgb:'79,70,229',ambientOpacity:0.06,ambientScale:0.72,lampScale:0.97,
    faceSleepOpacity:1,faceAwakeOpacity:0,
    eyeStroke:'#0a0c18',mouthFill:'#0a0c18',tongueFill:'#c06060',
    hintColor:'rgba(129,140,248,0.7)',hintOpacity:1,formOpacity:0,formScale:0.94,formTranslateY:12,
    eyebrowColor:'rgba(255,255,255,0)',
  },
  2: {
    bg:'#0f0d08',cardBg:'rgba(22,18,10,0)',cardBorder:'rgba(255,255,255,0)',cardShadow:'transparent',cardShadowActive:'transparent',cardGlow:'transparent',
    shadeFill:'#3d2e18',shadeHighlight:'rgba(255,220,150,0.12)',
    poleFill:'#3a3025',poleHi:'#504535',baseFill:'#1c1810',
    cordStroke:'#7a6040',handleFill:'#b09070',handleShadow:'rgba(217,119,6,0.3)',
    bulbFill:'#fff0d0',bulbGlowFill:'#ffe4a0',bulbGlowOpacity:0.55,
    coneFill:'#ffe4a0',coneOpacity:0.22,
    ambientRgb:'217,119,6',ambientOpacity:0.12,ambientScale:0.88,lampScale:0.98,
    faceSleepOpacity:0,faceAwakeOpacity:1,
    eyeStroke:'#1a1008',mouthFill:'#1a1008',tongueFill:'#d06060',
    hintColor:'rgba(251,191,36,0.65)',hintOpacity:1,formOpacity:0,formScale:0.96,formTranslateY:6,
    eyebrowColor:'rgba(255,255,255,0)',
  },
  3: {
    bg:'#100e08',cardBg:'rgba(22,18,10,0.88)',cardBorder:'rgba(245,158,11,0.22)',cardShadow:'0 0 80px rgba(245,158,11,0.18), 0 20px 60px rgba(0,0,0,0.7), inset 0 0 30px rgba(255,240,180,0.04)',cardShadowActive:'0 0 120px rgba(245,158,11,0.28), 0 24px 70px rgba(0,0,0,0.75), inset 0 0 40px rgba(255,240,180,0.06)',cardGlow:'rgba(245,158,11,0.08)',
    shadeFill:'#5a3e18',shadeHighlight:'rgba(255,230,150,0.22)',
    poleFill:'#4a3820',poleHi:'#6a5030',baseFill:'#1e1a0e',
    cordStroke:'#9a7850',handleFill:'#e8c890',handleShadow:'rgba(245,158,11,0.45)',
    bulbFill:'#fff8ee',bulbGlowFill:'#ffecb0',bulbGlowOpacity:1,
    coneFill:'#ffecb0',coneOpacity:0.38,
    ambientRgb:'245,158,11',ambientOpacity:0.22,ambientScale:1.05,lampScale:1.0,
    faceSleepOpacity:0,faceAwakeOpacity:1,
    eyeStroke:'#1a1008',mouthFill:'#1a1008',tongueFill:'#d06060',
    hintColor:'rgba(245,158,11,0)',hintOpacity:0,formOpacity:1,formScale:1.0,formTranslateY:0,
    eyebrowColor:'rgba(160,140,100,0.7)',
  },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function cordPath(swing: number, pull: number): string {
  const endX = pull * 18;
  const endY = 272 + pull * CORD_MAX_DY;
  const c1x  = 149 + swing * 5;
  const c1y  = 198 + pull * 12;
  const c2x  = 151 - swing * 5 + pull * 6;
  const c2y  = 236 + pull * 22;
  return `M 150,175 C ${c1x},${c1y} ${c2x},${c2y} ${150 + endX},${endY}`;
}

function handleX(swing: number, pull: number): number {
  return 144 + swing * 3 + pull * 9;
}

function handleY(pull: number): number {
  return 272 + pull * CORD_MAX_DY;
}

function stageVars(stage: Stage, swing: number, pull: number): React.CSSProperties {
  const p = STAGE_PALETTE[stage];
  const scale = Number(p.lampScale) + swing * 0.008;
  return {
    '--lp-bg': p.bg,
    '--lp-card-bg': p.cardBg,
    '--lp-card-border': p.cardBorder,
    '--lp-card-shadow': p.cardShadow,
    '--lp-card-shadow-act': p.cardShadowActive,
    '--lp-card-glow': p.cardGlow,
    '--lp-shade-fill': p.shadeFill,
    '--lp-shade-hi': p.shadeHighlight,
    '--lp-pole-fill': p.poleFill,
    '--lp-pole-hi': p.poleHi,
    '--lp-base-fill': p.baseFill,
    '--lp-cord-stroke': p.cordStroke,
    '--lp-handle-fill': p.handleFill,
    '--lp-handle-shadow': p.handleShadow,
    '--lp-bulb-fill': p.bulbFill,
    '--lp-bulb-glow-fill': p.bulbGlowFill,
    '--lp-bulb-glow-op': p.bulbGlowOpacity,
    '--lp-cone-fill': p.coneFill,
    '--lp-cone-op': p.coneOpacity,
    '--lp-amb-rgb': p.ambientRgb,
    '--lp-amb-op': p.ambientOpacity,
    '--lp-amb-scale': p.ambientScale,
    '--lp-lamp-scale': `${scale}`,
    '--lp-face-sleep-op': p.faceSleepOpacity,
    '--lp-face-awake-op': p.faceAwakeOpacity,
    '--lp-eye-stroke': p.eyeStroke,
    '--lp-mouth-fill': p.mouthFill,
    '--lp-tongue-fill': p.tongueFill,
    '--lp-hint-color': p.hintColor,
    '--lp-hint-op': p.hintOpacity,
    '--lp-form-op': p.formOpacity,
    '--lp-form-scale': `${p.formScale}`,
    '--lp-form-ty': `${p.formTranslateY}px`,
    '--lp-eyebrow-color': p.eyebrowColor,
  } as React.CSSProperties;
}

function LoginPageInner(): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useSupabaseAuth();
  const google    = useGoogleSignIn();
  const emailIn  = useEmailSignIn();
  const emailUp  = useEmailSignUp();
  const signOut  = useSignOut();

  const [mode,   setMode]   = useState<Mode>('signin');
  const [email,  setEmail]  = useState('');
  const [pwd,    setPwd]    = useState('');
  const [stage,  setStage]  = useState<Stage>(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const [pull,   setPull]   = useState(0);
  const [swing,  setSwing]  = useState(0);
  const isDragging = useRef(false);
  const dragStartY  = useRef(0);
  const swingTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  const oauthError = search?.get('error') ?? null;
  const pending   = google.loading || emailIn.loading || emailUp.loading;
  const errorMessage =
    (typeof google.error === 'string' ? google.error : null) ??
    (typeof emailIn.error === 'string' ? emailIn.error : null) ??
    (typeof emailUp.error === 'string' ? emailUp.error : null) ??
    oauthError ??
    null;

  useEffect(() => {
    if (user !== null) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => {
    const m = search?.get('mode');
    if (m === 'signup') setMode('signup');
    else if (m === 'signin') setMode('signin');
  }, [search]);

  useEffect(() => {
    if (stage >= 2) return;
    if (email.length > 0 && pwd.length > 0) setStage(1);
    else if (email.length > 0 || pwd.length > 0) setStage(1);
    else setStage(0);
  }, [email, pwd, stage]);

  useEffect(() => {
    if (isDragging.current) {
      if (swingTimer.current) { clearInterval(swingTimer.current); swingTimer.current = null; }
      return;
    }
    swingTimer.current = setInterval(() => {
      setSwing(prev => {
        const next = prev * SWING_DAMPING;
        return Math.abs(next) < SWING_MIN ? 0 : next;
      });
    }, 16);
    return () => { if (swingTimer.current) { clearInterval(swingTimer.current); swingTimer.current = null; } };
  }, []);

  const activateLamp = useCallback(() => {
    setStage(2);
    setTimeout(() => setStage(3), 420);
    requestAnimationFrame(() => {
      setTimeout(() => emailRef.current?.focus(), 900);
    });
  }, []);

  const onCordPointerDown = useCallback((e: PointerEvent<SVGRectElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStartY.current = e.clientY;
    setSwing(s => s + 0.05);
  }, []);

  const onCordPointerMove = useCallback((e: PointerEvent<SVGRectElement>) => {
    if (!isDragging.current) return;
    const delta = (dragStartY.current - e.clientY) / PULL_FULL_PX;
    const p = clamp(delta, 0, 1);
    setPull(p);
    setSwing(clamp(delta * 0.06, -0.12, 0.12));
  }, []);

  const onCordPointerUp = useCallback((e: PointerEvent<SVGRectElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    isDragging.current = false;
    const wasActivated = pull >= PULL_ACTIVATE;
    setPull(0);
    if (wasActivated) {
      setSwing(s => s - pull * 0.3);
      activateLamp();
    } else {
      setSwing(s => s - 0.05);
    }
  }, [pull, activateLamp]);

  const onLampActivate = useCallback(() => {
    if (stage < 2) {
      setStage(s => (s + 1) as Stage);
      if (stage === 1) {
        requestAnimationFrame(() => {
          setTimeout(() => emailRef.current?.focus(), 600);
        });
      }
    }
  }, [stage]);

  const onSubmit = useCallback(async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (stage < 3 || !email.trim() || !pwd) return;
    if (mode === 'signin') {
      await emailIn.signIn(email.trim(), pwd);
      router.replace('/dashboard');
    } else {
      await emailUp.signUp(email.trim(), pwd);
    }
  }, [email, pwd, stage, mode, emailIn, emailUp, router]);

  const vars = stageVars(stage, swing, pull);

  return (
    <main className="lp" style={vars}>
      <style>{`
        @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap");
        .lp {
          --lp-bg:#070910;--lp-card-bg:rgba(8,11,22,0);--lp-card-border:rgba(255,255,255,0);--lp-card-shadow:transparent;--lp-card-shadow-act:transparent;--lp-card-glow:transparent;
          --lp-shade-fill:#1a1c26;--lp-shade-hi:rgba(255,255,255,0.03);
          --lp-pole-fill:#1c1f2a;--lp-pole-hi:#262936;--lp-base-fill:#0d0f18;
          --lp-cord-stroke:#2a2d3a;--lp-handle-fill:#363a4a;--lp-handle-shadow:rgba(0,0,0,0.5);
          --lp-bulb-fill:#0c0e18;--lp-bulb-glow-fill:#fffde7;--lp-bulb-glow-op:0;
          --lp-cone-fill:#fffde7;--lp-cone-op:0;
          --lp-amb-rgb:12,14,22;--lp-amb-op:0;--lp-amb-scale:0.55;--lp-lamp-scale:0.96;
          --lp-face-sleep-op:1;--lp-face-awake-op:0;
          --lp-eye-stroke:#0a0c14;--lp-mouth-fill:#0a0c14;--lp-tongue-fill:#c06060;
          --lp-hint-color:#3a3e52;--lp-hint-op:1;--lp-form-op:0;--lp-form-scale:0.94;--lp-form-ty:12px;
          --lp-eyebrow-color:rgba(255,255,255,0);
          background:var(--lp-bg);color:#fff;font-family:"Poppins",sans-serif;
          min-height:100dvh;min-height:100svh;
          display:grid;place-items:center;overflow:hidden;position:relative;
        }
        .lp-root{width:100%;max-width:1140px;padding:1.5rem 2rem;
          display:grid;grid-template-columns:minmax(280px,1.1fr) minmax(300px,0.9fr);
          align-items:center;gap:clamp(2rem,5vw,5rem);}
        .lp-ambient{position:absolute;inset:-80px;
          background:radial-gradient(ellipse 70% 60% at 50% 45%,rgba(var(--lp-amb-rgb),var(--lp-amb-op)) 0%,transparent 70%);
          transform:scale(var(--lp-amb-scale));pointer-events:none;border-radius:50%;z-index:0;
          transition:background 900ms cubic-bezier(0.4,0,0.2,1),transform 900ms cubic-bezier(0.4,0,0.2,1);}
        .lp-lamp-col{display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;z-index:1;}
        .lp-lamp-wrap{position:relative;width:100%;max-width:340px;
          transform:scale(var(--lp-lamp-scale));transform-origin:center 40%;
          transition:transform 700ms cubic-bezier(0.34,1.1,0.64,1);
          filter:drop-shadow(0 8px 32px rgba(0,0,0,0.75)) drop-shadow(0 2px 8px rgba(0,0,0,0.5));}
        .lp-svg{width:100%;overflow:visible;display:block;}
        .lp-shade{fill:var(--lp-shade-fill);transition:fill 700ms ease;}
        .lp-shade-hi{fill:var(--lp-shade-hi);transition:fill 700ms ease;pointer-events:none;}
        .lp-shade-click{fill:transparent;cursor:pointer;}
        .lp-pole{fill:var(--lp-pole-fill);transition:fill 700ms ease;}
        .lp-pole-hi{fill:var(--lp-pole-hi);transition:fill 700ms ease;}
        .lp-base{fill:var(--lp-base-fill);transition:fill 700ms ease;}
        .lp-bulb{fill:var(--lp-bulb-fill);transition:fill 700ms ease;}
        .lp-bulb-glow{fill:var(--lp-bulb-glow-fill);opacity:var(--lp-bulb-glow-op);transition:opacity 800ms ease;}
        .lp-cone{fill:var(--lp-cone-fill);opacity:var(--lp-cone-op);transition:opacity 900ms cubic-bezier(0.4,0,0.2,1);}
        .lp-cord{stroke:var(--lp-cord-stroke);stroke-width:3;fill:none;stroke-linecap:round;transition:stroke 600ms ease;filter:drop-shadow(0 1px 2px var(--lp-handle-shadow));}
        .lp-handle{fill:var(--lp-handle-fill);transition:fill 500ms ease;filter:drop-shadow(0 2px 4px var(--lp-handle-shadow));}
        .lp-face-sleep{opacity:var(--lp-face-sleep-op);transition:opacity 500ms cubic-bezier(0.4,0,0.2,1);}
        .lp-face-awake{opacity:var(--lp-face-awake-op);transition:opacity 500ms cubic-bezier(0.4,0,0.2,1);}
        .lp-hint{margin-top:1.75rem;font-size:0.78rem;color:var(--lp-hint-color);opacity:var(--lp-hint-op);
          letter-spacing:0.06em;text-align:center;transition:color 600ms ease,opacity 600ms ease;
          font-weight:500;min-height:1.2rem;user-select:none;}
        .lp-form-col{display:flex;flex-direction:column;align-items:stretch;position:relative;z-index:1;}
        .lp-card{background:var(--lp-card-bg);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
          border:1.5px solid var(--lp-card-border);border-radius:28px;
          padding:clamp(1.75rem,3.5vw,2.75rem);box-shadow:var(--lp-card-shadow);
          transition:background 600ms cubic-bezier(0.4,0,0.2,1),border-color 600ms ease,box-shadow 600ms ease,opacity 650ms cubic-bezier(0.4,0,0.2,1),transform 650ms cubic-bezier(0.34,1.0,0.64,1);
          opacity:var(--lp-form-op);transform:scale(var(--lp-form-scale)) translateY(var(--lp-form-ty));position:relative;overflow:hidden;}
        .lp-card::before{content:"";position:absolute;inset:-1px;border-radius:29px;background:var(--lp-card-glow);
          pointer-events:none;z-index:-1;opacity:0;transition:opacity 800ms ease;}
        .lp-card-active::before{opacity:1;}
        .lp-card-active{border-color:var(--lp-card-border)!important;box-shadow:var(--lp-card-shadow-act)!important;}
        .lp-title{font-family:"Space Grotesk",sans-serif;font-size:clamp(1.7rem,3.5vw,2.2rem);font-weight:700;
          letter-spacing:-0.03em;text-align:center;margin-bottom:0.3rem;line-height:1.15;color:#f5f0e8;}
        .lp-eyebrow{text-align:center;font-size:0.83rem;color:var(--lp-eyebrow-color);margin-bottom:1.8rem;
          line-height:1.5;transition:color 700ms ease;min-height:1.4rem;}
        .lp-google{width:100%;padding:0.88rem 1.2rem;border:1.5px solid rgba(255,255,255,0.08);border-radius:14px;
          background:rgba(255,255,255,0.03);color:#c8c0b8;font-size:0.95rem;font-weight:600;cursor:pointer;
          font-family:"Poppins",sans-serif;display:flex;align-items:center;justify-content:center;gap:0.75rem;
          margin-bottom:0.5rem;transition:background 250ms ease,border-color 250ms ease,transform 200ms ease;flex-shrink:0;}
        .lp-google:hover:not(:disabled){background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.17);transform:translateY(-1px);}
        .lp-google:disabled{opacity:0.45;cursor:not-allowed;transform:none;}
        .lp-google:focus-visible{outline:2px solid rgba(245,158,11,0.6);outline-offset:2px;}
        .lp-g-icon{display:inline-flex;align-items:center;justify-content:center;width:1.35rem;height:1.35rem;
          border-radius:999px;background:#fff;color:#0b0f14;font-weight:700;font-size:0.68rem;
          font-family:"Space Grotesk",sans-serif;flex-shrink:0;}
        .lp-divider{display:flex;align-items:center;gap:0.8rem;margin:1rem 0;color:#3a3e4a;
          font-size:0.73rem;letter-spacing:0.08em;text-transform:uppercase;}
        .lp-divider::before,.lp-divider::after{content:"";flex:1;height:1px;background:rgba(255,255,255,0.05);}
        .lp-field{display:flex;flex-direction:column;margin-bottom:0.95rem;}
        .lp-label{font-size:0.76rem;color:#4a5060;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;
          margin-bottom:0.4rem;font-family:"Space Grotesk",sans-serif;}
        .lp-input{background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.07);
          padding:0.88rem 1.1rem;border-radius:12px;color:#e8e0d8;font-family:"Poppins",sans-serif;
          font-size:0.97rem;outline:none;transition:border-color 280ms ease,box-shadow 280ms ease,background 280ms ease;width:100%;}
        .lp-input::placeholder{color:#3a4050;}
        .lp-input:focus{border-color:rgba(245,158,11,0.5);background:rgba(255,255,255,0.065);
          box-shadow:0 0 0 3px rgba(245,158,11,0.12),0 0 16px rgba(245,158,11,0.08);}
        .lp-input:disabled{opacity:0.5;cursor:not-allowed;}
        .lp-submit{width:100%;padding:0.92rem;border:none;border-radius:12px;background:#d97706;color:#fff;
          font-size:1rem;font-weight:700;cursor:pointer;font-family:"Poppins",sans-serif;margin-top:0.5rem;
          transition:background 400ms ease,filter 250ms ease,transform 220ms ease,box-shadow 280ms ease;letter-spacing:0.01em;
          flex-shrink:0;box-shadow:0 4px 16px rgba(217,119,6,0.35);}
        .lp-submit:hover:not(:disabled){background:#f59e0b;filter:brightness(1.1);transform:translateY(-2px);
          box-shadow:0 8px 28px rgba(245,158,11,0.5);}
        .lp-submit:active:not(:disabled){transform:translateY(0);filter:brightness(0.96);}
        .lp-submit:disabled{opacity:0.4;cursor:not-allowed;transform:none;filter:none;}
        .lp-submit:focus-visible{outline:2px solid rgba(245,158,11,0.7);outline-offset:2px;}
        .lp-error{margin-top:0.9rem;padding:0.7rem 1rem;border-radius:10px;
          background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.22);color:#fca5a5;
          font-size:0.82rem;text-align:center;line-height:1.4;}
        .lp-toggle{display:block;width:100%;margin-top:0.85rem;padding:0;background:none;border:none;
          color:#4a5060;font-size:0.83rem;cursor:pointer;font-family:"Poppins",sans-serif;
          transition:color 200ms ease;text-align:center;flex-shrink:0;}
        .lp-toggle:hover{color:#c0c8d8;}
        .lp-toggle:focus-visible{outline:2px solid rgba(245,158,11,0.5);outline-offset:2px;border-radius:4px;}
        @media(max-width:900px){.lp-root{grid-template-columns:1fr;gap:2.5rem;padding:1.5rem 1.25rem;max-width:520px;}
          .lp-lamp-col{flex-direction:row;gap:2rem;justify-content:center;align-items:center;}
          .lp-lamp-wrap{max-width:220px;}
          .lp-hint{margin-top:0;}
          .lp-form-col{align-items:center;}
          .lp-card{width:100%;max-width:440px;}}
        @media(max-width:520px){.lp-root{padding:1.25rem 1rem;gap:2rem;}
          .lp-lamp-wrap{max-width:170px;}
          .lp-lamp-col{gap:1.25rem;}
          .lp-card{padding:1.5rem 1.25rem;border-radius:22px;}}
        @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms!important;transition-duration:0.01ms!important;}}
        ::-webkit-scrollbar{width:6px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px;}
      `}</style>

      <div className="lp-root">
        <div className="lp-ambient" />

        <div className="lp-lamp-col">
          <div className="lp-lamp-wrap">
            <svg className="lp-svg" viewBox="0 0 300 460" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <filter id="cordFilter">
                  <feDropShadow dx="1" dy="1" stdDeviation="1.5" flood-color="rgba(0,0,0,0.6)" />
                </filter>
                <radialGradient id="bulbRad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#fffde7" stopOpacity="1" />
                  <stop offset="100%" stopColor="#fffde7" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="shadeHi" cx="40%" cy="25%" r="55%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
                  <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                </radialGradient>
                <linearGradient id="coneGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255,253,231,0.9)" />
                  <stop offset="55%" stopColor="rgba(255,253,231,0.25)" />
                  <stop offset="100%" stopColor="rgba(255,253,231,0)" />
                </linearGradient>
              </defs>
              <polygon points="65,178 235,178 400,460 -100,460" fill="url(#coneGrad)" className="lp-cone" />
              <ellipse cx="150" cy="412" rx="70" ry="21" className="lp-base" />
              <ellipse cx="150" cy="407" rx="68" ry="19" fill="rgba(255,255,255,0.02)" />
              <rect x="140" y="175" width="20" height="237" rx="2" className="lp-pole" />
              <rect x="144" y="175" width="6" height="237" rx="1" className="lp-pole-hi" />
              <path d={cordPath(swing, pull)} className="lp-cord" filter="url(#cordFilter)" />
              <rect className="lp-handle" x={handleX(swing, pull)} y={handleY(pull)} width="12" height="28" rx="6" ry="6"
                style={{transform:`rotate(${swing * 4}deg)`,transformOrigin:`${handleX(swing, pull) + 6}px ${handleY(pull) + 14}px`,
                  transition: isDragging.current ? 'none' : 'transform 500ms cubic-bezier(0.34,1.56,0.64,1)'}} />
              <rect x={handleX(swing, pull) + 2} y={handleY(pull) + 3} width="3" height="10" rx="1.5"
                fill="rgba(255,255,255,0.15)"
                style={{transform:`rotate(${swing * 4}deg)`,transformOrigin:`${handleX(swing, pull) + 6}px ${handleY(pull) + 14}px`,
                  transition: isDragging.current ? 'none' : 'transform 500ms cubic-bezier(0.34,1.56,0.64,1)'}} />
              <path d="M 88 52 Q 150 34 212 52 L 252 172 Q 150 196 48 172 Z" className="lp-shade" />
              <path d="M 88 52 Q 150 34 212 52 L 252 172 Q 150 196 48 172 Z" fill="url(#shadeHi)" className="lp-shade-hi" />
              <path d="M 88 52 Q 150 34 212 52 L 252 172 Q 150 196 48 172 Z" className="lp-shade-click"
                onClick={onLampActivate} role="button" tabIndex={0} aria-label="Activate lamp"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLampActivate(); }}} />
              <ellipse cx="150" cy="172" rx="94" ry="24" className="lp-bulb" />
              <ellipse cx="150" cy="168" rx="44" ry="18" fill="url(#bulbRad)" className="lp-bulb-glow" />
              <g className="lp-face-sleep">
                <path d="M 108 130 Q 120 144 132 130" stroke="var(--lp-eye-stroke)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
                <path d="M 168 130 Q 180 144 192 130" stroke="var(--lp-eye-stroke)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
              </g>
              <g className="lp-face-awake">
                <path d="M 108 127 Q 120 111 132 127" stroke="var(--lp-eye-stroke)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
                <path d="M 168 127 Q 180 111 192 127" stroke="var(--lp-eye-stroke)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
                <path d="M 120 157 Q 150 196 180 157 Z" fill="var(--lp-mouth-fill)" />
                <path d="M 136 167 Q 150 190 164 167 Z" fill="var(--lp-tongue-fill)" />
              </g>
              <rect x="118" y="168" width="64" height="160" fill="transparent"
                style={{cursor:'grab',touchAction:'none'}}
                onPointerDown={onCordPointerDown}
                onPointerMove={onCordPointerMove}
                onPointerUp={onCordPointerUp}
                onPointerCancel={onCordPointerUp} />
            </svg>
          </div>
          <p className="lp-hint" aria-live="polite">
            {stage === 0 ? '\u2191 pull the cord to begin'
              : stage === 1 ? 'keep pulling or tap the lamp'
              : stage === 2 ? 'almost there\u2026'
              : ''}
          </p>
        </div>

        <div className="lp-form-col">
          <div className={`lp-card${stage === 3 ? ' lp-card-active' : ''}`}>
            <h1 className="lp-title">
              {mode === 'signin' ? 'Welcome back' : 'Create account'}
            </h1>
            <p className="lp-eyebrow">
              {mode === 'signin'
                ? 'Sign in to continue your learning journey'
                : 'Set up your account to get started'}
            </p>

            <button type="button" className="lp-google" onClick={() => google.signIn()} disabled={pending}>
              <span className="lp-g-icon" aria-hidden="true">G</span>
              {google.loading ? 'Redirecting\u2026' : 'Continue with Google'}
            </button>

            <div className="lp-divider"><span>or</span></div>

            <form onSubmit={onSubmit} noValidate>
              <div className="lp-field">
                <label className="lp-label" htmlFor="lp-email">Email address</label>
                <input ref={emailRef} id="lp-email" type="email" autoComplete="email"
                  placeholder="you@example.com" className="lp-input"
                  value={email} onChange={e => setEmail(e.target.value)} required disabled={stage < 3} />
              </div>
              <div className="lp-field">
                <label className="lp-label" htmlFor="lp-pwd">Password</label>
                <input id="lp-pwd" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} className="lp-input"
                  value={pwd} onChange={e => setPwd(e.target.value)} required
                  minLength={mode === 'signup' ? 8 : 1} disabled={stage < 3} />
              </div>
              <button type="submit" className="lp-submit" disabled={pending || stage < 3}>
                {emailIn.loading ? 'Signing in\u2026' : emailUp.loading ? 'Creating account\u2026' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
              {errorMessage ? <p className="lp-error" role="alert">{errorMessage}</p> : null}
            </form>

            <button type="button" className="lp-toggle"
              onClick={() => setMode(m => m === 'signin' ? 'signup' : 'signin')} disabled={pending}>
              {mode === 'signin' ? "Don't have an account? Sign up free" : 'Already have an account? Sign in'}
            </button>

            {user !== null ? (
              <button type="button" className="lp-toggle"
                onClick={() => signOut.signOut()} style={{marginTop:'0.5rem',color:'#7a3a3a'}}>
                Sign out of this device
              </button>
            ) : null}
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
