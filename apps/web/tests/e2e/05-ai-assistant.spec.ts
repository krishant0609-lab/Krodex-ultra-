/**
 * KRODEX web — Phase 8 e2e: /assistant.
 *
 * Drives the /assistant page through the real Next dev server
 * against the in-process fixture API. The page must:
 *
 *   1. Render the idle form on first load.
 *   2. On Ask with seed=ai-assistant, render the answer text,
 *      the evidence list (one per source), and the proposal
 *      CTA with Apply / Discard buttons.
 *   3. On Apply, fire POST /assistant/proposals/:id/confirm
 *      with { confirmed: true } and surface the honest
 *      "Applied" band.
 *   4. On Discard, fire the same endpoint with
 *      { confirmed: false } and surface the "Discarded" band.
 *   5. On seed=ai-assistant-empty, render the answer with
 *      "did not cite any specific records" note and no
 *      proposal CTA.
 *   6. On seed=ai-assistant-unavailable, render the
 *      deterministic fallback block (no fabricated answer).
 *
 * The AI is non-authoritative; the only mutations the page
 * may fire are the two Phase 8 endpoints. We use
 * `clientGoto` for in-app navigation so the in-memory
 * auth token survives the navigation.
 */

import { test, expect } from '@playwright/test';
import { ROUTES, login, clientGoto, setTheme } from './helpers';

const FIXTURE_URL = 'http://localhost:4100';

async function setSeed(seed: string): Promise<void> {
  const res = await fetch(`${FIXTURE_URL}/__fixture/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed }),
  });
  if (!res.ok) {
    throw new Error(`Failed to set fixture seed to ${seed}: ${res.status}`);
  }
}

test.describe('Phase 8 — /assistant', () => {
  test.beforeEach(async ({ context }) => {
    // Pin to a single theme so the editorial layer is stable.
    await setTheme(context, 'light');
  });

  test.afterEach(async () => {
    // Reset to the default seed so subsequent suites aren't
    // polluted by this one.
    await setSeed('empty');
  });

  test('renders the idle form on first load', async ({ page }) => {
    await login(page);
    await clientGoto(page, ROUTES.assistant);
    await expect(page.getByTestId('assistant-form')).toBeVisible();
    await expect(page.getByTestId('assistant-question')).toBeVisible();
    await expect(page.getByTestId('assistant-ask')).toBeVisible();
    await expect(page.getByTestId('app-nav')).toBeVisible();
    // No answer, no error yet.
    await expect(page.getByTestId('assistant-answer')).toHaveCount(0);
    await expect(page.getByTestId('assistant-error')).toHaveCount(0);
  });

  test('shows the answer, sources, and proposal CTA on a successful query', async ({ page }) => {
    await setSeed('ai-assistant');
    await login(page);
    await clientGoto(page, ROUTES.assistant);
    await page.getByTestId('assistant-question').fill('What should I review next?');
    await page.getByTestId('assistant-ask').click();
    await expect(page.getByTestId('assistant-answer-text')).toContainText(
      /Review Arithmetic next/,
    );
    // One row per source.
    await expect(
      page.getByTestId('assistant-source-error-err-1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('assistant-source-topic-topic-arithmetic'),
    ).toBeVisible();
    // The proposal CTA shows both Apply and Discard.
    await expect(page.getByTestId('assistant-proposal-cta')).toBeVisible();
    await expect(page.getByTestId('assistant-proposal-apply')).toBeVisible();
    await expect(page.getByTestId('assistant-proposal-reject')).toBeVisible();
  });

  test('Apply fires /assistant/proposals/:id/confirm and surfaces the Applied band', async ({ page }) => {
    await setSeed('ai-assistant');
    await login(page);
    await clientGoto(page, ROUTES.assistant);

    // Stub the proposal confirm so we can verify the request body
    // and force a 200. The real fixture returns 200 by default,
    // but we want to assert the body shape directly.
    await page.route('**/assistant/proposals/*/confirm', async (route) => {
      const req = route.request();
      const body = req.postDataJSON();
      expect(body).toEqual({ confirmed: true });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            executed: true,
            proposal: {
              id: 'proposal-abc',
              kind: 'create_task',
              description: 'Schedule a 30-min review of Arithmetic on Friday.',
              affectedRecords: ['topic-arithmetic'],
              payload: {},
              createdAt: Date.parse('2026-09-03T12:00:00.000Z'),
            },
            dispatched: { kind: 'create_task', taskId: 'task-new' },
          },
        }),
      });
    });

    await page.getByTestId('assistant-question').fill('What should I review next?');
    await page.getByTestId('assistant-ask').click();
    await expect(page.getByTestId('assistant-proposal-cta')).toBeVisible();
    await page.getByTestId('assistant-proposal-apply').click();
    await expect(page.getByTestId('assistant-proposal-applied')).toBeVisible();
    // The page does not invent a deeper success state.
    await expect(page.getByTestId('assistant-proposal-rejected')).toHaveCount(0);
  });

  test('Discard fires /assistant/proposals/:id/confirm with confirmed:false and does not invent applied UI', async ({ page }) => {
    await setSeed('ai-assistant');
    await login(page);
    await clientGoto(page, ROUTES.assistant);

    await page.route('**/assistant/proposals/*/confirm', async (route) => {
      const req = route.request();
      const body = req.postDataJSON();
      expect(body).toEqual({ confirmed: false });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            executed: false,
            proposal: {
              id: 'proposal-abc',
              kind: 'create_task',
              description: 'Schedule a 30-min review of Arithmetic on Friday.',
              affectedRecords: ['topic-arithmetic'],
              payload: {},
              createdAt: Date.parse('2026-09-03T12:00:00.000Z'),
            },
          },
        }),
      });
    });

    await page.getByTestId('assistant-question').fill('What should I review next?');
    await page.getByTestId('assistant-ask').click();
    await expect(page.getByTestId('assistant-proposal-cta')).toBeVisible();
    await page.getByTestId('assistant-proposal-reject').click();
    await expect(page.getByTestId('assistant-proposal-rejected')).toBeVisible();
    // Crucial: the page does not pretend the change happened.
    await expect(page.getByTestId('assistant-proposal-applied')).toHaveCount(0);
  });

  test('on an empty-sources answer, the page surfaces the "no records cited" note', async ({ page }) => {
    await setSeed('ai-assistant-empty');
    await login(page);
    await clientGoto(page, ROUTES.assistant);
    await page.getByTestId('assistant-question').fill('Help me plan.');
    await page.getByTestId('assistant-ask').click();
    await expect(page.getByTestId('assistant-answer-text')).toBeVisible();
    await expect(page.getByTestId('assistant-sources-empty')).toBeVisible();
    await expect(page.getByTestId('assistant-sources')).toHaveCount(0);
    await expect(page.getByTestId('assistant-proposal')).toHaveCount(0);
  });

  test('renders the deterministic fallback on 503 DEPENDENCY_UNAVAILABLE and never fabricates an answer', async ({ page }) => {
    await setSeed('ai-assistant-unavailable');
    await login(page);
    await clientGoto(page, ROUTES.assistant);
    await page.getByTestId('assistant-question').fill('What should I review next?');
    await page.getByTestId('assistant-ask').click();
    await expect(page.getByTestId('assistant-error')).toBeVisible();
    // The page must not invent an answer, a sources list, or a proposal.
    await expect(page.getByTestId('assistant-answer')).toHaveCount(0);
    await expect(page.getByTestId('assistant-sources')).toHaveCount(0);
    await expect(page.getByTestId('assistant-proposal')).toHaveCount(0);
  });
});
