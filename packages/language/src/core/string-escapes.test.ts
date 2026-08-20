/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { escapeStringValue, interpretEscape } from './string-escapes.js';

describe('string escapes', () => {
  it('interprets an escaped apostrophe', () => {
    expect(interpretEscape("'")).toBe("'");
  });

  it('does not escape ordinary apostrophes in double-quoted output', () => {
    expect(escapeStringValue("don't")).toBe("don't");
  });

  it('preserves double quote, backslash, and newline escaping', () => {
    expect(interpretEscape('"')).toBe('"');
    expect(interpretEscape('\\')).toBe('\\');
    expect(interpretEscape('n')).toBe('\n');
    expect(escapeStringValue('say "hello"\\next\nline')).toBe(
      'say \\"hello\\"\\\\next\\nline'
    );
  });
});
