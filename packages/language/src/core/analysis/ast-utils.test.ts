/**
 * Tests for isPositionInRange in ast-utils.ts.
 *
 * The function uses inclusive boundaries on both ends, meaning a cursor at
 * start.character or at end.character is considered "in range". This matches
 * the expected editor behaviour for hover / rename / definition lookups where
 * a cursor just after the last character of a token should still resolve to
 * that token.
 */

import { describe, test, expect } from 'vitest';
import { isPositionInRange } from './ast-utils.js';
import type { Range } from '../types.js';

function range(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number
): Range {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

describe('isPositionInRange', () => {
  // ── Single-line ranges ─────────────────────────────────────────────────────

  describe('single-line range', () => {
    const r = range(0, 4, 0, 8); // characters 4-8 on line 0

    test('returns true for position at start boundary (character === start)', () => {
      expect(isPositionInRange(0, 4, r)).toBe(true);
    });

    test('returns true for position in the middle of the range', () => {
      expect(isPositionInRange(0, 6, r)).toBe(true);
    });

    test('returns true for position at end boundary (character === end) — inclusive end', () => {
      // This is the key fix: end is now inclusive so character 8 must be true.
      expect(isPositionInRange(0, 8, r)).toBe(true);
    });

    test('returns false for position before start', () => {
      expect(isPositionInRange(0, 3, r)).toBe(false);
    });

    test('returns false for position past end', () => {
      expect(isPositionInRange(0, 9, r)).toBe(false);
    });

    test('returns false for wrong line (line before)', () => {
      expect(isPositionInRange(-1, 6, r)).toBe(false);
    });

    test('returns false for wrong line (line after)', () => {
      expect(isPositionInRange(1, 6, r)).toBe(false);
    });
  });

  // ── Zero-width range (start === end) ──────────────────────────────────────

  describe('zero-width range (collapsed)', () => {
    const r = range(0, 5, 0, 5);

    test('returns true for position exactly at the single point', () => {
      // A collapsed range at (0,5)–(0,5): the single position 5 should match.
      expect(isPositionInRange(0, 5, r)).toBe(true);
    });

    test('returns false for position before the collapsed point', () => {
      expect(isPositionInRange(0, 4, r)).toBe(false);
    });

    test('returns false for position after the collapsed point', () => {
      expect(isPositionInRange(0, 6, r)).toBe(false);
    });
  });

  // ── Multi-line ranges ──────────────────────────────────────────────────────

  describe('multi-line range', () => {
    const r = range(2, 3, 5, 7); // line 2 col 3 → line 5 col 7

    test('returns true for position at the start boundary', () => {
      expect(isPositionInRange(2, 3, r)).toBe(true);
    });

    test('returns true for position at end of start line (past start col)', () => {
      expect(isPositionInRange(2, 20, r)).toBe(true);
    });

    test('returns true for a line entirely in the middle of the range', () => {
      expect(isPositionInRange(3, 0, r)).toBe(true);
      expect(isPositionInRange(4, 999, r)).toBe(true);
    });

    test('returns true for position at end boundary (line === end, character === end) — inclusive end', () => {
      expect(isPositionInRange(5, 7, r)).toBe(true);
    });

    test('returns true for position before end col on end line', () => {
      expect(isPositionInRange(5, 0, r)).toBe(true);
      expect(isPositionInRange(5, 6, r)).toBe(true);
    });

    test('returns false for position before start col on start line', () => {
      expect(isPositionInRange(2, 2, r)).toBe(false);
    });

    test('returns false for position past end col on end line', () => {
      expect(isPositionInRange(5, 8, r)).toBe(false);
    });

    test('returns false for line before the range', () => {
      expect(isPositionInRange(1, 10, r)).toBe(false);
    });

    test('returns false for line after the range', () => {
      expect(isPositionInRange(6, 0, r)).toBe(false);
    });
  });

  // ── Range starting at column 0 ────────────────────────────────────────────

  describe('range starting at column 0', () => {
    const r = range(1, 0, 1, 5);

    test('returns true at start (character 0)', () => {
      expect(isPositionInRange(1, 0, r)).toBe(true);
    });

    test('returns true at end (character 5) — inclusive end', () => {
      expect(isPositionInRange(1, 5, r)).toBe(true);
    });

    test('returns false past end (character 6)', () => {
      expect(isPositionInRange(1, 6, r)).toBe(false);
    });
  });
});
