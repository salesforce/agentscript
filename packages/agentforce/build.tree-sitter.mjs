/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Build script for @agentscript/agentforce — tree-sitter mode.
 *
 * Full build: WASM generation + Node.js ESM + browser ESM +
 * browser IIFE + TypeScript declarations + WASM constants.
 *
 * Run via: node build.mjs --tree-sitter
 */
import { build } from 'esbuild';
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  __dirname,
  buildNodeBundle,
  buildDeclarations,
  generateWasmConstants,
} from './build.shared.mjs';

console.log('🌳 Building (tree-sitter) with WASM support\n');

// ─── WASM generation ─────────────────────────────────────────────────

const wasmFiles = {
  TREE_SITTER_ENGINE_BASE64: 'node_modules/web-tree-sitter/tree-sitter.wasm',
  TREE_SITTER_AGENTSCRIPT_BASE64: '../parser/tree-sitter-agentscript.wasm',
};

// 0. Build parser WASM
const parserDir = resolve(__dirname, '../parser');
const wasmPath = resolve(parserDir, 'tree-sitter-agentscript.wasm');

console.log('0️⃣  Building parser WASM...');
try {
  execSync('pnpm run build:wasm', {
    cwd: parserDir,
    stdio: 'inherit',
  });
  console.log('   ✓ Parser WASM built successfully\n');
} catch (error) {
  if (existsSync(wasmPath)) {
    console.log(
      '⚠️  WASM build failed, but existing WASM found - continuing\n'
    );
  } else {
    console.error('❌ Failed to build parser WASM and no existing WASM found');
    console.error('   Error:', error.message);
    process.exit(1);
  }
}

// 0b. Generate WASM constants as TypeScript source
console.log('0️⃣b Generating WASM constants source file...');
generateWasmConstants(
  wasmFiles,
  resolve(__dirname, 'src/wasm-constants-generated.ts')
);
console.log('   ✓ Generated src/wasm-constants-generated.ts\n');

// ─── Bundles ─────────────────────────────────────────────────────────

// 1. Node.js ESM bundle (shared) — resolve parser with tree-sitter condition
await buildNodeBundle({
  external: ['tree-sitter', 'web-tree-sitter'],
  conditions: ['tree-sitter'],
});

// 2. Browser bundle ESM (self-contained with web-tree-sitter bundled)
console.log('Building browser ESM bundle (self-contained)...');
await build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/browser.js',
  platform: 'neutral',
  target: 'es2020',
  external: ['tree-sitter', 'fs', 'fs/promises', 'path', 'module', 'url'],
  sourcemap: true,
  minify: false,
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  },
});
console.log('   ✓ dist/browser.js created (ESM, includes web-tree-sitter)');

// 2b. Browser IIFE bundle for script tags (self-sufficient, includes WASM)
console.log('Building browser IIFE bundle (for script tags)...');
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);
await build({
  entryPoints: ['src/browser-iife.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'AgentforceScriptSDK',
  outfile: 'dist/browser.iife.js',
  platform: 'browser',
  target: 'es2020',
  external: ['tree-sitter', 'fs', 'fs/promises', 'path', 'module', 'url'],
  sourcemap: true,
  minify: false,
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
    __PACKAGE_VERSION__: JSON.stringify(version),
  },
});
console.log('   ✓ dist/browser.iife.js created (fully self-sufficient)\n');

// ─── Declarations ────────────────────────────────────────────────────

buildDeclarations();

// ─── WASM constants export ──────────────────────────────────────────

console.log('Generating WASM constants...');
generateWasmConstants(wasmFiles, resolve(__dirname, 'dist/wasm-constants.js'), {
  verbose: true,
});

copyFileSync(
  resolve(__dirname, 'src/wasm-constants.d.ts'),
  resolve(__dirname, 'dist/wasm-constants.d.ts')
);
console.log('   ✓ dist/wasm-constants.js created\n');

// ─── Summary ─────────────────────────────────────────────────────────

console.log('✅ Build complete!\n');
console.log('   📁 dist/index.js          → Node.js (with peer deps)');
console.log('   📁 dist/index.d.ts        → TypeScript declarations');
console.log('   📁 dist/browser.js        → Browser ESM (self-contained)');
console.log(
  '   📁 dist/browser.iife.js   → Browser IIFE (script tag, window.AgentforceScriptSDK)'
);
console.log('   📁 dist/wasm-constants.js → WASM binaries (base64)');
console.log('');
