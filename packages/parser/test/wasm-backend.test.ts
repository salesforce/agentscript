/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { stripWasmSourceMapUrl } from '../src/wasm-backend.js';

// ── Helpers for constructing WASM binaries ──────────────────────────────

/** WASM magic (\0asm) + version 1. */
const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** Encode an unsigned integer as LEB128 bytes. */
function leb128(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

/** Build a custom section (id=0): name + payload, all wrapped with section header. */
function customSection(name: string, payload: number[] = []): number[] {
  const nameBytes = Array.from(new TextEncoder().encode(name));
  const content = [...leb128(nameBytes.length), ...nameBytes, ...payload];
  return [0x00, ...leb128(content.length), ...content];
}

/** Build a non-custom section with the given id and raw body bytes. */
function regularSection(id: number, body: number[]): number[] {
  return [id, ...leb128(body.length), ...body];
}

/** Concatenate any mix of number arrays / Uint8Arrays into a Uint8Array. */
function bytes(...parts: Array<number[] | Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p instanceof Uint8Array ? p : Uint8Array.from(p), offset);
    offset += p.length;
  }
  return out;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('stripWasmSourceMapUrl', () => {
  describe('input validation (returns same reference)', () => {
    it('returns input unchanged when length is less than 8 bytes', () => {
      const input = new Uint8Array([0x00, 0x61, 0x73]);
      expect(stripWasmSourceMapUrl(input)).toBe(input);
    });

    it('returns input unchanged when the WASM magic is invalid', () => {
      const input = new Uint8Array([
        0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00,
      ]);
      expect(stripWasmSourceMapUrl(input)).toBe(input);
    });

    it('returns the empty-after-header WASM unchanged', () => {
      const input = bytes(HEADER);
      // No sections to strip → returns the same reference (optimization path).
      expect(stripWasmSourceMapUrl(input)).toBe(input);
    });
  });

  describe('when no sourceMappingURL section exists (same reference)', () => {
    it('preserves a single non-sourceMappingURL custom section', () => {
      const input = bytes(HEADER, customSection('name', [0x01, 0x02, 0x03]));
      expect(stripWasmSourceMapUrl(input)).toBe(input);
    });

    it('preserves multiple non-custom sections', () => {
      const input = bytes(
        HEADER,
        regularSection(1, [0x60, 0x00, 0x00]), // type section (id=1)
        regularSection(3, [0x01, 0x00]), // function section (id=3)
        regularSection(10, [0x01, 0x02, 0x0b]) // code section (id=10)
      );
      expect(stripWasmSourceMapUrl(input)).toBe(input);
    });

    it('preserves custom sections whose names share a prefix with sourceMappingURL', () => {
      const input = bytes(
        HEADER,
        customSection('source', [0xaa]),
        customSection('sourceMap', [0xbb]),
        customSection('sourceMappingURLs', [0xcc]) // trailing 's' — not a match
      );
      expect(stripWasmSourceMapUrl(input)).toBe(input);
    });
  });

  describe('when a sourceMappingURL section exists (returns new buffer)', () => {
    it('strips a sourceMappingURL section that appears alone', () => {
      const sourceMap = customSection('sourceMappingURL', [0x01, 0x02]);
      const input = bytes(HEADER, sourceMap);
      const expected = bytes(HEADER);

      const result = stripWasmSourceMapUrl(input);

      expect(result).not.toBe(input);
      expect(result).toEqual(expected);
    });

    it('preserves a different custom section while stripping sourceMappingURL', () => {
      const keep = customSection('name', [0x42]);
      const drop = customSection('sourceMappingURL', [0x99]);
      const input = bytes(HEADER, keep, drop);
      const expected = bytes(HEADER, keep);

      expect(stripWasmSourceMapUrl(input)).toEqual(expected);
    });

    it('strips sourceMappingURL even when sandwiched between other sections', () => {
      const typeSection = regularSection(1, [0x60, 0x00, 0x00]);
      const drop = customSection('sourceMappingURL', [0xff]);
      const codeSection = regularSection(10, [0x01, 0x02, 0x0b]);

      const input = bytes(HEADER, typeSection, drop, codeSection);
      const expected = bytes(HEADER, typeSection, codeSection);

      expect(stripWasmSourceMapUrl(input)).toEqual(expected);
    });

    it('strips only the sourceMappingURL section when other custom sections are present', () => {
      const otherCustom = customSection('externalDebugInfo', [0x01, 0x02]);
      const drop = customSection('sourceMappingURL', [0x33, 0x44]);
      const anotherCustom = customSection('producers', [0x55]);

      const input = bytes(HEADER, otherCustom, drop, anotherCustom);
      const expected = bytes(HEADER, otherCustom, anotherCustom);

      expect(stripWasmSourceMapUrl(input)).toEqual(expected);
    });

    it('strips every sourceMappingURL section when more than one is present', () => {
      // The WASM spec allows custom sections to repeat with the same name.
      const keep1 = customSection('first', [0x01]);
      const drop1 = customSection('sourceMappingURL', [0xa1]);
      const keep2 = regularSection(1, [0x60, 0x00, 0x00]);
      const drop2 = customSection('sourceMappingURL', [0xa2, 0xa3]);
      const keep3 = customSection('last', [0x02]);

      const input = bytes(HEADER, keep1, drop1, keep2, drop2, keep3);
      const expected = bytes(HEADER, keep1, keep2, keep3);

      const result = stripWasmSourceMapUrl(input);
      expect(result).toEqual(expected);
      expect(result).not.toBe(input);
    });
  });

  describe('LEB128 size encoding', () => {
    it('handles a section whose payload requires multi-byte LEB128 size', () => {
      // Payload of 200 bytes forces 2-byte LEB128 (200 > 127).
      const largePayload = Array.from({ length: 200 }, (_, i) => i & 0xff);
      const drop = customSection('sourceMappingURL', largePayload);
      const keep = regularSection(1, [0x60, 0x00, 0x00]);

      const input = bytes(HEADER, keep, drop);
      const expected = bytes(HEADER, keep);

      expect(stripWasmSourceMapUrl(input)).toEqual(expected);
    });

    it('handles a non-sourceMappingURL section whose payload requires multi-byte LEB128 size', () => {
      // 500-byte payload in a kept section to exercise size-decoding on the
      // not-stripped path. The function should still return the same reference.
      const largePayload = Array.from({ length: 500 }, (_, i) => i & 0xff);
      const input = bytes(HEADER, customSection('name', largePayload));
      expect(stripWasmSourceMapUrl(input)).toBe(input);
    });
  });

  describe('section ordering and byte-exact reconstruction', () => {
    it('produces a byte-exact reconstruction in original section order', () => {
      const s1 = regularSection(1, [0x60, 0x00, 0x00]);
      const s2 = customSection('first', [0x10]);
      const s3 = customSection('sourceMappingURL', [0x20]);
      const s4 = regularSection(3, [0x01, 0x00]);
      const s5 = customSection('last', [0x30]);

      const input = bytes(HEADER, s1, s2, s3, s4, s5);
      const expected = bytes(HEADER, s1, s2, s4, s5);

      const result = stripWasmSourceMapUrl(input);
      expect(result).toEqual(expected);
      // Sanity: a freshly-stripped buffer should be a new allocation,
      // not a slice/view of the original.
      expect(result).not.toBe(input);
      expect(result.buffer).not.toBe(input.buffer);
    });

    it('idempotency: stripping output is a no-op', () => {
      const input = bytes(
        HEADER,
        customSection('sourceMappingURL', [0xaa, 0xbb])
      );
      const once = stripWasmSourceMapUrl(input);
      const twice = stripWasmSourceMapUrl(once);
      // Second pass has nothing to strip → returns the same reference.
      expect(twice).toBe(once);
    });
  });
});
