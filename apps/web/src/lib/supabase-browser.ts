/**
 * KRODEX web — Supabase browser client.
 *
 * Real Supabase Auth for the production web app. The browser
 * client is created once per session; the access token it mints
 * (after Google OAuth or email/password) is a real ES256 Supabase
 * access token, which the KRODEX API prehandler validates
 * server-side via `supabase.auth.getUser(jwt)`.
 *
 * Two env vars drive the client (both public, prefixed
 * `NEXT_PUBLIC_`):
 *
 *   - NEXT_PUBLIC_SUPABASE_URL  — the project URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY — the publishable/anon key
 *
 * The anon key is public; RLS still protects every row.
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Configure it in apps/web/.env.local.',
    );
  }
  if (!anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Configure it in apps/web/.env.local.',
    );
  }

  cached = createBrowserClient(url, anonKey);
  return cached;
}
