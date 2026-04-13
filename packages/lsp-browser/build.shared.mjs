/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared build helpers for @agentscript/lsp-browser.
 *
 * Both parser-javascript and tree-sitter build variants import from here
 * to avoid duplicating common build logic.
 */
import { build } from 'esbuild';
import { generateDtsBundle } from 'dts-bundle-generator';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build the browser ESM bundle.
 * @param {{ external: string[] }} options
 */
export async function buildBrowserBundle({ external }) {
  await build({
    entryPoints: [resolve(__dirname, 'src/index.ts')],
    bundle: true,
    format: 'esm',
    outfile: 'dist/index.bundle.js',
    platform: 'browser',
    target: 'es2022',
    external: [
      'fs',
      'fs/promises',
      'path',
      'module',
      'url',
      'tree-sitter',
      '@agentscript/parser-tree-sitter',
      ...external,
    ],
    sourcemap: true,
    minify: false,
    legalComments: 'none',
    define: {
      global: 'globalThis',
      'process.env.NODE_ENV': '"production"',
    },
  });
}

/**
 * Generate bundled TypeScript declarations.
 */
export function buildDeclarations() {
  const [dts] = generateDtsBundle([
    {
      filePath: resolve(__dirname, 'src/index.ts'),
      output: { noBanner: true },
    },
  ]);
  mkdirSync('dist', { recursive: true });
  writeFileSync(resolve(__dirname, 'dist/index.d.ts'), dts);
}
