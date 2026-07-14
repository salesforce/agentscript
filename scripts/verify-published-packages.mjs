/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Post-publish smoke test: install what we just published straight from the
 * registry, the way a consumer does, and import it.
 *
 * Two releases have now shipped artifacts that could not be imported at all:
 *
 *   #35 - dist/ still referenced the internal @agentscript/* scope after the
 *         publish rewrite, so consumers hit ERR_MODULE_NOT_FOUND.
 *   #71 - agentforce, compiler and agentforce-dialect were published pinning
 *         @sf-agentscript/language@2.5.4 while their dist/ had been compiled
 *         against a newer language, so consumers hit
 *           SyntaxError: ... does not provide an export named
 *                        'nullLiteralValidationPass'
 *         and
 *           TypeError: ....variantMatch is not a function
 *
 * Why this runs *after* `changeset publish` rather than in CI: inside the
 * workspace pnpm resolves siblings from source, and packing from the workspace
 * always produces a self-consistent set of tarballs. Both bugs only surface once
 * a dependent resolves a sibling from the *registry* - i.e. only in a real
 * consumer install. A pre-publish pack-and-install check would happily pass
 * while the published artifact is broken, so we verify the real thing.
 *
 * Note: this deliberately uses `npm`, not `pnpm`, for the consumer install -
 * pnpm-workspace.yaml sets `minimumReleaseAge: 1440`, which would refuse to
 * install a package published seconds ago.
 *
 * Usage:
 *   node scripts/verify-published-packages.mjs
 *       verify every publishable workspace package at its current version
 *   node scripts/verify-published-packages.mjs @sf-agentscript/compiler@2.7.1
 *       verify explicit <name>@<version> specs (handy for spot-checking npm)
 *
 * Exits non-zero if any published package cannot be imported, so a broken
 * release fails the workflow loudly instead of sitting silently on npm.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Run a package-manager binary. On Windows `npm`/`pnpm` are `.cmd` shims, and
 * since Node 20 execFile refuses to spawn those without a shell (EINVAL), so we
 * opt into one there. CI runs on Linux, where the plain binary is spawned.
 */
const run = (bin, args, opts = {}) =>
  execFileSync(bin, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  });

// How long to wait for a freshly published version to reach the registry.
const REGISTRY_RETRIES = 5;
const REGISTRY_RETRY_DELAY_MS = 5000;
const IMPORT_TIMEOUT_MS = 60_000;

/**
 * Entry points that are not meant to be imported bare in Node. Keyed by the
 * package name without its scope, so this works either side of the publish-time
 * scope rewrite. Each reason was confirmed by importing the published package.
 */
const NOT_BARE_IMPORTABLE = {
  'lsp-server':
    'server entry - a bare import throws "Connection input stream is not set" by design',
  'lsp-browser': 'browser bundle - calls browser-only APIs on import',
  monaco: 'ships TypeScript source as its entry (src/index.ts)',
  'parser-tree-sitter':
    'native binding - needs a platform-aware check, not a bare import',
};

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

/** The specifier a consumer actually loads for `import '<pkg>'`. */
function defaultEntry(pkgJson) {
  const dot = pkgJson.exports?.['.'];
  const target =
    typeof dot === 'string' ? dot : (dot?.import ?? dot?.default ?? null);
  return target ?? pkgJson.main ?? null;
}

const unscoped = name =>
  name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;

/** Why this package is not import-tested, or null if it should be. */
function skipReason(pkgJson, pkgPath) {
  if (pkgJson.private) return 'private';

  const declared = NOT_BARE_IMPORTABLE[unscoped(pkgJson.name)];
  if (declared) return declared;

  if (existsSync(join(pkgPath, 'binding.gyp'))) {
    return 'native addon (binding.gyp)';
  }

  const entry = defaultEntry(pkgJson);
  if (!entry) return 'no entry point declared';
  if (!/\.(js|mjs|cjs)$/.test(entry)) {
    return `entry is not JavaScript (${entry})`;
  }
  return null;
}

const sleep = ms =>
  execFileSync(process.execPath, [
    '-e',
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`,
  ]);

/** True once <name>@<version> is resolvable on the registry. */
function onRegistry(name, version) {
  for (let attempt = 1; attempt <= REGISTRY_RETRIES; attempt++) {
    try {
      const out = run('npm', ['view', `${name}@${version}`, 'version'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (out.trim()) return true;
    } catch (e) {
      // A missing npm binary must not be mistaken for a missing package.
      if (e.code === 'ENOENT' || e.code === 'EINVAL') {
        throw new Error('could not run "npm" - is npm on PATH?');
      }
      // Otherwise: not on the registry yet.
    }
    if (attempt < REGISTRY_RETRIES) sleep(REGISTRY_RETRY_DELAY_MS);
  }
  return false;
}

const firstErrorLine = output => {
  const lines = output.toString().split('\n');
  const hit = lines.map(l => l.trim()).find(l => /error/i.test(l));
  return (hit ?? lines[0] ?? '').slice(0, 200);
};

/**
 * Install <name>@<version> into a clean directory exactly as a consumer would,
 * then import it in a child process. Returns an error string, or null on success.
 */
function verifyConsumerInstall(name, version) {
  const dir = mkdtempSync(join(tmpdir(), 'agentscript-smoke-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'agentscript-smoke-test',
      version: '0.0.0',
      private: true,
      type: 'module',
    })
  );

  try {
    run('npm', ['install', `${name}@${version}`, '--no-audit', '--no-fund'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return `install failed: ${firstErrorLine(e.stderr || e.message)}`;
  }

  try {
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(name)});`],
      {
        cwd: dir,
        encoding: 'utf8',
        timeout: IMPORT_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (e) {
    return `import failed: ${firstErrorLine(e.stderr || e.message)}`;
  }

  return null;
}

/** Explicit `<name>@<version>` specs, or the publishable workspace packages. */
function targets() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args.map(spec => {
      const at = spec.lastIndexOf('@');
      if (at <= 0) throw new Error(`expected <name>@<version>, got "${spec}"`);
      return { name: spec.slice(0, at), version: spec.slice(at + 1) };
    });
  }

  const workspace = JSON.parse(
    run('pnpm', ['-r', 'list', '--json', '--depth', '-1'], { cwd: ROOT })
  );

  const out = [];
  for (const pkg of workspace) {
    const pkgJsonPath = join(pkg.path, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = readJson(pkgJsonPath);
    const skip = skipReason(pkgJson, pkg.path);
    if (skip) {
      console.log(`  - ${pkgJson.name} - skipped (${skip})`);
      continue;
    }
    out.push({ name: pkgJson.name, version: pkgJson.version });
  }
  return out;
}

// ---------------------------------------------------------------------------

console.log('\nVerifying published packages install and import cleanly\n');

const failures = [];
let checked = 0;

for (const { name, version } of targets()) {
  if (!onRegistry(name, version)) {
    console.log(`  - ${name}@${version} - skipped (not on the registry)`);
    continue;
  }

  const error = verifyConsumerInstall(name, version);
  checked++;
  if (error) {
    failures.push({ name, version, error });
    console.log(`  FAIL ${name}@${version}\n         ${error}`);
  } else {
    console.log(`  ok   ${name}@${version}`);
  }
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} of ${checked} published package(s) cannot be imported by a consumer.`
  );
  console.error('The release is on npm but broken - publish a fix now.\n');
  process.exit(1);
}

console.log(`\nAll ${checked} published package(s) import cleanly.\n`);
