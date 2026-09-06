/**
 * KRODEX web — guard script for the @krodex/shared dist artifact.
 *
 * Runs between `npm --prefix ../../packages/shared run build` and
 * `next build` to confirm that the shared package's compiled output
 * is actually present before Next.js webpack tries to resolve the
 * module.
 *
 * Why this exists:
 *  The shared package's `tsc` is `composite: true` + `incremental: true`,
 *  which means a stale or missing `tsconfig.tsbuildinfo` can cause tsc
 *  to skip emit silently (exit 0, no `dist/`). When that happens on
 *  Vercel, the next.js webpack pass tries to resolve `@krodex/shared`
 *  against a non-existent `./dist/index.js`, the module graph is broken,
 *  and the prerender phase throws:
 *
 *    TypeError: Cannot read properties of undefined (reading 'clientModules')
 *      ...while prerendering page "/"
 *
 *  That's a confusing surface symptom for a missing build artifact. This
 *  guard makes the failure mode explicit: it fails the build with a
 *  clear "[krodex] shared package dist missing after build" message
 *  instead of letting next.js emit the cryptic clientModules error.
 *
 * Exits 0 on success (dist present), 1 on failure.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SHARED_DIST = path.resolve(__dirname, '..', '..', '..', 'packages', 'shared', 'dist');
const REQUIRED_FILES = ['index.js', 'index.d.ts'];

const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(SHARED_DIST, f)));
if (missing.length > 0) {
  console.error(
    `[krodex] shared package dist missing after build: ${missing
      .map((f) => `packages/shared/dist/${f}`)
      .join(', ')}`,
  );
  console.error(`[krodex] expected directory: ${SHARED_DIST}`);
  process.exit(1);
}

process.exit(0);
