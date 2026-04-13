/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Vitest setup file — generates WASM constants before tests run
 * (only when AGENTSCRIPT_PARSER=tree-sitter).
 *
 * To run tests with tree-sitter:
 *   AGENTSCRIPT_PARSER=tree-sitter pnpm test
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.AGENTSCRIPT_PARSER === 'tree-sitter') {
  const outputPath = resolve(__dirname, 'src/wasm-constants-generated.ts');

  // Only generate if not already present
  if (!existsSync(outputPath)) {
    const wasmFiles = {
      TREE_SITTER_ENGINE_BASE64:
        'node_modules/web-tree-sitter/tree-sitter.wasm',
      TREE_SITTER_AGENTSCRIPT_BASE64: '../parser/tree-sitter-agentscript.wasm',
    };

    let output = '// AUTO-GENERATED FILE. DO NOT EDIT.\n';
    output += '// Contains base64 encoded WebAssembly binaries.\n\n';

    for (const [constName, filePath] of Object.entries(wasmFiles)) {
      const resolvedPath = resolve(__dirname, filePath);
      if (!existsSync(resolvedPath)) {
        console.error(
          `\n❌ WASM file not found: ${resolvedPath}\n` +
            '   Run "pnpm build" in packages/parser-tree-sitter first.\n'
        );
        process.exit(1);
      }
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
    }

    writeFileSync(outputPath, output);
    console.log('✓ Generated WASM constants for tree-sitter tests');
  }
}
