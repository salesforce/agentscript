/**
 * Build script for @agentscript/lsp-browser — tree-sitter mode.
 *
 * Bundles web-tree-sitter for WASM parsing in the browser.
 * Native tree-sitter is externalized (Node.js only).
 *
 * Run via: node build.mjs --tree-sitter
 */
import { buildBrowserBundle, buildDeclarations } from './build.shared.mjs';

console.log('📦 Building bundles (tree-sitter)...\n');

console.log('1️⃣  Building browser ESM bundle (includes web-tree-sitter)...');
await buildBrowserBundle({ external: [] });
console.log('   ✓ dist/index.bundle.js created\n');

console.log('2️⃣  Generating TypeScript declarations...');
buildDeclarations();
console.log('   ✓ dist/index.d.ts created\n');

console.log('✅ Build complete!\n');
console.log(
  '   📁 dist/index.bundle.js  → Browser ESM (includes web-tree-sitter)'
);
console.log('   📁 dist/index.d.ts       → TypeScript declarations\n');
