/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Build entry point for @agentscript/agentforce.
 *
 * Delegates to the parser-javascript or tree-sitter build variant:
 *   node build.mjs                 → parser-javascript (default)
 *   node build.mjs --tree-sitter   → tree-sitter (WASM + browser bundles)
 */
const isTreeSitter = process.argv.includes('--tree-sitter');

if (isTreeSitter) {
  await import('./build.tree-sitter.mjs');
} else {
  await import('./build.parser-javascript.mjs');
}
