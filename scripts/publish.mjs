/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Publish script for CI: rewrites @agentscript/* → @sf-agentscript/* in all
 * package.json files, in compiled dist/ output, and in shipped src/ at publish
 * time, then publishes to npm.
 *
 * This allows the codebase to use @agentscript/* internally while publishing
 * under the @sf-agentscript npm scope. Without rewriting dist/ and src/,
 * consumers see ERR_MODULE_NOT_FOUND for @agentscript/* at runtime because
 * tsc emits the literal source specifiers into dist/*.js.
 *
 * Versions are NOT computed here — they come from each package.json (resolved
 * upstream by semantic-release and synced into this repo). `pnpm -r publish`
 * skips private packages and any version already on the registry, so this is
 * idempotent: re-running after a sync only publishes newly-bumped packages.
 */

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const INTERNAL_SCOPE = '@agentscript/';
const PUBLISH_SCOPE = '@sf-agentscript/';

// File extensions whose contents may contain bare module specifiers we need to
// rewrite. Sourcemaps (.map) embed `sources`/`names` strings as plain JSON, so
// a text replace is safe and keeps stack traces / debugger paths consistent.
const REWRITE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.cts',
  '.mts',
  '.map',
]);

// Directories inside each package that may contain rewritable files. We
// rewrite `src/` because most packages ship it (see "files" in package.json).
const REWRITE_DIRS = ['dist', 'src'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function rewriteFile(path) {
  const raw = readFileSync(path, 'utf8');
  const rewritten = raw.replaceAll(INTERNAL_SCOPE, PUBLISH_SCOPE);
  if (rewritten !== raw) {
    writeFileSync(path, rewritten);
    return true;
  }
  return false;
}

// Step 1: Discover all workspace packages
const output = execFileSync('pnpm', ['-r', 'list', '--json', '--depth', '-1'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const packages = JSON.parse(output);

// Step 2: Rewrite package.json files to publish scope
let pkgJsonCount = 0;
for (const pkg of packages) {
  const pkgJsonPath = join(pkg.path, 'package.json');
  if (rewriteFile(pkgJsonPath)) {
    pkgJsonCount++;
    console.log(
      `  ✓ ${pkg.name} → ${pkg.name.replace(INTERNAL_SCOPE, PUBLISH_SCOPE)}`
    );
  }
}

// Step 3: Rewrite source-text files inside each package's published dirs.
// tsc emits source import specifiers verbatim into dist/, and most packages
// also ship src/, so consumers will see @agentscript/* unless we patch both.
let fileCount = 0;
for (const pkg of packages) {
  for (const dir of REWRITE_DIRS) {
    const fullDir = join(pkg.path, dir);
    if (!existsSync(fullDir) || !statSync(fullDir).isDirectory()) continue;
    for (const file of walk(fullDir)) {
      const dot = file.lastIndexOf('.');
      const ext = dot === -1 ? '' : file.slice(dot);
      if (!REWRITE_EXTENSIONS.has(ext)) continue;
      if (rewriteFile(file)) fileCount++;
    }
  }
}

console.log(
  `\nRewrote ${pkgJsonCount} package.json files and ${fileCount} dist/src files to ${PUBLISH_SCOPE}* scope\n`
);

// Step 4: Re-install so pnpm resolves workspace: references with new names
execFileSync('pnpm', ['install', '--no-frozen-lockfile'], {
  cwd: ROOT,
  stdio: 'inherit',
});

// Step 5: Publish every public workspace package at the version in its
// package.json. `pnpm -r publish` iterates the workspace, skips packages
// marked `"private": true`, resolves `workspace:*` deps to exact versions in
// the tarball, and no-ops any version already on the registry — so this is
// safe to re-run on every sync. --no-git-checks because CI publishes from a
// detached/ephemeral checkout with the scope-rewrite left uncommitted.
execFileSync(
  'pnpm',
  ['-r', 'publish', '--no-git-checks', '--access', 'public'],
  {
    cwd: ROOT,
    stdio: 'inherit',
  }
);
