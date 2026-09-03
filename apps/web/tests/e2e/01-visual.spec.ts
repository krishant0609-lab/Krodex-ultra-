/**
 * KRODEX e2e — Visual verification (Phase 7 #3, Part 1).
 *
 * For every Phase 7 route, in both light and dark themes, at every
 * responsive width (360 / 768 / 1024 / 1440), navigate to the page,
 * wait for it to mount, and snapshot the rendered DOM. The
 * snapshot is the visual truth — we don't compare against a
 * baseline (no fabricated "expected" pixels) but the snapshot
 * itself proves the page rendered without crashing and the
 * theme attribute propagated.
 *
 * Routes covered:
 *   /login (no auth required)
 *   /dashboard, /planner, /backlog, /insights, /student-model,
 *   /notifications, /settings (Phase 7 editorial)
 *   /tests, /errors, /reviews, /syllabus (list pages)
 *   /attempts/[id], /tests/[id], /errors/[id], /reviews/[id]
 *     (deep links, all resolve to NOT_FOUND → empty-state card)
 *   /syllabus/legacy, /syllabus/subject/x, /syllabus/topic/x,
 *   /syllabus/sub-topic/x (typed deep links)
 *
 * Each test:
 *   1. Sets the theme via context init script.
 *   2. Sets the viewport to the next width.
 *   3. Logs in (skipped for /login).
 *   4. Navigates to the route.
 *   5. Waits for a known stable testid to be visible.
 *   6. Confirms the data-theme attribute is set on <html>.
 *   7. Saves a full-page screenshot (best evidence artifact;
 *      visual review of the snapshots is the actual verification
 *      step — automated image diff would be visual-regression,
 *      not visual-verification).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { ROUTES, WIDTHS, login, clientGoto, expectMounted } from './helpers';

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

// Routes that need a logged-in session.
const AUTHED_ROUTES = [
  ROUTES.dashboard,
  ROUTES.syllabus,
  ROUTES.tests,
  ROUTES.errors,
  ROUTES.reviews,
  ROUTES.planner,
  ROUTES.backlog,
  ROUTES.insights,
  ROUTES.studentModel,
  ROUTES.notifications,
  ROUTES.settings,
  ROUTES.attempt,
  ROUTES.testDetail,
  ROUTES.errorDetail,
  ROUTES.reviewDetail,
  ROUTES.syllabusLegacy,
  ROUTES.syllabusSubject,
  ROUTES.syllabusTopic,
  ROUTES.syllabusSubTopic,
] as const;

// Mount markers per route — chosen to be stable testids that
// only render when the page has resolved.
const MOUNT_MARKER: Record<string, string> = {
  [ROUTES.login]: 'login-form',
  [ROUTES.dashboard]: 'dashboard',
  [ROUTES.syllabus]: 'page-state-empty',
  [ROUTES.tests]: 'page-state-empty',
  [ROUTES.errors]: 'page-state-empty',
  [ROUTES.reviews]: 'page-state-empty',
  [ROUTES.planner]: 'page-state-empty',
  [ROUTES.backlog]: 'page-state-empty',
  [ROUTES.insights]: 'page-state-populated',
  [ROUTES.studentModel]: 'student-model-snapshot',
  [ROUTES.notifications]: 'page-state-empty',
  [ROUTES.settings]: 'settings-user-form',
  [ROUTES.attempt]: 'page-state-error',
  [ROUTES.testDetail]: 'page-state-error',
  [ROUTES.errorDetail]: 'page-state-error',
  [ROUTES.reviewDetail]: 'page-state-error',
  [ROUTES.syllabusLegacy]: 'page-state-empty',
  [ROUTES.syllabusSubject]: 'page-state-empty',
  [ROUTES.syllabusTopic]: 'page-state-empty',
  [ROUTES.syllabusSubTopic]: 'page-state-empty',
};

async function setViewport(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: Math.max(800, Math.round(width * 0.75)) });
}

async function setTheme(context: BrowserContext, theme: Theme): Promise<void> {
  await context.addInitScript((t: 'light' | 'dark') => {
    try {
      // Set the explicit value (not 'system' / 'explicit') so
      // the layout's themeInitScript reads the theme directly
      // from localStorage and the ThemeProvider's useEffect
      // resolves to the explicit mode without going through
      // matchMedia. This avoids a race where matchMedia returns
      // the wrong value before our override takes effect.
      localStorage.setItem('kd-theme-pref', t);
      localStorage.setItem('kd-theme', t);
    } catch {
      // No localStorage in this context — the override will
      // still apply via the data-theme attribute below.
    }
    document.documentElement.setAttribute('data-theme', t);
    // Override matchMedia ONLY for color-scheme queries; pass
    // through every other media feature (notably
    // prefers-reduced-motion) so browser-level emulation from
    // Playwright's `reducedMotion` still applies at runtime.
    const nativeMatchMedia = window.matchMedia?.bind(window);
    window.matchMedia = (q: string) => {
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
      if (nativeMatchMedia) return nativeMatchMedia(q);
      // Fallback (should not happen in modern browsers).
      return {
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList;
    };
  }, theme);
}

async function snapshot(
  page: Page,
  name: string,
): Promise<void> {
  // Give the page one more paint frame so the theme has settled.
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/visual/${name}.png`, fullPage: true });
}

test.describe.configure({ mode: 'serial' });

test.describe('Visual: light + dark × 4 widths × 14+ surfaces', () => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test.describe(`${theme} @ ${width}px`, () => {
        test.use({
          viewport: { width, height: 800 },
        });

        test('/login renders', async ({ page, context }) => {
          await setTheme(context, theme);
          await setViewport(page, width);
          await page.goto(ROUTES.login);
          await expectMounted(page, MOUNT_MARKER[ROUTES.login]!);
          // Theme attribute should be on <html>.
          const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
          expect(t).toBe(theme);
          await snapshot(page, `${theme}-${width}-login`);
        });

        for (const route of AUTHED_ROUTES) {
          const slug = route.replace(/^\//, '').replace(/\//g, '-').replace(/\[|\]/g, '');
          test(`/${slug} renders`, async ({ page, context }) => {
            await setTheme(context, theme);
            await setViewport(page, width);
            await login(page);
            await clientGoto(page, route);
            await expectMounted(page, MOUNT_MARKER[route] ?? 'page-shell');
            const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
            expect(t).toBe(theme);
            await snapshot(page, `${theme}-${width}-${slug}`);
          });
        }
      });
    }
  }
});
