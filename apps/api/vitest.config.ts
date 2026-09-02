import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: false,
    // Phase 1: no live DB available in the current environment.
    // Tests that require a live Supabase/Postgres instance are gated
    // behind LIVE_DB=1 so they are skipped by default and run when
    // `supabase start` is available (locally or in CI with Docker).
    env: {
      LIVE_DB: process.env.LIVE_DB ?? '0',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/server.ts'],
    },
  },
});
