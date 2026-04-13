/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Build script for @agentscript/agentforce — parser-javascript mode (default).
 *
 * Builds: Node.js ESM bundle + browser ESM + browser IIFE + TypeScript declarations.
 * No WASM generation — tree-sitter imports are stubbed out.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { buildNodeBundle, buildDeclarations } from './build.shared.mjs';

console.log('📦 Building (parser-javascript)...\n');

// ── esbuild plugin: stub tree-sitter-only imports ───────────────────────

/** Replaces web-tree-sitter and wasm-constants-generated with empty modules. */
const stubTreeSitterPlugin = {
  name: 'stub-tree-sitter',
  setup(b) {
    b.onResolve({ filter: /^web-tree-sitter$/ }, () => ({
      path: 'web-tree-sitter',
      namespace: 'stub',
    }));
    b.onResolve({ filter: /wasm-constants-generated/ }, () => ({
      path: 'wasm-constants-generated',
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => {
      if (args.path === 'wasm-constants-generated') {
        return {
          contents:
            'export const TREE_SITTER_ENGINE_BASE64 = [];\nexport const TREE_SITTER_AGENTSCRIPT_BASE64 = [];',
          loader: 'js',
        };
      }
      // web-tree-sitter — side-effect-only import, empty module is fine
      return { contents: '', loader: 'js' };
    });
  },
};

// ── Bundles ─────────────────────────────────────────────────────────────

// 1. Node.js ESM bundle
await buildNodeBundle();

// 2. Browser ESM bundle
console.log('Building browser ESM bundle (parser-javascript)...');
await build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/browser.js',
  platform: 'neutral',
  target: 'es2020',
  external: ['tree-sitter', 'fs', 'fs/promises', 'path', 'module', 'url'],
  plugins: [stubTreeSitterPlugin],
  sourcemap: true,
  minify: false,
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  },
});
console.log('   ✓ dist/browser.js created (ESM, parser-javascript)\n');

// 3. Browser WASM IIFE bundle for script tags
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);
console.log('Building browser IIFE bundle (parser-javascript)...');
await build({
  entryPoints: ['src/browser-iife.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'AgentforceScriptSDK',
  outfile: 'dist/browser.iife.js',
  platform: 'browser',
  target: 'es2020',
  external: ['tree-sitter', 'fs', 'fs/promises', 'path', 'module', 'url'],
  plugins: [stubTreeSitterPlugin],
  sourcemap: true,
  minify: false,
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
    __PACKAGE_VERSION__: JSON.stringify(version),
  },
});
console.log('   ✓ dist/browser.iife.js created (IIFE, parser-wasm)\n');

// 4. Browser JS IIFE bundle for script tags
console.log('Building browser IIFE bundle (parser-javascript)...');
await build({
  entryPoints: ['src/browser-js-iife.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'AgentforceScriptSDK',
  outfile: 'dist/browser-js.iife.js',
  platform: 'browser',
  target: 'es2020',
  external: ['fs', 'fs/promises', 'path', 'module', 'url'],
  plugins: [stubTreeSitterPlugin],
  sourcemap: true,
  minify: false,
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
    __PACKAGE_VERSION__: JSON.stringify(version),
  },
});
console.log('   ✓ dist/browser-js.iife.js created (IIFE, parser-javascript)\n');

// ── Declarations ────────────────────────────────────────────────────────

buildDeclarations();

// ── Summary ─────────────────────────────────────────────────────────────

console.log('✅ Build complete!\n');
console.log('   📁 dist/index.js          → Node.js (with peer deps)');
console.log('   📁 dist/index.d.ts        → TypeScript declarations');
console.log('   📁 dist/browser.js        → Browser ESM (parser-javascript)');
console.log(
  '   📁 dist/browser.iife.js   → Browser IIFE (parser-javascript, window.AgentforceScriptSDK)'
);
console.log('');
