/**
 * Build script for @agentscript/lsp-browser — parser-javascript mode (default).
 *
 * Tree-sitter and WASM dependencies are externalized (unused).
 */
import { buildBrowserBundle, buildDeclarations } from './build.shared.mjs';

console.log('📦 Building bundles (parser-javascript)...\n');

console.log('1️⃣  Building browser ESM bundle...');
await buildBrowserBundle({ external: ['web-tree-sitter'] });
console.log('   ✓ dist/index.bundle.js created\n');

console.log('2️⃣  Generating TypeScript declarations...');
buildDeclarations();
console.log('   ✓ dist/index.d.ts created\n');

console.log('✅ Build complete!\n');
console.log('   📁 dist/index.bundle.js  → Browser ESM (self-contained)');
console.log('   📁 dist/index.d.ts       → TypeScript declarations\n');
