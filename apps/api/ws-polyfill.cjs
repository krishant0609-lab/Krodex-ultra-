/**
 * KRODEX API — Node 20 WebSocket polyfill loader.
 *
 * Node 20 ships without a global `WebSocket`. @supabase/supabase-js@2.45.x
 * instantiates a Realtime client inside `createClient()`, and the realtime-js
 * WebSocket factory requires the global. On Node 20 this throws:
 *
 *   Error: Node.js detected but native WebSocket not found.
 *   Suggested solution: Ensure you are running Node.js 22+ or provide a
 *   WebSocket implementation via the transport option.
 *
 * Until the Railway runtime is bumped to Node 22, install a `ws` polyfill
 * on `globalThis.WebSocket` before the API source is loaded. `ws` is
 * already a transitive dep (pulled in by Next.js dev tooling), so no
 * new package is added.
 *
 * This file is a packaging shim only. It is invoked by the Procfile
 * (`node -r ./apps/api/ws-polyfill.cjs ...` style) and never imported
 * by application code.
 */

process.stderr.write('[ws-polyfill] booting; node=' + process.versions.node + '\n');

// eslint-disable-next-line @typescript-eslint/no-var-requires
let WebSocket;
try {
  WebSocket = require('ws');
  process.stderr.write('[ws-polyfill] required ws ok; type=' + typeof WebSocket + '\n');
} catch (err) {
  process.stderr.write('[ws-polyfill] FAILED to require ws: ' + err.message + '\n');
  throw err;
}

// Set the global with Object.defineProperty to make it non-configurable
// but still readable. This way any subsequent attempt to delete or replace
// globalThis.WebSocket will not affect our polyfill.
try {
  Object.defineProperty(globalThis, 'WebSocket', {
    value: WebSocket,
    writable: true,
    configurable: false,
    enumerable: true,
  });
  process.stderr.write('[ws-polyfill] installed non-configurable globalThis.WebSocket\n');
} catch (err) {
  // Fallback: simple assignment
  globalThis.WebSocket = WebSocket;
  process.stderr.write('[ws-polyfill] fallback assigned globalThis.WebSocket: ' + err.message + '\n');
}

if (typeof global !== 'undefined') {
  try {
    Object.defineProperty(global, 'WebSocket', {
      value: WebSocket,
      writable: true,
      configurable: false,
      enumerable: true,
    });
  } catch (err) {
    global.WebSocket = WebSocket;
  }
}

process.stderr.write('[ws-polyfill] final globalThis.WebSocket=' + typeof globalThis.WebSocket + ' global.WebSocket=' + (typeof global !== 'undefined' ? typeof global.WebSocket : 'n/a') + '\n');

// =====================================================================
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — start
// Goal: determine which @supabase/realtime-js artifact the running
// container actually loads, and whether the patched `.ts` source or the
// unpatched compiled `.js` is being resolved at runtime.
// Safe: every read is wrapped; missing files are reported, not crashed.
// Remove this block once root cause is established.
// =====================================================================

process.stderr.write('[ws-diagnostic] ===== START @supabase/realtime-js artifact survey =====\n');
process.stderr.write('[ws-diagnostic] node.version=' + process.versions.node + '\n');
process.stderr.write('[ws-diagnostic] typeof.globalThis.WebSocket=' + typeof globalThis.WebSocket + '\n');

(function surveyRealtimeJs() {
  let createRequire;
  try {
    createRequire = require('module').createRequire;
  } catch (err) {
    process.stderr.write('[ws-diagnostic] could not access module.createRequire: ' + err.message + '\n');
    return;
  }
  const req = createRequire(__filename);
  let entryPath = '<unresolved>';
  try {
    entryPath = req.resolve('@supabase/realtime-js');
    process.stderr.write('[ws-diagnostic] realtimeJs.entryPath=' + entryPath + '\n');
  } catch (err) {
    process.stderr.write('[ws-diagnostic] realtimeJs.entryPath=<unresolved> err=' + err.message + '\n');
    return;
  }

  // Walk from the resolved entry to the package root.
  // Common layouts seen:
  //   <pkgRoot>/dist/main/index.js                (CJS entry, when require()'d)
  //   <pkgRoot>/dist/main/lib/websocket-factory.js
  //   <pkgRoot>/src/lib/websocket-factory.ts      (loaded by tsx)
  const path = require('path');
  let pkgRoot = '<unknown>';
  try {
    // entry is typically .../dist/main/index.js — step up three to package root.
    pkgRoot = path.resolve(path.dirname(entryPath), '..', '..', '..');
    process.stderr.write('[ws-diagnostic] realtimeJs.pkgRoot=' + pkgRoot + '\n');
  } catch (err) {
    process.stderr.write('[ws-diagnostic] could not derive pkgRoot: ' + err.message + '\n');
  }

  const fs = require('fs');
  const candidates = [
    path.join(pkgRoot, 'src', 'lib', 'websocket-factory.ts'),
    path.join(pkgRoot, 'dist', 'main', 'lib', 'websocket-factory.js'),
  ];

  for (const filePath of candidates) {
    process.stderr.write('[ws-diagnostic] ----- candidate: ' + filePath + ' -----\n');
    let exists = false;
    try {
      exists = fs.existsSync(filePath);
    } catch (err) {
      process.stderr.write('[ws-diagnostic] existsCheck.err=' + err.message + '\n');
    }
    process.stderr.write('[ws-diagnostic] exists=' + exists + '\n');
    if (!exists) {
      process.stderr.write('[ws-diagnostic] <file absent — skipping content read>\n');
      continue;
    }
    let content = '<unread>';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      process.stderr.write('[ws-diagnostic] read.err=' + err.message + '\n');
      continue;
    }
    const lines = content.split(/\r?\n/);
    const head = lines.slice(0, 80);
    process.stderr.write('[ws-diagnostic] totalLines=' + lines.length + ' headLines=' + head.length + '\n');
    for (let i = 0; i < head.length; i++) {
      // Use a separator that grep/jq/awk can split on if needed.
      process.stderr.write('[ws-diagnostic] ' + filePath + ':' + (i + 1) + ':' + head[i] + '\n');
    }
  }

  // Also dump the package.json's "main" and "exports" so we know which
  // entry Node's resolver will pick when supabase-js does require().
  try {
    const pkgJsonPath = path.join(pkgRoot, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      process.stderr.write('[ws-diagnostic] packageJson.path=' + pkgJsonPath + '\n');
      process.stderr.write('[ws-diagnostic] packageJson.main=' + JSON.stringify(pkg.main) + '\n');
      process.stderr.write(
        '[ws-diagnostic] packageJson.exports=' + JSON.stringify(pkg.exports) + '\n'
      );
      process.stderr.write('[ws-diagnostic] packageJson.version=' + JSON.stringify(pkg.version) + '\n');
    } else {
      process.stderr.write('[ws-diagnostic] packageJson=<absent at ' + pkgJsonPath + '>\n');
    }
  } catch (err) {
    process.stderr.write('[ws-diagnostic] packageJson.err=' + err.message + '\n');
  }
})();

process.stderr.write('[ws-diagnostic] ===== END @supabase/realtime-js artifact survey =====\n');

// =====================================================================
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — end
// =====================================================================
