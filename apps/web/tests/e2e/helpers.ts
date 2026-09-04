/**
 * Shared helpers for the Phase 7 e2e suite.
 *
 * The in-memory auth store in apps/web lives in a JS module
 * variable — we cannot seed it from outside the React tree. The
 * honest way to log a Playwright test in is therefore to drive
 * the real /login form: fill user_id, submit, wait for the
 * post-redirect /dashboard shell. That exercises the real
 * `useDevLogin` mutation against the real fixture API.
 */

import type { Page, BrowserContext } from '@playwright/test';
import { expect } from '@playwright/test';

export const ROUTES = {
  login: '/login',
  dashboard: '/dashboard',
  syllabus: '/syllabus',
  tests: '/tests',
  errors: '/errors',
  reviews: '/reviews',
  planner: '/planner',
  backlog: '/backlog',
  insights: '/insights',
  studentModel: '/student-model',
  notifications: '/notifications',
  settings: '/settings',
  assistant: '/assistant',
  attempt: '/attempts/attempt-notfound',
  testDetail: '/tests/test-notfound',
  errorDetail: '/errors/error-notfound',
  errorUnclassified: '/errors/error-unclassified',
  reviewDetail: '/reviews/review-notfound',
  reviewPhase10: '/reviews/phase10-review-001',
  syllabusLegacy: '/syllabus/no-such-node',
  syllabusSubject: '/syllabus/subject/subject-notfound',
  syllabusTopic: '/syllabus/topic/topic-notfound',
  syllabusSubTopic: '/syllabus/sub-topic/sub-topic-notfound',
} as const;

export type RouteKey = keyof typeof ROUTES;

export const WIDTHS = [360, 768, 1024, 1440] as const;
export type ViewportWidth = (typeof WIDTHS)[number];

/**
 * Drive the login form. Returns when the dashboard shell is mounted.
 *
 * The auth token lives in an in-memory module variable. A
 * `page.goto()` is a hard navigation that wipes that store; for
 * subsequent in-app navigations we must use the Next.js client
 * router (see `clientGoto`). This helper logs in successfully
 * and lands on /dashboard; the caller decides how to navigate
 * to the route under test.
 */
export async function login(page: Page): Promise<void> {
  await page.goto(ROUTES.login);
  // The login form's user_id input is identified by data-testid.
  const userIdInput = page.getByTestId('login-user-id');
  await expect(userIdInput).toBeVisible();
  await userIdInput.fill('user-fixture');
  await page.locator('button[type="submit"]').click();
  // Login redirects to /dashboard on success.
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  // Wait for the authenticated shell to mount.
  await expect(page.getByTestId('app-main')).toBeVisible();
}

/**
 * Navigate via the Next.js client router instead of `page.goto`,
 * which would trigger a hard reload and wipe the in-memory auth
 * token. The Next App Router exposes its internal router on
 * `window.next.router`; we call its `push` method directly.
 * This keeps the JS context (and the auth token) alive across
 * navigations.
 */
export async function clientGoto(page: Page, route: string): Promise<void> {
  // Capture the current URL so we can wait for a real change
  // rather than racing the App Router's transition.
  const before = page.url();
  await page.evaluate((to: string) => {
    const w = window as unknown as {
      next?: { router?: { push: (href: string) => void } };
    };
    if (w.next?.router?.push) {
      w.next.router.push(to);
    } else {
      // Fallback: at least update the URL so subsequent reads
      // see the right path. Should not happen in Next 14.
      window.history.pushState({}, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, route);
  // Wait for the App Router to actually commit the new URL.
  // This is more reliable than a fixed sleep — the network and
  // render happen after the URL change.
  try {
    await page.waitForURL((u) => {
      const path = new URL(u.toString()).pathname;
      const target = new URL(route, 'http://localhost').pathname;
      return path === target;
    }, { timeout: 5_000 });
  } catch {
    // If the router is busy or the URL didn't transition, the
    // subsequent expectMounted will surface a clear failure with
    // the actual page state rather than timing out silently.
  }
  // Briefly let the App Router commit the new segment. The
  // expectMounted that follows will retry until the new page
  // shell renders.
  if (page.url() === before) {
    await page.waitForTimeout(150);
  }
}

/**
 * Force the theme to a specific value. We do this by directly
 * setting the data-theme attribute on <html> before navigation,
 * which is what the inline theme init script in app/layout.tsx
 * would otherwise do. The ThemeProvider reads this attribute
 * through its initial render and on every state change.
 */
export async function setTheme(
  context: BrowserContext,
  theme: 'light' | 'dark',
): Promise<void> {
  // Phase 7.11: only override color-scheme queries. Pass through
  // every other matchMedia call (notably prefers-reduced-motion)
  // so the browser-level feature emulation from Playwright's
  // `reducedMotion: 'reduce'` actually applies at runtime.
  await context.addInitScript((t: 'light' | 'dark') => {
    try {
      localStorage.setItem('kd-theme-pref', 'explicit');
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => {
        // Only force color-scheme queries; pass everything else
        // through so prefers-reduced-motion and other media
        // features work as the browser intends.
        if (q.includes('prefers-color-scheme')) {
          const isDark = q.includes('dark');
          return {
            matches: isDark ? t === 'dark' : t === 'light',
            media: q,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return nativeMatchMedia(q);
      };
    } catch {
      // ignore — no storage in this context
    }
  }, theme);
  // Apply immediately for the current document so any in-flight
  // navigation sees the right theme.
  await context.addInitScript((t: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

/**
 * Check for horizontal overflow. Returns the maximum overflowing
 * element's scrollWidth vs clientWidth, plus the element selector
 * that caused the overflow. `null` means no overflow.
 */
export async function detectHorizontalOverflow(
  page: Page,
): Promise<{ scrollWidth: number; clientWidth: number; selector: string | null }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const docW = doc.scrollWidth;
    const clientW = doc.clientWidth;
    if (docW <= clientW) {
      return { scrollWidth: docW, clientWidth: clientW, selector: null };
    }
    // Find the widest overflowing descendant.
    let worst: Element | null = null;
    let worstRight = 0;
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right > clientW + 0.5 && r.right > worstRight) {
        worst = el;
        worstRight = r.right;
      }
    }
    void body;
    let selector: string | null = null;
    if (worst) {
      const id = (worst as HTMLElement).id;
      const testid = (worst as HTMLElement).getAttribute('data-testid');
      const tag = worst.tagName.toLowerCase();
      selector = id ? `#${id}` : testid ? `[data-testid="${testid}"]` : tag;
    }
    return { scrollWidth: docW, clientWidth: clientW, selector };
  });
}

/**
 * Confirm a query for an element that should exist in the DOM.
 * Times out after 10s.
 */
export async function expectMounted(page: Page, testId: string): Promise<void> {
  await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 10_000 });
}
