/**
 * Client-side auth state store.
 * Reads session from localStorage. Replace with real Supabase session
 * when the Supabase client package is available.
 */

const SESSION_KEY = 'kd_session';

export interface Session {
  userId: string;
  email: string;
  name?: string;
}

function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function getCurrentUser(): Session | null {
  return getSession();
}

export function setSession(session: Session | null): void {
  if (typeof window === 'undefined') return;
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}
