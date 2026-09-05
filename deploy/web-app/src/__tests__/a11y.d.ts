/**
 * KRODEX web — test-only type augmentation.
 *
 * vitest-axe ships an `extend-expect` module that augments
 * `Vi.Assertion`, but Vitest's `expect` returns `Assertion<T>`
 * from `vitest`, not `Vi.Assertion`. We re-augment `Assertion`
 * here so `expect(results).toHaveNoViolations()` type-checks
 * inside the a11y test file.
 */

import 'vitest';

interface AxeMatchers {
  toHaveNoViolations(): unknown;
}

declare module 'vitest' {
  interface Assertion<T> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
