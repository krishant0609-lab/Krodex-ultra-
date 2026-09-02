// KRODEX web — Vitest config.
// React Testing Library needs a DOM environment; we use jsdom.
// @vitejs/plugin-react handles JSX. Tests live under src/**/__tests__.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
