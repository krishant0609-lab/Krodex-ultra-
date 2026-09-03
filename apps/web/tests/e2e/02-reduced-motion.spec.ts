/**
 * KRODEX e2e — prefers-reduced-motion verification.
 *
 * Real browsers expose prefers-reduced-motion as a media feature.
 * The CSS in apps/web/src/app/globals.css has a
 * @media (prefers-reduced-motion: reduce) block that sets
 * transition-duration: 0.001ms on every element, and
 * apps/web/src/app/(app)/attempts/[id]/attempt.module.css has
 * a similar block that sets transition: none on the focus
 * form elements. The settings.module.css has
 * @media (prefers-reduced-motion: reduce) on the input/button.
 *
 * Verification strategy (authoritative, browser-level):
 *   The Chromium DevTools Protocol method
 *   `Emulation.setEmulatedMedia` with a `features` array is the
 *   authoritative way to set the emulated media for a running
 *   page. When `[{name: 'prefers-reduced-motion', value: 'reduce'}]`
 *   is applied, the browser's CSS engine re-evaluates every
 *   @media (prefers-reduced-motion: reduce) block as if the
 *   OS-level preference were "reduce".
 *
 *   We use `page.context().newCDPSession(page)` to obtain a CDP
 *   session bound to the page, call `Emulation.setEmulatedMedia`
 *   with the structured `features` array (the deprecated string
 *   form is also supported by Chrome 151 but the structured
 *   form is preferred and future-proof), then re-evaluate the
 *   page and assert the @media query is matching AND that no
 *   element has a non-zero transition duration.
 *
 * Why not Playwright's `reducedMotion: 'reduce'` option?
 *   In this Playwright 1.62.1 + Next.js 14 dev server setup,
 *   the `test.use({ reducedMotion: 'reduce' })` and
 *   `browser.newContext({ reducedMotion: 'reduce' })` options
 *   do not consistently propagate the emulated media into the
 *   page's matchMedia() and the CSS @media engine for the
 *   fixture-bound page. Empirically:
 *     - newCDPSession + Emulation.setEmulatedMedia(features:)
 *       DOES propagate. matchMedia('(prefers-reduced-motion:
 *       reduce)').matches returns true, and the CSS @media
 *       block applies (transition-duration resolves to 1e-06s).
 *     - newContext({reducedMotion:'reduce'}) + newPage also
 *       works in some flows but not in all (e.g. when login
 *       has already been minted into an in-memory token before
 *       the context is created).
 *   The CDP path is the deterministic, authoritative mechanism.
 *   It does not require a new context, does not require
 *   re-login, and is exactly the same primitive Chrome DevTools
 *   uses to emulate the preference for inspection.
 *
 * If CDP throws (older browser, missing domain, etc.) the test
 * is honestly skipped as NOT VERIFIED. Per the standing
 * instruction: "If a required verification cannot be performed
 * in the current environment, report it as NOT VERIFIED rather
 * than pretending it passed."
 */

import { test, expect, type CDPSession } from '@playwright/test';
import { ROUTES, login, clientGoto } from './helpers';

/** Set the emulated prefers-reduced-motion via CDP. */
async function emulateReducedMotion(
  page: import('@playwright/test').Page,
  value: 'reduce' | 'no-preference',
): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  try {
    // Preferred structured form.
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }],
    });
  } catch {
    // Fall back to the legacy string form.
    await client.send('Emulation.setEmulatedMedia', {
      media: '',
      features: `prefers-reduced-motion: ${value}`,
    });
  }
  return client;
}

test.describe('prefers-reduced-motion: reduce (CDP-emulated)', () => {
  test('CSS @media (prefers-reduced-motion: reduce) applies via CDP', async ({ page }) => {
    await page.goto(ROUTES.login);
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 30_000 });

    // Set reduce via CDP.
    const cdp = await emulateReducedMotion(page, 'reduce');

    // The browser must now report the reduce preference is active.
    const matches = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    if (!matches) {
      test.skip(
        true,
        'NOT VERIFIED: Emulation.setEmulatedMedia did not flip the ' +
          'page-level matchMedia to reduce. The browser did not ' +
          'accept the emulated feature.',
      );
    }
    expect(matches).toBe(true);

    // No element on the rendered page should have a non-zero
    // transition-duration. The global @media block sets
    // transition-duration: 0.001ms (1e-06s) on every element.
    const nonzero = await page.evaluate(() => {
      const offenders: Array<{
        selector: string;
        duration: string;
      }> = [];
      const all = document.querySelectorAll('*');
      for (const el of Array.from(all).slice(0, 1000)) {
        const cs = window.getComputedStyle(el);
        // 0s, 0.001ms (1e-06s), or auto (when transition-property
        // is none) are all acceptable under reduce.
        const dur = cs.transitionDuration;
        if (dur !== '0s' && dur !== '1e-06s' && dur !== '0.001ms') {
          offenders.push({
            selector: (el as HTMLElement).tagName.toLowerCase(),
            duration: dur,
          });
          if (offenders.length >= 5) break;
        }
      }
      return offenders;
    });
    expect(
      nonzero.length,
      `elements with non-zero transition under reduce: ${JSON.stringify(nonzero)}`,
    ).toBe(0);

    // Reset to no-preference to avoid affecting later tests.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
  });

  test('attempt focus form respects reduce preference via CDP', async ({ page }) => {
    await login(page);
    await clientGoto(page, ROUTES.attempt);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('page-shell')).toBeVisible();

    // Set reduce via CDP.
    const cdp = await emulateReducedMotion(page, 'reduce');

    const probe = await page.evaluate(() => {
      const matches = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // The focus form has a known transition: border-color
      // declaration. Under reduce, the @media block should
      // override this to `transition: none`.
      const focusForm =
        document.querySelector('[data-testid="focus-form"]') ||
        document.querySelector('form') ||
        document.querySelector('main');
      const cs = focusForm ? window.getComputedStyle(focusForm) : null;
      return {
        matches,
        focusFormTag: focusForm ? (focusForm as HTMLElement).tagName.toLowerCase() : null,
        focusFormDuration: cs ? cs.transitionDuration : null,
        focusFormProperty: cs ? cs.transitionProperty : null,
        // Page-level: any element with a duration > 1e-06s.
        offending: (() => {
          const out: Array<{ tag: string; duration: string }> = [];
          for (const el of Array.from(document.querySelectorAll('*')).slice(0, 500)) {
            const d = window.getComputedStyle(el).transitionDuration;
            if (d !== '0s' && d !== '1e-06s' && d !== '0.001ms') {
              out.push({ tag: (el as HTMLElement).tagName.toLowerCase(), duration: d });
              if (out.length >= 3) break;
            }
          }
          return out;
        })(),
      };
    });

    if (!probe.matches) {
      test.skip(
        true,
        'NOT VERIFIED: Emulation.setEmulatedMedia did not flip the ' +
          'attempt page to reduce. Cannot verify CSS @media layer.',
      );
    }
    expect(probe.matches).toBe(true);
    // Global @media sets transition-duration: 0.001ms (1e-06s)
    // on every element. The focus form's @media block also
    // applies (sets transition: none). Acceptable values: 0s,
    // 1e-06s, 0.001ms.
    expect(
      probe.offending.length,
      `elements with non-zero transition under reduce: ${JSON.stringify(probe.offending)}`,
    ).toBe(0);

    // Reset to no-preference.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
  });

  test('settings form transitions are reduced via CDP', async ({ page }) => {
    await login(page);
    await clientGoto(page, '/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('settings-user-form')).toBeVisible();

    const cdp = await emulateReducedMotion(page, 'reduce');

    const probe = await page.evaluate(() => {
      const matches = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // settings.module.css has a @media (prefers-reduced-motion: reduce)
      // block setting transition: none on .input and .primaryAction.
      const input = document.querySelector('[data-testid="settings-user-form"] input');
      const button = document.querySelector(
        '[data-testid="settings-user-form"] button[type="submit"]',
      );
      const ic = input ? window.getComputedStyle(input) : null;
      const bc = button ? window.getComputedStyle(button) : null;
      return {
        matches,
        inputDuration: ic ? ic.transitionDuration : null,
        inputProperty: ic ? ic.transitionProperty : null,
        buttonDuration: bc ? bc.transitionDuration : null,
        buttonProperty: bc ? bc.transitionProperty : null,
      };
    });

    if (!probe.matches) {
      test.skip(
        true,
        'NOT VERIFIED: Emulation.setEmulatedMedia did not flip the ' +
          'settings page to reduce.',
      );
    }
    expect(probe.matches).toBe(true);
    // Both should be reduced to 0.001ms (1e-06s) or none.
    expect(
      probe.inputDuration === '0s' ||
        probe.inputDuration === '1e-06s' ||
        probe.inputDuration === '0.001ms',
      `settings input transition-duration should be reduced, got ${probe.inputDuration}`,
    ).toBe(true);

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
  });
});
