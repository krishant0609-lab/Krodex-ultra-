/**
 * KRODEX web — Vitest test setup.
 *
 * Wires @testing-library/jest-dom matchers and resets modules that
 * hold module-level state between tests (the auth store).
 *
 * jsdom does not implement window.matchMedia; the ThemeProvider
 * uses it to resolve the system theme, so we polyfill a minimal
 * implementation here. The polyfill returns a no-op MediaQueryList
 * with `matches: false` (light) and add/removeEventListener stubs.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { clearAuth } from '../lib/auth-store';

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  clearAuth();
});
