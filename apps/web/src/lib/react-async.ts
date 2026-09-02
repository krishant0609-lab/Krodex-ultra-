/**
 * KRODEX web — React 18 + `use()` shim.
 *
 * Next.js 14's App Router types `params` as a Promise and unwraps it via
 * React's `use()` hook (a canary hook that ships in Next's bundled React).
 * The plain `react@18.3.1` we depend on for type inference does not export
 * `use`, so route shells that import it directly would crash in tests.
 *
 * This module re-exports React's hooks and adds a minimal `use` that
 * supports the one shape we care about: a Promise that has already settled
 * (the test harness always awaits the param Promise before passing it
 * in). In production, when the Promise is still pending, the call suspends
 * the component — but the App Router boundary suspends the route, not the
 * component, so by the time the component renders the Promise is always
 * settled. Tests pass a pre-resolved Promise for the same reason.
 *
 * If this workspace ever upgrades to a React that ships `use()` natively,
 * delete this file and switch the page imports back to `import { use }
 * from 'react'`.
 */

import * as React from 'react';

export type { ReactNode } from 'react';

type SettledPromise<T> = Promise<T> & { __krodexSettled?: boolean };

function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Minimal `use()` polyfill for React 18.3.1.
 *
 * Accepts a thenable (typically a Promise) and returns its resolved value.
 * The promise is expected to already be settled by the time the component
 * renders; if it isn't, the call throws — which is the right behavior,
 * because production routes receive pre-settled params from the App
 * Router, and tests pre-settle them via `setSettled`.
 */
export function use<T>(value: T | PromiseLike<T>): T {
  if (isThenable<T>(value)) {
    const settled = value as SettledPromise<T>;
    if (settled.__krodexSettled) {
      return (settled as unknown as { __krodexValue: T }).__krodexValue;
    }
    throw new Error(
      'krodex/react-async: use() received an unsettled thenable. ' +
        'Tests must pre-await param Promises via `setSettled(promise, value)` ' +
        'before passing them in.',
    );
  }
  return value;
}

/**
 * Mark a thenable as settled and remember its value, so the polyfilled
 * `use()` above can read it synchronously.
 *
 * Tests should call this on the param Promise they pass into a page:
 *
 *   const params = Promise.resolve({ id: 'abc' });
 *   setSettled(params, { id: 'abc' });
 *   render(<Page params={params} />);
 */
export function setSettled<T>(promise: PromiseLike<T>, value: T): void {
  const p = promise as SettledPromise<T>;
  p.__krodexSettled = true;
  (p as unknown as { __krodexValue: T }).__krodexValue = value;
}

export default React;
