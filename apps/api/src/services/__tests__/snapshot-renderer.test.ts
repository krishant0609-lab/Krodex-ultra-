/**
 * KRODEX API — snapshot renderer tests.
 *
 * The renderer MUST be deterministic: same DTO → same bytes.
 * This file is the canonical guard for that invariant.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { renderSnapshot, type EvidenceSnapshot } from '../snapshot-renderer';

const BASE: EvidenceSnapshot = {
  questionId: '00000000-0000-4000-8000-000000000001',
  questionBody: 'What is 2 + 2?',
  options: [
    { body: '3', isCorrect: false },
    { body: '4', isCorrect: true },
    { body: '5', isCorrect: false },
  ],
  studentAnswer: '5',
  expectedAnswer: '4',
  topicName: 'Arithmetic',
  attemptId: '00000000-0000-4000-8000-000000000002',
  timestamp: '2026-09-01T10:00:00.000Z',
  sourceIds: ['a', 'b'],
};

function hash(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

describe('renderSnapshot — determinism', () => {
  it('produces byte-identical PNG and SVG for the same DTO', () => {
    const a = renderSnapshot(BASE);
    const b = renderSnapshot(BASE);
    expect(hash(a.png)).toBe(hash(b.png));
    expect(hash(a.svg)).toBe(hash(b.svg));
    expect(a.pngSha256).toBe(b.pngSha256);
    expect(a.svgSha256).toBe(b.svgSha256);
  });

  it('different DTO produces different bytes', () => {
    const a = renderSnapshot(BASE);
    const b = renderSnapshot({ ...BASE, studentAnswer: '4' });
    expect(a.pngSha256).not.toBe(b.pngSha256);
  });

  it('no I/O — runs without network / clock / random access', () => {
    // Pure-data test: calling 100x in a tight loop never throws and
    // never produces a different hash.
    const a = renderSnapshot(BASE);
    for (let i = 0; i < 100; i++) {
      const b = renderSnapshot(BASE);
      expect(b.pngSha256).toBe(a.pngSha256);
    }
  });
});

describe('renderSnapshot — PNG validity', () => {
  it('PNG output starts with the canonical 8-byte signature', () => {
    const { png } = renderSnapshot(BASE);
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(Array.from(png.subarray(0, 8))).toEqual(sig);
  });

  it('first chunk after the signature is IHDR', () => {
    const { png } = renderSnapshot(BASE);
    // bytes 8-11 = chunk length, 12-15 = type
    expect(String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!)).toBe('IHDR');
  });

  it('always carries an IEND terminator', () => {
    const { png } = renderSnapshot(BASE);
    const tail = String.fromCharCode(png[png.length - 8]!, png[png.length - 7]!, png[png.length - 6]!, png[png.length - 5]!);
    // 4 bytes of CRC + 4 bytes of 'IEND'
    expect(tail).toBe('IEND');
  });

  it('PNG has the documented 800x480 dimensions', () => {
    const { png } = renderSnapshot(BASE);
    const w = (png[16]! << 24) | (png[17]! << 16) | (png[18]! << 8) | png[19]!;
    const h = (png[20]! << 24) | (png[21]! << 16) | (png[22]! << 8) | png[23]!;
    expect(w).toBe(800);
    expect(h).toBe(480);
  });
});

describe('renderSnapshot — SVG validity', () => {
  it('SVG output starts with the XML declaration', () => {
    const { svg } = renderSnapshot(BASE);
    const s = new TextDecoder().decode(svg.subarray(0, 38));
    expect(s.startsWith('<?xml version="1.0"')).toBe(true);
  });

  it('escapes hostile input', () => {
    const evil: EvidenceSnapshot = {
      ...BASE,
      questionBody: '<script>alert(1)</script>',
      studentAnswer: '5 & 4',
    };
    const { svg } = renderSnapshot(evil);
    const s = new TextDecoder().decode(svg);
    expect(s).not.toContain('<script>');
    expect(s).toContain('&lt;script&gt;');
    expect(s).toContain('&amp;');
  });
});
