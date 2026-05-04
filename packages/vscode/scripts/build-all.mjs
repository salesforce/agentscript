/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * One-shot build for the VS Code extension and everything it needs to run.
 *
 * Ensures upstream workspace deps are built (via turbo), then runs the
 * extension's esbuild step which bundles extension.js, server.mjs, and the
 * webview (flow.html) into dist/. Use this before F5 or `code --extensionDevelopmentPath`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const vscodeDir = join(repoRoot, 'packages', 'vscode');

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? repoRoot,
  });
  if (result.status !== 0 && !opts.allowFail) {
    console.error(`\nCommand failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result.status ?? 0;
}

// 1. Build every workspace dep of @agentscript/vscode (includes
//    @agentscript/vscode-webview because it's declared as a workspace
//    devDep). The `^...` selector means "all deps of the target, but
//    not the target itself" — the target (extension.js + server.mjs) is
//    built by step 2 via esbuild.mjs.
//
//    Always invoke the build. Turbo's per-package content hash cache
//    makes a no-op run fast when nothing changed, and an existsSync
//    skip would happily serve a stale dist/ if source changed since
//    the last build, producing an extension that silently runs old code.
run('pnpm', ['--filter', '@agentscript/vscode^...', 'run', 'build']);

// 2. Build the extension + server + copy webview flow.html into dist/webview/.
run('node', ['esbuild.mjs'], { cwd: vscodeDir });

// 3. Sanity-check final outputs so F5 doesn't fail mysteriously.
const required = [
  join(vscodeDir, 'dist', 'extension.js'),
  join(vscodeDir, 'dist', 'server.mjs'),
  join(vscodeDir, 'dist', 'webview', 'flow.html'),
];
const missing = required.filter(p => !existsSync(p));
if (missing.length) {
  console.error('\nBuild completed but these outputs are missing:');
  for (const p of missing) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  '\n✓ Build complete. Press F5 to launch the Extension Development Host.'
);
