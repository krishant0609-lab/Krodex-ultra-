/**
 * KRODEX API — snapshot renderer (Phase 9).
 *
 * Transforms an `EvidenceSnapshot` DTO into a deterministic binary
 * suitable for upload as a Phase 9 evidence asset. The renderer is
 * pure: the same input DTO MUST always produce the same output
 * bytes, so a student reviewing their mistake later sees the same
 * snapshot that was captured at submit time.
 *
 * Two output formats are produced:
 *   1. PNG  — primary. Encoded server-side as an 8-bit RGBA buffer
 *             wrapped in a minimal PNG container.
 *   2. SVG  — fallback. Pure-text, smaller than PNG, decodes in
 *             every browser, and is what we serve when PNG
 *             encoding fails for any reason.
 *
 * Both formats are produced by `renderSnapshot()`; the higher
 * layers pick whichever one they want to upload. The renderer is
 * deliberately tiny: it produces a fixed-size white card with the
 * sanitized question, the student's answer, and the expected
 * answer. Anything fancier (typography, layout per question type)
 * is a Phase 10+ concern.
 *
 * Important invariants:
 *   - The input DTO is sanitized by the caller (TRD §26). The
 *     renderer treats it as untrusted text and escapes it before
 *     embedding in either format. Do NOT add live HTML / Markdown
 *     parsing here.
 *   - No I/O. No network. No clock reads (`new Date()` etc.).
 *   - No randomness. Determinism is the whole point.
 */

import { createHash } from 'node:crypto';

/**
 * Sanitized input contract per TRD §26. The orchestrator builds
 * this from the attempt's question + the student's answer. The
 * route layer and tests can construct one directly.
 */
export interface EvidenceSnapshot {
  questionId: string;
  questionBody: string;        // ≤ 1000 chars (caller-enforced)
  options?: ReadonlyArray<{
    body: string;
    isCorrect: boolean;
  }>;
  studentAnswer: string;
  expectedAnswer: string;
  topicName?: string;
  attemptId: string;
  timestamp: string;           // ISO 8601
  sourceIds?: readonly string[];
}

export type SnapshotMime = 'image/png' | 'image/svg+xml';

export interface RenderedSnapshot {
  /** The PNG bytes (always present). */
  png: Uint8Array;
  /** The SVG bytes (always present; an SVG fallback). */
  svg: Uint8Array;
  /** SHA-256 of the PNG. Stable across calls with the same input. */
  pngSha256: string;
  /** SHA-256 of the SVG. Stable across calls with the same input. */
  svgSha256: string;
  /**
   * Which format the orchestrator should upload as the primary
   * asset. PNG is the documented preference (Phase 9 Class A);
   * SVG is the documented fallback.
   */
  preferredMime: SnapshotMime;
}

// -------------------------------------------------------------
// SVG rendering (trivial — pure text, escaped)
// -------------------------------------------------------------

/** Escape user-controlled text for inclusion in an SVG <text> node. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Word-wrap text to a maximum line length, breaking on spaces. */
function wrap(text: string, maxLen: number): readonly string[] {
  if (text.length <= maxLen) return [text];
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length === 0) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxLen) {
      cur = `${cur} ${w}`;
    } else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Compose the SVG byte stream for the snapshot card. */
function renderSvg(snap: EvidenceSnapshot): Uint8Array {
  const W = 800;
  const H = 480;
  const PAD = 24;
  const TITLE_FS = 14;
  const BODY_FS = 12;

  const title = snap.topicName ? `Error snapshot — ${escapeXml(snap.topicName)}` : 'Error snapshot';
  const ts = escapeXml(snap.timestamp);
  const qid = escapeXml(snap.questionId);
  const aid = escapeXml(snap.attemptId);

  const qLines = wrap(snap.questionBody, 90).map(escapeXml);
  const sLines = wrap(`Your answer: ${snap.studentAnswer}`, 90).map(escapeXml);
  const eLines = wrap(`Expected: ${snap.expectedAnswer}`, 90).map(escapeXml);

  // Build the text content. We position line-by-line starting at
  // y=72; the question + student + expected blocks have at most
  // ~6 lines each so 480px is plenty.
  let yCursor = 72;
  const block = (lines: readonly string[]) => {
    const out = lines
      .map((l) => {
        const outStr = `<text x="${PAD}" y="${yCursor}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${BODY_FS}" fill="#111">${l}</text>`;
        yCursor += 18;
        return outStr;
      })
      .join('');
    yCursor += 8;
    return out;
  };

  const options = (snap.options ?? [])
    .map((o, i) => {
      const marker = o.isCorrect ? '✓' : '·';
      const body = wrap(`${marker} ${o.body}`, 86).map(escapeXml);
      const text = body
        .map((l, idx) => {
          const yy = yCursor + idx * 16;
          return `<text x="${PAD + 8}" y="${yy}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${BODY_FS}" fill="${o.isCorrect ? '#1a7f37' : '#444'}">${l}</text>`;
        })
        .join('');
      yCursor += body.length * 16 + 2;
      return text;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#d0d7de"/>
  <text x="${PAD}" y="32" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${TITLE_FS}" font-weight="600" fill="#0b1220">${title}</text>
  <text x="${PAD}" y="50" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" fill="#57606a">question ${qid} • attempt ${aid} • ${ts}</text>
  <text x="${PAD}" y="68" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" font-weight="600" fill="#0b1220">Question</text>
  ${block(qLines)}
  ${block(sLines)}
  ${block(eLines)}
  ${options}
</svg>`;
  return new TextEncoder().encode(svg);
}

// -------------------------------------------------------------
// PNG rendering (minimal hand-rolled encoder)
// -------------------------------------------------------------
//
// We use a small 8-bit RGBA buffer (W×H) filled with white and
// rasterized text, then wrap it in a PNG container. Implementing
// a real font rasterizer is well out of scope for Phase 9; we
// draw the question and answers as fixed-position rectangles +
// a per-glyph substitution using a built-in 5x7 bitmap font for
// ASCII. Glyphs outside the bitmap font become '?'. This is
// enough to make the PNG a deterministic, identifying artifact
// (same DTO → same bytes) without pulling a heavy dep in.

const FONT_W = 5;
const FONT_H = 7;

const FONT_5x7: Readonly<Record<string, string>> = {
  ' ': '00000',
  '0': '01110|10001|10011|10101|11001|10001|01110',
  '1': '00100|01100|00100|00100|00100|00100|01110',
  '2': '01110|10001|00001|00010|00100|01000|11111',
  '3': '11110|00001|00001|01110|00001|00001|11110',
  '4': '00010|00110|01010|10010|11111|00010|00010',
  '5': '11111|10000|11110|00001|00001|10001|01110',
  '6': '00110|01000|10000|11110|10001|10001|01110',
  '7': '11111|00001|00010|00100|01000|01000|01000',
  '8': '01110|10001|10001|01110|10001|10001|01110',
  '9': '01110|10001|10001|01111|00001|00010|01100',
  'A': '01110|10001|10001|11111|10001|10001|10001',
  'B': '11110|10001|10001|11110|10001|10001|11110',
  'C': '01110|10001|10000|10000|10000|10001|01110',
  'D': '11110|10001|10001|10001|10001|10001|11110',
  'E': '11111|10000|10000|11110|10000|10000|11111',
  'F': '11111|10000|10000|11110|10000|10000|10000',
  'G': '01110|10001|10000|10111|10001|10001|01110',
  'H': '10001|10001|10001|11111|10001|10001|10001',
  'I': '01110|00100|00100|00100|00100|00100|01110',
  'J': '00111|00010|00010|00010|00010|10010|01100',
  'K': '10001|10010|10100|11000|10100|10010|10001',
  'L': '10000|10000|10000|10000|10000|10000|11111',
  'M': '10001|11011|10101|10101|10001|10001|10001',
  'N': '10001|10001|11001|10101|10011|10001|10001',
  'O': '01110|10001|10001|10001|10001|10001|01110',
  'P': '11110|10001|10001|11110|10000|10000|10000',
  'Q': '01110|10001|10001|10001|10101|10010|01101',
  'R': '11110|10001|10001|11110|10100|10010|10001',
  'S': '01111|10000|10000|01110|00001|00001|11110',
  'T': '11111|00100|00100|00100|00100|00100|00100',
  'U': '10001|10001|10001|10001|10001|10001|01110',
  'V': '10001|10001|10001|10001|10001|01010|00100',
  'W': '10001|10001|10001|10101|10101|10101|01010',
  'X': '10001|10001|01010|00100|01010|10001|10001',
  'Y': '10001|10001|10001|01010|00100|00100|00100',
  'Z': '11111|00001|00010|00100|01000|10000|11111',
  'a': '00000|00000|01110|00001|01111|10001|01111',
  'b': '10000|10000|11110|10001|10001|10001|11110',
  'c': '00000|00000|01110|10000|10000|10001|01110',
  'd': '00001|00001|01111|10001|10001|10001|01111',
  'e': '00000|00000|01110|10001|11111|10000|01110',
  'f': '00110|01001|01000|11100|01000|01000|01000',
  'g': '00000|01111|10001|10001|01111|00001|01110',
  'h': '10000|10000|11110|10001|10001|10001|10001',
  'i': '00100|00000|01100|00100|00100|00100|01110',
  'j': '00010|00000|00110|00010|00010|10010|01100',
  'k': '10000|10000|10010|10100|11000|10100|10010',
  'l': '01100|00100|00100|00100|00100|00100|01110',
  'm': '00000|00000|11010|10101|10101|10101|10101',
  'n': '00000|00000|11110|10001|10001|10001|10001',
  'o': '00000|00000|01110|10001|10001|10001|01110',
  'p': '00000|00000|11110|10001|11110|10000|10000',
  'q': '00000|00000|01111|10001|01111|00001|00001',
  'r': '00000|00000|11110|10001|10000|10000|10000',
  's': '00000|00000|01111|10000|01110|00001|11110',
  't': '01000|01000|11100|01000|01000|01001|00110',
  'u': '00000|00000|10001|10001|10001|10001|01111',
  'v': '00000|00000|10001|10001|10001|01010|00100',
  'w': '00000|00000|10001|10001|10101|10101|01010',
  'x': '00000|00000|10001|01010|00100|01010|10001',
  'y': '00000|00000|10001|10001|01111|00001|01110',
  'z': '00000|00000|11111|00010|00100|01000|11111',
  '-': '00000|00000|00000|11111|00000|00000|00000',
  '_': '00000|00000|00000|00000|00000|00000|11111',
  '.': '00000|00000|00000|00000|00000|01100|01100',
  ',': '00000|00000|00000|00000|00000|01100|01000',
  ':': '00000|01100|01100|00000|01100|01100|00000',
  '!': '00100|00100|00100|00100|00100|00000|00100',
  '?': '01110|10001|00010|00100|00100|00000|00100',
  '/': '00001|00010|00010|00100|01000|01000|10000',
  '(': '00010|00100|01000|01000|01000|00100|00010',
  ')': '01000|00100|00010|00010|00010|00100|01000',
  '&': '01100|10010|10100|01000|10101|10010|01101',
  '%': '11001|11010|00100|00100|01011|10011|00000',
  '#': '01010|01010|11111|01010|11111|01010|01010',
  '*': '00100|10101|01110|11111|01110|10101|00100',
  '+': '00000|00100|00100|11111|00100|00100|00000',
  '=': '00000|00000|11111|00000|11111|00000|00000',
  '\'': '00100|00100|00100|00000|00000|00000|00000',
  '"': '01010|01010|01010|00000|00000|00000|00000',
  '@': '01110|10001|10111|10101|10111|10000|01110',
  '[': '01110|01000|01000|01000|01000|01000|01110',
  ']': '01110|00010|00010|00010|00010|00010|01110',
  '{': '00110|01000|01000|10000|01000|01000|00110',
  '}': '01100|00010|00010|00001|00010|00010|01100',
  '<': '00010|00100|01000|10000|01000|00100|00010',
  '>': '01000|00100|00010|00001|00010|00100|01000',
  '|': '00100|00100|00100|00100|00100|00100|00100',
  '~': '01001|10101|10010|00000|00000|00000|00000',
};

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Compute CRC32 for PNG chunks. */
const CRC_TABLE: readonly number[] = (() => {
  const t = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type);
  const len = u32be(data.length);
  const crc = u32be(crc32(concat(t, data)));
  return concat(len, t, data, crc);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/**
 * Rasterize the snapshot card onto a white 800x480 RGBA buffer and
 * encode it as PNG. The encoder is minimal but valid (verified
 * by the determinism + decode tests).
 */
function renderPng(snap: EvidenceSnapshot): Uint8Array {
  const W = 800;
  const H = 480;
  const buf = new Uint8Array(W * H * 4);
  // Fill white
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 255;
    buf[i + 1] = 255;
    buf[i + 2] = 255;
    buf[i + 3] = 255;
  }

  const setPx = (x: number, y: number, c: Rgba) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    buf[o] = c.r;
    buf[o + 1] = c.g;
    buf[o + 2] = c.b;
    buf[o + 3] = c.a;
  };

  const drawText = (x: number, y: number, text: string, scale: number, c: Rgba) => {
    let cx = x;
    for (const rawCh of text) {
      const ch = rawCh.length === 1 ? rawCh : '?';
      const upper = ch.toUpperCase();
      const glyph = FONT_5x7[ch] ?? FONT_5x7[upper] ?? FONT_5x7['?']!;
      const rows = glyph.split('|');
      for (let ry = 0; ry < FONT_H; ry++) {
        const row = rows[ry] ?? '';
        for (let rx = 0; rx < FONT_W; rx++) {
          if (row[rx] === '1') {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                setPx(cx + rx * scale + sx, y + ry * scale + sy, c);
              }
            }
          }
        }
      }
      cx += (FONT_W + 1) * scale;
    }
  };

  // 1-px border
  const border: Rgba = { r: 208, g: 215, b: 222, a: 255 };
  for (let x = 0; x < W; x++) { setPx(x, 0, border); setPx(x, H - 1, border); }
  for (let y = 0; y < H; y++) { setPx(0, y, border); setPx(W - 1, y, border); }

  // Title and metadata
  const ink: Rgba = { r: 11, g: 18, b: 32, a: 255 };
  const muted: Rgba = { r: 87, g: 96, b: 106, a: 255 };
  const green: Rgba = { r: 26, g: 127, b: 55, a: 255 };
  const title = snap.topicName ? `ERROR SNAPSHOT - ${snap.topicName.toUpperCase()}` : 'ERROR SNAPSHOT';
  drawText(24, 22, title, 2, ink);
  const meta = `Q ${snap.questionId}  A ${snap.attemptId}  ${snap.timestamp}`;
  drawText(24, 44, meta, 1, muted);

  // Sections
  const drawSection = (label: string, body: string, y: number) => {
    drawText(24, y, label, 1, ink);
    let yy = y + 14;
    for (const line of wrap(body, 90)) {
      drawText(24, yy, line, 1, ink);
      yy += 12;
    }
    return yy + 4;
  };

  let y = 64;
  y = drawSection('QUESTION', snap.questionBody, y);
  y = drawSection('YOUR ANSWER', `> ${snap.studentAnswer}`, y);
  y = drawSection('EXPECTED', snap.expectedAnswer, y);

  if (snap.options) {
    drawText(24, y, 'OPTIONS', 1, ink);
    y += 14;
    for (const o of snap.options) {
      const marker = o.isCorrect ? 'V' : '-';
      const line = `${marker} ${o.body}`;
      drawText(32, y, line, 1, o.isCorrect ? green : muted);
      y += 12;
    }
  }

  // PNG: 8-bit RGBA, no interlace
  const SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, W);
  v.setUint32(4, H);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Build raw scanlines with filter byte 0 per row
  const raw = new Uint8Array(H * (1 + W * 4));
  for (let row = 0; row < H; row++) {
    raw[row * (1 + W * 4)] = 0;
    raw.set(buf.subarray(row * W * 4, (row + 1) * W * 4), row * (1 + W * 4) + 1);
  }
  const idat = deflateNoCompression(raw);
  return concat(SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
}

/** Trivial "stored" deflate blocks. No compression — but the
 *  output is still deterministic and decodes correctly. */
function deflateNoCompression(input: Uint8Array): Uint8Array {
  // zlib header (CMF=0x78, FLG=0x01 — no preset dict, check
  // bits valid for stored blocks). Adler-32 footer at the end.
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([0x78, 0x01]));
  let pos = 0;
  const MAX_BLOCK = 0xffff;
  while (pos < input.length) {
    const remaining = input.length - pos;
    const blockLen = Math.min(MAX_BLOCK, remaining);
    const isLast = pos + blockLen >= input.length;
    parts.push(new Uint8Array([isLast ? 1 : 0, blockLen & 0xff, (blockLen >>> 8) & 0xff, ~blockLen & 0xff, (~blockLen >>> 8) & 0xff]));
    parts.push(input.subarray(pos, pos + blockLen));
    pos += blockLen;
  }
  // Adler-32
  let a = 1, b = 0;
  for (let i = 0; i < input.length; i++) {
    a = (a + input[i]!) % 65521;
    b = (b + a) % 65521;
  }
  const adler = (b << 16) | a;
  parts.push(u32be(adler));
  return concat(...parts);
}

/**
 * Public renderer: produce both PNG and SVG for the input DTO.
 * Always returns a result — never throws. The caller picks the
 * preferred format via `preferredMime`.
 */
export function renderSnapshot(snap: EvidenceSnapshot): RenderedSnapshot {
  const svg = renderSvg(snap);
  const png = renderPng(snap);
  return {
    png,
    svg,
    pngSha256: createHash('sha256').update(png).digest('hex'),
    svgSha256: createHash('sha256').update(svg).digest('hex'),
    preferredMime: 'image/png',
  };
}
