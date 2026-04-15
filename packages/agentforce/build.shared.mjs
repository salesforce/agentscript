/**
 * Shared build helpers for @agentscript/agentforce.
 *
 * Both parser-javascript and tree-sitter build variants import from here
 * to avoid duplicating common build logic.
 */
import { build } from 'esbuild';
import { generateDtsBundle } from 'dts-bundle-generator';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build the Node.js ESM bundle.
 * @param {{ external?: string[], conditions?: string[], plugins?: import('esbuild').Plugin[] }} options
 */
export async function buildNodeBundle({
  external = [],
  conditions = [],
  plugins = [],
} = {}) {
  console.log('Building Node.js bundle (external deps)...');
  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    outfile: 'dist/index.js',
    platform: 'neutral',
    target: 'es2022',
    external: [
      '@agentscript/compiler',
      '@agentscript/language',
      '@agentscript/parser',
      ...external,
    ],
    conditions,
    plugins,
    sourcemap: true,
  });
  console.log('   ✓ dist/index.js created\n');
}

/**
 * Generate bundled TypeScript declarations.
 */
export function buildDeclarations() {
  console.log('Generating TypeScript declarations...');
  const [dts] = generateDtsBundle([
    {
      filePath: 'src/index.ts',
      output: { noBanner: true },
    },
  ]);
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/index.d.ts', dts);
  console.log('   ✓ dist/index.d.ts created\n');
}

/**
 * Encode WASM files as base64 JavaScript constants.
 * @param {Record<string, string>} fileMapping - Map of const name → WASM file path
 * @param {string} outputPath - Where to write the output
 * @param {{ verbose?: boolean }} options
 */
export function generateWasmConstants(
  fileMapping,
  outputPath,
  { verbose = false } = {}
) {
  let output = '// AUTO-GENERATED FILE. DO NOT EDIT.\n';
  output += '// Contains base64 encoded WebAssembly binaries.\n\n';

  for (const [constName, filePath] of Object.entries(fileMapping)) {
    const resolvedPath = resolve(__dirname, filePath);
    try {
      const wasmBuffer = readFileSync(resolvedPath);
      const base64String = wasmBuffer.toString('base64');
      const chunks = base64String.match(/.{1,2}/g) || [];
      let array = '[';
      for (let i = 0; i < chunks.length; i++) {
        array += `"${chunks[i]}"`;
        if (i < chunks.length - 1) array += ',';
      }
      array += ']';
      output += `export const ${constName} = ${array};\n\n`;
      if (verbose) console.log(`   ✓ Encoded ${constName}`);
    } catch (error) {
      console.error(
        `   ❌ Error: Could not read '${filePath}':`,
        error.message
      );
      process.exit(1);
    }
  }

  writeFileSync(outputPath, output);
}
