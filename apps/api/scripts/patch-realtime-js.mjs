#!/usr/bin/env node
/**
 * Patch @supabase/realtime-js `src/lib/websocket-factory.ts` so that
 * `WebSocketFactory.getWebSocketConstructor()` returns `globalThis.WebSocket`
 * if it is defined. This lets the KRODEX API run on Node 20 (where the
 * `ws` package is polyfilled onto `globalThis.WebSocket`) without crashing
 * with "Node.js detected but native WebSocket not found".
 *
 * Why this exists: the upstream `detectEnvironment()` only checks
 * `globalThis.WebSocket` in the ESM dist and the CJS dist. When tsx loads
 * the .ts source directly under the KRODEX API, the upstream checks behave
 * inconsistently (the globalThis branch appears to fail at runtime even
 * though the property is set). Replacing the method body with a direct
 * read of `globalThis.WebSocket` removes the ambiguity.
 *
 * This is a packaging-time patch. It runs as a `postinstall` script in
 * `apps/api`, runs once per `npm install`, is idempotent, and never
 * commits a modified copy of `node_modules/...` to git (it edits in
 * place at install time).
 *
 * Idempotency: a sentinel comment `// ws-polyfill-installed` at the top
 * of the file skips re-patching on subsequent installs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SENTINEL = '// ws-polyfill-installed';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const realPath = require.resolve('@supabase/realtime-js');
// realPath = .../node_modules/@supabase/realtime-js/dist/main/index.js
// We need:  .../node_modules/@supabase/realtime-js/src/lib/websocket-factory.ts
const pkgRoot = path.resolve(path.dirname(realPath), '..', '..');
const target = path.join(pkgRoot, 'src', 'lib', 'websocket-factory.ts');

if (!fs.existsSync(target)) {
  process.stderr.write('[patch-realtime-js] target not found: ' + target + '\n');
  process.exit(0);
}

const orig = fs.readFileSync(target, 'utf8');
if (orig.includes(SENTINEL)) {
  process.stderr.write('[patch-realtime-js] already patched, skipping\n');
  process.exit(0);
}

// Insert sentinel as the first line.
let next = SENTINEL + '\n' + orig;

// Replace `private static detectEnvironment(): WebSocketEnvironment {` to
// a one-liner that returns the globalThis.WebSocket if set, otherwise
// falls back to the original behavior (which we keep intact below).
// We achieve this by inserting a one-line short-circuit at the top of the
// method body.
const DETECT_OPEN = 'private static detectEnvironment(): WebSocketEnvironment {';
if (!next.includes(DETECT_OPEN)) {
  process.stderr.write('[patch-realtime-js] detectEnvironment signature not found, aborting\n');
  process.exit(1);
}
next = next.replace(
  DETECT_OPEN,
  DETECT_OPEN +
    '\n    if (typeof globalThis !== "undefined" && (globalThis as any).WebSocket) { return { type: "native", wsConstructor: (globalThis as any).WebSocket } }\n'
);

fs.writeFileSync(target, next, 'utf8');
process.stderr.write('[patch-realtime-js] patched ' + target + '\n');
