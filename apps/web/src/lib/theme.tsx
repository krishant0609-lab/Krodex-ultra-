/**
 * KRODEX web — theme provider.
 *
 * Per Phase 7 plan C1: light-first theme, dark opt-in.
 * Per C14: theme toggle visible in nav footer (desktop) + More
 * sheet (mobile).
 *
 * Mechanism (Class B):
 *  - On first mount, read from localStorage key "kd-theme".
 *  - If absent, fall back to prefers-color-scheme (with "light"
 *    as the default per Implementation Plan §293: "Light-first").
 *  - Apply by setting data-theme on documentElement, which
 *    resolves the CSS custom properties in styles/tokens.css.
 *  - Theme is presentation-only; it does not touch auth or
 *    server state.
 *
 * SSR safety:
 *  - The provider renders with no theme attribute on first paint
 *    so server and client agree (no hydration mismatch).
 *  - The effect runs only on the client.
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark';
type ThemePreference = ThemeMode | 'system';

const STORAGE_KEY = 'kd-theme';
const PREF_KEY = 'kd-theme-pref';

interface ThemeContextValue {
  /** What the user has chosen ("system" means follow OS pref). */
  preference: ThemePreference;
  /** Resolved mode actually applied to the document. */
  resolved: ThemeMode;
  setPreference: (next: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(PREF_KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

function resolveSystemMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeToDocument(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  // Start with a stable default to avoid hydration mismatch.
  // The effect below will reconcile on mount.
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<ThemeMode>('light');

  // Reconcile on mount: read storage + system pref, apply.
  useEffect(() => {
    const pref = readStoredPreference();
    setPreferenceState(pref);
    const mode = pref === 'system' ? resolveSystemMode() : pref;
    setResolved(mode);
    applyThemeToDocument(mode);
  }, []);

  // When the user changes their preference, persist + apply.
  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PREF_KEY, next);
    }
    const mode = next === 'system' ? resolveSystemMode() : next;
    setResolved(mode);
    applyThemeToDocument(mode);
  }, []);

  // Listen for OS-level scheme changes when preference is "system".
  useEffect(() => {
    if (preference !== 'system') return;
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      const mode: ThemeMode = mq.matches ? 'dark' : 'light';
      setResolved(mode);
      applyThemeToDocument(mode);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const toggle = useCallback(() => {
    // Toggle between explicit light and dark (not system).
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
