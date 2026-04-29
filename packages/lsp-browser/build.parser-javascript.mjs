/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Build script for @agentscript/lsp-browser — parser-javascript mode (default).
 *
 * Tree-sitter and WASM dependencies are externalized (unused).
 */
import { buildBrowserBundle, buildDeclarations } from './build.shared.mjs';

console.log('📦 Building bundles (parser-javascript)...\n');

/** Stubs WASM-related modules so they don't appear in compiled output. */
const stubWasmPlugin = {
  name: 'stub-wasm',
  setup(b) {
    b.onResolve({ filter: /wasm-loader/ }, () => ({
      path: 'wasm-loader',
      namespace: 'stub-wasm',
    }));
    b.onResolve({ filter: /wasm-constants-generated/ }, () => ({
      path: 'wasm-constants-generated',
      namespace: 'stub-wasm',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub-wasm' }, args => {
      if (args.path === 'wasm-loader') {
        return {
          contents:
            'export async function loadWasmModule() { return undefined; }',
          loader: 'js',
        };
      }
      return {
        contents:
          'export const TREE_SITTER_ENGINE_BASE64 = [];\nexport const TREE_SITTER_AGENTSCRIPT_BASE64 = [];',
        loader: 'js',
      };
    });
  },
};

console.log('1️⃣  Building browser ESM bundle...');
await buildBrowserBundle({
  external: ['web-tree-sitter'],
  plugins: [stubWasmPlugin],
});
console.log('   ✓ dist/index.bundle.js created\n');

console.log('2️⃣  Generating TypeScript declarations...');
buildDeclarations();
console.log('   ✓ dist/index.d.ts created\n');

console.log('✅ Build complete!\n');
console.log('   📁 dist/index.bundle.js  → Browser ESM (self-contained)');
console.log('   📁 dist/index.d.ts       → TypeScript declarations\n');
