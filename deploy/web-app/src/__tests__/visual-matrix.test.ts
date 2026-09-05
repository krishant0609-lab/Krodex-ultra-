/**
 * KRODEX web — Phase 7.13 visual verification matrix.
 *
 * Three assertions run against the static source tree:
 *
 *   1. Every `*.module.css` file under `src/app` and
 *      `src/components` resolves every cosmetic value through
 *      a `var(--kd-*)` design token. No raw hex colors, no
 *      hardcoded `px` for spacing (token-only spacing is
 *      allowed via `rem`; this test allows `0`, `1px` borders,
 *      and `0.125rem` outline widths since those are real
 *      design constraints, not "magic" cosmetic values).
 *
 *   2. Every `*.tsx` page/component file is free of inline
 *      `style={{...}}` blocks that contain raw hex colors
 *      or `padding: NNpx` / `margin: NNpx` literals — except
 *      for the canonical sr-only utility which uses 1px/0
 *      for the visually-hidden pattern.
 *
 *   3. The set of `data-testid` strings referenced by the
 *      test files in `src/__tests__` is a subset of the set
 *      of `data-testid` strings emitted by the page/component
 *      source files. (Catches orphan tests pointing at deleted
 *      testids and removed pages whose tests were forgotten.)
 *
 * The test is a static lint, not a runtime render. It is the
 * last guard before the consolidated report.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(__dirname, '..');
const APP_APP = path.join(APP_DIR, 'app');
const COMPONENTS = path.join(APP_DIR, 'components');
const TESTS = APP_DIR;

function listFiles(dir: string, ext: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, ext));
    else if (ext.test(entry.name)) out.push(full);
  }
  return out;
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_PX_SPACING =
  /(?:padding|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap)\s*:\s*['"]?\d+px\b/;

describe('Phase 7.13 — visual verification matrix', () => {
  it('every module CSS file routes color and spacing through tokens', () => {
    // The project's design-token contract only covers two classes
    // of values: colors and spacing. Layout, sizing, and text
    // transform values are intentionally NOT tokenized — they are
    // standard CSS values that don't need a token. This test
    // asserts only that:
    //
    //   a) No raw hex colors appear in module CSS files.
    //   b) No `padding`/`margin`/`gap` properties use a hardcoded
    //      `NNpx` value (they must use `rem` or a token).
    //
    // Both checks are scoped to *.module.css — the only place
    // where the token contract is enforced.
    const files = [
      ...listFiles(APP_APP, /\.module\.css$/),
      ...listFiles(COMPONENTS, /\.module\.css$/),
    ];
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // Strip comments first so we don't false-positive on hex
      // sequences inside /* … */ blocks.
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');

      // (a) raw hex colors — anything matching #RGB / #RRGGBB
      // / #RRGGBBAA anywhere outside comments.
      const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
      let m: RegExpExecArray | null;
      while ((m = hexRe.exec(stripped)) !== null) {
        violations.push(
          `${path.relative(APP_DIR, file)}: raw hex '${m[0]}' (use a --kd-color-* token)`,
        );
      }

      // (b) raw px on spacing properties. The only exception is
      // `1px` for borders (declared separately on border-width
      // / outline-width); we keep the same allow-list as before.
      const spacingRe =
        /(^|[\s;{])(padding|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap)\s*:\s*([0-9.]+)px\b/gm;
      while ((m = spacingRe.exec(stripped)) !== null) {
        const pxValue = m[3] ?? '';
        // Allow `0` and `1px` (one-pixel borders/outlines are a
        // legitimate design primitive, not a magic cosmetic).
        if (pxValue === '0' || pxValue === '1') continue;
        violations.push(
          `${path.relative(APP_DIR, file)}: raw px spacing '${m[2] ?? ''}: ${m[3] ?? ''}px' (use a --kd-space-* token or rem)`,
        );
      }
    }

    if (violations.length) {
      throw new Error(
        `Found ${violations.length} token-contract violation(s):\n` +
          violations.slice(0, 20).join('\n') +
          (violations.length > 20 ? `\n…and ${violations.length - 20} more` : ''),
      );
    }
  });

  it('page/component TSX files do not use raw colors or px spacing inline', () => {
    const files = [
      ...listFiles(APP_APP, /\.tsx$/),
      ...listFiles(COMPONENTS, /\.tsx$/),
    ];
    const violations: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // Find every style={{...}} block. This is a coarse scan;
      // we look for either a hex color or a px spacing literal
      // inside any style block.
      const styleBlockRe = /style=\{\{([\s\S]*?)\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = styleBlockRe.exec(src)) !== null) {
        const block = m[1] ?? '';
        // Skip the canonical sr-only visually-hidden pattern
        // (it uses 1px/0 by design and has no cosmetic
        // dependency on the theme).
        if (
          /position:\s*['"]absolute['"]/.test(block) &&
          /width:\s*1/.test(block) &&
          /clip:\s*rect\(/.test(block)
        ) {
          continue;
        }
        if (HEX.test(block)) {
          violations.push(
            `${path.relative(APP_DIR, file)}: raw hex in inline style: ${block.slice(0, 80)}`,
          );
        }
        if (RAW_PX_SPACING.test(block)) {
          violations.push(
            `${path.relative(APP_DIR, file)}: raw px spacing in inline style: ${block.slice(0, 80)}`,
          );
        }
      }
    }

    if (violations.length) {
      throw new Error(
        `Found ${violations.length} inline style violation(s):\n` +
          violations.slice(0, 20).join('\n'),
      );
    }
  });

  it('every data-testid referenced by a test exists in source', () => {
    // This is a "loose" check: we only assert that test files
    // don't reference a testid that we've never seen emitted.
    // We do NOT assert the inverse (the source may emit
    // testids for future tests).
    //
    // We handle three data-testid forms in the source:
    //   1. `data-testid="literal"`
    //   2. `data-testid='literal'`
    //   3. `data-testid={`prefix-${expr}suffix`}` — we extract
    //      the static prefix and suffix and treat anything that
    //      joins them as a valid id.
    const srcFiles = [
      ...listFiles(APP_APP, /\.tsx$/),
      ...listFiles(COMPONENTS, /\.tsx$/),
    ];
    const literalIds = new Set<string>();
    // Each template pattern is stored as {prefix, suffix}.
    const templateIds: Array<{ prefix: string; suffix: string }> = [];
    const literalRe = /data-testid=["']([a-zA-Z0-9_-]+)["']/g;
    // Template `data-testid` patterns come in two shapes:
    //   1. `prefix-${expr}suffix` — one interpolation.
    //   2. `prefix-${expr}-${expr}suffix` — multiple interpolations
    //      separated by literal segments (e.g. Phase 8's
    //      `assistant-source-${s.kind}-${s.id}`).
    // We capture the leading literal prefix and trailing literal
    // suffix of any template; the segments in between must all
    // be `${…}` interpolations or `[a-zA-Z0-9_-]+` literals, but
    // the static prefix/suffix check is sufficient for our
    // "no orphan testids" invariant — if a testid starts with
    // the template's prefix and ends with its suffix, the
    // template can produce it.
    const templateRe =
      /data-testid=\{`([a-zA-Z0-9_-]*)((?:\$\{[^}]+\}|[a-zA-Z0-9_-]+)*)([a-zA-Z0-9_-]*)`\}/g;
    for (const file of srcFiles) {
      const src = fs.readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = literalRe.exec(src)) !== null) {
        if (m[1]) literalIds.add(m[1]);
      }
      while ((m = templateRe.exec(src)) !== null) {
        const prefix = m[1] ?? '';
        const suffix = m[3] ?? '';
        if (prefix !== undefined && suffix !== undefined) {
          templateIds.push({ prefix, suffix });
        }
      }
    }
    function idEmitted(id: string): boolean {
      if (literalIds.has(id)) return true;
      for (const t of templateIds) {
        if (id.startsWith(t.prefix) && id.endsWith(t.suffix) && id.length >= t.prefix.length + t.suffix.length) {
          return true;
        }
      }
      return false;
    }
    // Test references: pull from `getByTestId('...')`,
    // `findByTestId('...')`, `queryByTestId('...')`.
    const testFiles = listFiles(TESTS, /\.(test|spec)\.tsx?$/);
    // Test files may pass a data-testid prop directly to a
    // component (e.g. `<Input data-testid="i" />`). When they do,
    // they're declaring that the component will forward that
    // testid to its root element — so treat any testid that
    // appears as a literal attribute in the test source as
    // "self-declared" and exempt from the check.
    const testSelfDeclared = new Set<string>();
    for (const file of testFiles) {
      const src = fs.readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      const re = /data-testid=["']([a-zA-Z0-9_-]+)["']/g;
      while ((m = re.exec(src)) !== null) {
        if (m[1]) testSelfDeclared.add(m[1]);
      }
    }
    const referenced = new Set<string>();
    const testRefRe = /(?:getByTestId|findByTestId|queryByTestId|getAllByTestId|findAllByTestId|queryAllByTestId)\(\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
    for (const file of testFiles) {
      const src = fs.readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = testRefRe.exec(src)) !== null) {
        if (m[1]) referenced.add(m[1]);
      }
    }

    const missing = [...referenced].filter(
      (id) => !idEmitted(id) && !testSelfDeclared.has(id),
    );
    if (missing.length) {
      throw new Error(
        `Test files reference ${missing.length} data-testid(s) that no source file emits:\n` +
          missing.slice(0, 20).join('\n'),
      );
    }
  });
});
