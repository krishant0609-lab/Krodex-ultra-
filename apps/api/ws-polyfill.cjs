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

const before = typeof globalThis.WebSocket;
globalThis.WebSocket = WebSocket;
if (typeof global !== 'undefined' && typeof global.WebSocket === 'undefined') {
  global.WebSocket = WebSocket;
}
process.stderr.write('[ws-polyfill] before=' + before + ' after=' + typeof globalThis.WebSocket + ' global=' + (typeof global !== 'undefined' ? typeof global.WebSocket : 'n/a') + '\n');

// Also pre-emptively load the realtime-js CJS module so any module-level
// detection that runs at import time is satisfied. We then replace the
// detectEnvironment() static method to always return our polyfill WS,
// bypassing the unreliable lexical/globalThis checks under tsx ESM.
try {
  const rj = require('@supabase/realtime-js');
  process.stderr.write('[ws-polyfill] realtime-js loaded; keys=' + Object.keys(rj).join(',') + '\n');
  if (rj.WebSocketFactory && typeof rj.WebSocketFactory.getWebSocketConstructor === 'function') {
    const orig = rj.WebSocketFactory.getWebSocketConstructor.bind(rj.WebSocketFactory);
    rj.WebSocketFactory.getWebSocketConstructor = function () {
      return WebSocket;
    };
    process.stderr.write('[ws-polyfill] patched CJS WebSocketFactory.getWebSocketConstructor\n');
  } else {
    process.stderr.write('[ws-polyfill] no WebSocketFactory on realtime-js CJS export\n');
  }
} catch (err) {
  process.stderr.write('[ws-polyfill] realtime-js pre-load skipped: ' + err.message + '\n');
}
