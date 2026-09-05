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
  // Resolved entry observed: /app/node_modules/@supabase/realtime-js/dist/main/index.js
  // dirname(entryPath) = .../dist/main
  // 2 levels up = .../realtime-js  (the actual package root)
  const path = require('path');
  let realtimeJsRoot = '<unknown>';
  try {
    realtimeJsRoot = path.resolve(path.dirname(entryPath), '..', '..');
    process.stderr.write('[ws-diagnostic] realtimeJs.pkgRoot=' + realtimeJsRoot + '\n');
  } catch (err) {
    process.stderr.write('[ws-diagnostic] could not derive pkgRoot: ' + err.message + '\n');
  }

  const fs = require('fs');
  const candidates = [
    path.join(realtimeJsRoot, 'package.json'),
    path.join(realtimeJsRoot, 'src', 'lib', 'websocket-factory.ts'),
    path.join(realtimeJsRoot, 'dist', 'main', 'lib', 'websocket-factory.js'),
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
    const pkgJsonPath = path.join(realtimeJsRoot, 'package.json');
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

  // Also dump the entry file itself (the .js that Node's resolver picked)
  // so we can see what code is actually being executed.
  try {
    if (fs.existsSync(entryPath)) {
      process.stderr.write('[ws-diagnostic] ----- entryFile: ' + entryPath + ' -----\n');
      const entryContent = fs.readFileSync(entryPath, 'utf8');
      const entryLines = entryContent.split(/\r?\n/).slice(0, 30);
      process.stderr.write('[ws-diagnostic] entryFile.totalLines=' + entryContent.split(/\r?\n/).length + '\n');
      for (let i = 0; i < entryLines.length; i++) {
        process.stderr.write('[ws-diagnostic] entryFile:' + (i + 1) + ':' + entryLines[i] + '\n');
      }
    } else {
      process.stderr.write('[ws-diagnostic] entryFile=<absent at ' + entryPath + '>\n');
    }
  } catch (err) {
    process.stderr.write('[ws-diagnostic] entryFile.err=' + err.message + '\n');
  }

  // Also list the dist/ and src/ directories so we see exactly what shipped.
  function listDir(dir, depth) {
    if (depth <= 0) return [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      process.stderr.write('[ws-diagnostic] listDir.err dir=' + dir + ' err=' + err.message + '\n');
      return [];
    }
    for (const ent of entries) {
      const child = path.join(dir, ent.name);
      process.stderr.write('[ws-diagnostic] dirEntry: ' + child + (ent.isDirectory() ? '/' : '') + '\n');
      if (ent.isDirectory() && depth > 1) {
        listDir(child, depth - 1);
      }
    }
  }
  process.stderr.write('[ws-diagnostic] ----- dirTree: ' + realtimeJsRoot + ' (depth=2) -----\n');
  listDir(realtimeJsRoot, 2);

  // Targeted checks: does the .ts contain the sentinel and the early-return?
  // Does the compiled .js contain an equivalent early-return? Both questions
  // need explicit grep-like output so we can decide patch compatibility.
  function grep(filePath, needle, maxLines) {
    if (!fs.existsSync(filePath)) {
      process.stderr.write('[ws-diagnostic] grep.absent file=' + filePath + '\n');
      return;
    }
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      process.stderr.write('[ws-diagnostic] grep.err file=' + filePath + ' err=' + err.message + '\n');
      return;
    }
    const lines = content.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(needle) !== -1) {
        hits.push({ line: i + 1, text: lines[i] });
        if (hits.length >= maxLines) break;
      }
    }
    process.stderr.write(
      '[ws-diagnostic] grep.file=' + filePath + ' needle=' + JSON.stringify(needle) + ' hits=' + hits.length + '\n'
    );
    for (const h of hits) {
      process.stderr.write('[ws-diagnostic]   hit@' + h.line + ': ' + h.text + '\n');
    }
  }
  const tsFile = path.join(realtimeJsRoot, 'src', 'lib', 'websocket-factory.ts');
  const jsFile = path.join(realtimeJsRoot, 'dist', 'main', 'lib', 'websocket-factory.js');
  grep(tsFile, '// ws-polyfill-installed', 5);
  grep(tsFile, 'globalThis as any', 5);
  grep(tsFile, 'detectEnvironment', 5);
  grep(jsFile, 'globalThis', 5);
  grep(jsFile, 'WebSocket', 5);
  grep(jsFile, 'detectEnvironment', 5);
  grep(jsFile, 'wsConstructor', 5);

  // Also dump the installed @supabase/supabase-js version.
  try {
    const supabaseJsPath = req.resolve('@supabase/supabase-js');
    process.stderr.write('[ws-diagnostic] supabaseJs.entryPath=' + supabaseJsPath + '\n');
    const supabaseRoot = path.resolve(path.dirname(supabaseJsPath), '..', '..');
    const supabasePkgPath = path.join(supabaseRoot, 'package.json');
    if (fs.existsSync(supabasePkgPath)) {
      const sp = JSON.parse(fs.readFileSync(supabasePkgPath, 'utf8'));
      process.stderr.write('[ws-diagnostic] supabaseJs.version=' + JSON.stringify(sp.version) + '\n');
      process.stderr.write(
        '[ws-diagnostic] supabaseJs.dependencies=' + JSON.stringify(sp.dependencies) + '\n'
      );
      process.stderr.write('[ws-diagnostic] supabaseJs.main=' + JSON.stringify(sp.main) + '\n');
    } else {
      process.stderr.write('[ws-diagnostic] supabaseJs.packageJson=<absent at ' + supabasePkgPath + '>\n');
    }
  } catch (err) {
    process.stderr.write('[ws-diagnostic] supabaseJs.err=' + err.message + '\n');
  }
})();

process.stderr.write('[ws-diagnostic] ===== END @supabase/realtime-js artifact survey =====\n');

// =====================================================================
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — end
// =====================================================================
