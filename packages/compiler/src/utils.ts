/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Normalize a developer name to a human-readable label.
 * Handles both snake_case and CamelCase.
 * - snake_case: replaces underscores with spaces, Title Case each word
 * - CamelCase: inserts spaces before uppercase letters, preserves casing
 */
export function normalizeDeveloperName(name: string): string {
  // First replace underscores with spaces
  let spaced = name.replace(/_/g, ' ');
  // Then split CamelCase (insert space before uppercase preceded by lowercase)
  spaced = spaced.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Insert space at letter→digit and digit→letter boundaries (e.g. "S4S" → "S 4 S")
  spaced = spaced.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  spaced = spaced.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  // Title Case each word
  return spaced.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Convert a description to a single-line string.
 * Joins multi-line descriptions with spaces, trims whitespace.
 */
export function descriptionToStr(
  description: string | undefined | null
): string {
  if (!description) return '';
  return description.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a URI like "model://sfdc_ai__DefaultEinsteinHyperClassifier"
 * into its components.
 */
export function parseUri(uri: string): { scheme: string; path: string } {
  const match = uri.match(/^(\w+):\/\/(.+)$/);
  if (!match) return { scheme: '', path: uri };
  return { scheme: match[1], path: match[2] };
}

/**
 * Convert a config block label to the expected output format.
 * If label is not explicitly set, generate from developer_name using Title Case.
 */
export function deriveLabel(
  developerName: string,
  explicitLabel?: string
): string {
  if (explicitLabel) return explicitLabel;
  return normalizeDeveloperName(developerName);
}

/**
 * Dedent a multi-line string by removing the common leading whitespace.
 * Also strips leading/trailing blank lines and whitespace from blank lines.
 *
 * Input:  "\n            Line 1\n            Line 2\n"
 * Output: "Line 1\nLine 2"
 */
export function dedent(text: string): string {
  // Strip leading newlines, but preserve one if there were multiple.
  // Convention: 2+ newlines after `|` signals an intentional blank line.
  // This is shared with `stripLeadingNewlines()` in packages/language/src/core/expressions.ts.
  const leadingNewlines = text.match(/^\n+/)?.[0]?.length ?? 0;
  const preserveNewline = leadingNewlines >= 2;
  const result = text.replace(/^\n+/, '');
  // Split into lines
  const lines = result.split('\n');

  if (lines.length <= 1) {
    // Single line — strip leading whitespace only, preserve trailing
    const trimmed = result.trimStart();
    return preserveNewline ? '\n' + trimmed : trimmed;
  }

  // For multi-line: compute minimum indentation from lines 2+ only
  // (the first line typically has minimal/no indent because it follows `|` or block start)
  let minIndent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    const indent = lines[i].match(/^(\s*)/)?.[1]?.length ?? 0;
    minIndent = Math.min(minIndent, indent);
  }
  if (minIndent === Infinity) minIndent = 0;

  // Trim the first line's leading whitespace independently
  lines[0] = lines[0].trimStart();

  // Remove common indentation from subsequent lines
  if (minIndent > 0) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().length === 0) {
        lines[i] = ''; // Strip all whitespace from blank lines
        continue;
      }
      const lineIndent = lines[i].match(/^(\s*)/)?.[1]?.length ?? 0;
      if (lineIndent >= minIndent) {
        lines[i] = lines[i].slice(minIndent);
      }
    }
  }

  let joined = lines.join('\n').trimEnd();
  if (preserveNewline) {
    joined = '\n' + joined;
  }
  return joined;
}
