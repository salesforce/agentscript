/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

function getWorkspacePackageVersions(
  useTreeSitter: boolean
): Record<string, string> {
  const packages = [
    'packages/agentforce',
    'dialect/agentforce',
    'dialect/agentscript',
    'packages/compiler',
    'packages/language',
    'packages/lsp',
    'packages/monaco',
    'packages/parser',
    // Include only the active parser backend
    useTreeSitter
      ? 'packages/parser-tree-sitter'
      : 'packages/parser-javascript',
  ];
  const versions: Record<string, string> = {};
  for (const pkg of packages) {
    const pkgJson = JSON.parse(
      readFileSync(resolve(__dirname, '../../', pkg, 'package.json'), 'utf-8')
    );
    versions[pkgJson.name] = pkgJson.version;
  }
  return versions;
}

// Detect tree-sitter backend via resolve conditions (set via --conditions=tree-sitter)
const useTreeSitter =
  process.argv.includes('--conditions=tree-sitter') ||
  process.env.VITE_PARSER_BACKEND === 'tree-sitter';

// https://vite.dev/config/
export default defineConfig({
  define: {
    __AGENTSCRIPT_PACKAGE_VERSIONS__: JSON.stringify(
      getWorkspacePackageVersions(useTreeSitter)
    ),
  },
  base: process.env.VITE_BASE_PATH || '/',
  resolve: {
    alias: {
      '~': resolve(__dirname, './src'),
    },
    // Ensure monaco-editor is deduped (single instance across all imports)
    dedupe: ['monaco-editor'],
  },
  worker: {
    format: 'es', // Use ES modules for workers (required for code-splitting)
  },
  optimizeDeps: {
    // Force monaco-editor to be bundled as a single module
    include: ['monaco-editor'],
  },
  build: {
    commonjsOptions: {
      // Ensure monaco-editor is treated as a singleton
      include: [/monaco-editor/, /node_modules/],
    },
    rollupOptions: {
      output: {
        sourcemapExcludeSources: true,
        manualChunks(id) {
          if (id.includes('monaco-editor')) {
            return 'monaco';
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    watch: {
      ignored: ['**/playwright-report/**'],
    },
    hmr: {
      port: 27401,
    },
    port: 27002,
    // Uncomment to enable API proxy when deploying with a backend server.
    // proxy: {
    //   '/api': {
    //     target: 'http://localhost:8080',
    //     changeOrigin: true,
    //     ws: true,
    //   },
    // },
  },
  plugins: [react(), tailwindcss()],
});
