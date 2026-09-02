/**
 * KRODEX web — in-memory auth store.
 *
 * Phase 6 deliberately keeps the bearer token in a JS module variable
 * (NOT localStorage, NOT document.cookie). Per TRD §6, session auth
 * belongs in HttpOnly cookies; the dev-token path is a dev convenience
 * used in tests + early UI work, and a memory-only store avoids
 * persisting a long-lived token in XSS-reachable storage.
 *
 * Tradeoffs:
 *  - Pro: no XSS surface for the token
 *  - Pro: clears on full-page refresh (acceptable for Phase 6 dev
 *    convenience; the dev-token endpoint can re-mint in one click)
 *  - Con: full-page navigations require re-auth via /login
 *
 * Class A: in-memory storage is a deterministic derivation of TRD §6
 * for the dev-token path. Phase 7+ may move session auth to HttpOnly
 * cookies; that is out of scope for Phase 6.
 */

let token: string | null = null;
let userId: string | null = null;
let email: string | null = null;
let expiresAt: string | null = null;

export function getToken(): string | null {
  return token;
}

export function getUserId(): string | null {
  return userId;
}

export function getEmail(): string | null {
  return email;
}

export function getExpiresAt(): string | null {
  return expiresAt;
}

export interface SetAuthInput {
  token: string;
  userId: string;
  email?: string | null;
  expiresAt?: string | null;
}

export function setAuth(input: SetAuthInput): void {
  token = input.token;
  userId = input.userId;
  email = input.email ?? null;
  expiresAt = input.expiresAt ?? null;
}

export function clearAuth(): void {
  token = null;
  userId = null;
  email = null;
  expiresAt = null;
}

export function isAuthenticated(): boolean {
  return token !== null;
}
