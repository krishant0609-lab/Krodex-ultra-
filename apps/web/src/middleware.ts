/**
 * KRODEX web — edge middleware.
 *
 * Phase 6 deliberately ships an empty pass-through middleware:
 *
 *   - The dev-token auth model is client-side only. The bearer
 *     token lives in an in-memory JS variable, which is not visible
 *     to the edge runtime.
 *   - Server-side auth (HttpOnly session cookies + RLS-aware SSR) is
 *     a Phase 7+ concern per Implementation Plan §291.
 *   - The authenticated route shell `src/app/(app)/layout.tsx` is the
 *     Phase 6 client-side redirect that protects all `(app)/*` routes.
 *
 * This file exists so the auth-guard surface is documented in the
 * repo; when Phase 7+ introduces session cookies, the cookie check
 * belongs here.
 */

import { NextResponse, type NextRequest } from 'next/server';

export function middleware(_req: NextRequest): NextResponse {
  return NextResponse.next();
}

export const config = {
  // Match everything except static assets, the public favicon, and
  // the auth login shell (which is the redirect target).
  matcher: ['/((?!_next/|favicon.ico|login).*)'],
};
