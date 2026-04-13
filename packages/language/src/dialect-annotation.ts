/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Parse `# @dialect: NAME=VERSION` annotations from document source.
 */

export interface DialectAnnotation {
  /** Dialect name, lowercased (e.g., 'agentforce'). */
  name: string;
  /** Optional version constraint (e.g., '1.1.0' or '1'). */
  version?: string;
  /** Zero-based line number where the annotation was found. */
  line: number;
  /** Zero-based character offset of the NAME portion within the line. */
  nameStart: number;
  /** Length of the NAME portion. */
  nameLength: number;
  /** Zero-based character offset of the VERSION portion (after '='). -1 if no version. */
  versionStart: number;
  /** Length of the VERSION portion. 0 if no version. */
  versionLength: number;
}

// Version: major only (e.g., 2) or major.minor (e.g., 2.2).
// When minor is specified it acts as a minimum minor version for that major.
const DIALECT_PATTERN = /^#\s*@dialect:\s*(\w+)(?:=(\d+(?:\.\d+)?))?/im;

/**
 * Parse a `# @dialect: NAME=VERSION` annotation from the first ~10 lines of source.
 * Returns null if no annotation is found.
 */
export function parseDialectAnnotation(
  source: string
): DialectAnnotation | null {
  // Only scan the first 10 lines for the annotation
  const lines = source.split('\n', 10);
  for (let i = 0; i < lines.length; i++) {
    const match = DIALECT_PATTERN.exec(lines[i]);
    if (match) {
      const nameStart = match.index + match[0].indexOf(match[1]);
      const version = match[2] || undefined;
      let versionStart = -1;
      let versionLength = 0;
      if (version) {
        // Version starts after the '=' sign
        versionStart = match.index + match[0].lastIndexOf(version);
        versionLength = version.length;
      }
      return {
        name: match[1].toLowerCase(),
        version,
        line: i,
        nameStart,
        nameLength: match[1].length,
        versionStart,
        versionLength,
      };
    }
  }
  return null;
}
