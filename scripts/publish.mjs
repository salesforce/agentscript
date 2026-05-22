/**
 * Publish script for CI: rewrites @agentscript/* → @sf-agentscript/* in all
 * package.json files and built dist files at publish time, then runs
 * changeset publish.
 *
 * This allows the codebase to use @agentscript/* internally while publishing
 * under the @sf-agentscript npm scope.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INTERNAL_SCOPE = '@agentscript/';
const PUBLISH_SCOPE = '@sf-agentscript/';
const DIST_FILE_SUFFIXES = [
  '.js',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.d.mts',
  '.d.cts',
  '.map',
];

export function shouldRewriteDistFile(fileName) {
  return DIST_FILE_SUFFIXES.some(suffix => fileName.endsWith(suffix));
}

function rewriteScopeInFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const rewritten = raw.replaceAll(INTERNAL_SCOPE, PUBLISH_SCOPE);

  if (rewritten === raw) {
    return false;
  }

  writeFileSync(filePath, rewritten);
  return true;
}

export function rewriteDistFiles(directory) {
  if (!existsSync(directory)) {
    return 0;
  }

  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      count += rewriteDistFiles(entryPath);
    } else if (entry.isFile() && shouldRewriteDistFile(entry.name)) {
      count += rewriteScopeInFile(entryPath) ? 1 : 0;
    }
  }

  return count;
}

function main() {
  // Step 1: Discover all workspace packages
  const output = execFileSync(
    'pnpm',
    ['-r', 'list', '--json', '--depth', '-1'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    }
  );
  const packages = JSON.parse(output);

  // Step 2: Rewrite package.json files to publish scope
  let packageJsonCount = 0;
  for (const pkg of packages) {
    const pkgJsonPath = join(pkg.path, 'package.json');

    if (rewriteScopeInFile(pkgJsonPath)) {
      packageJsonCount++;
      console.log(
        `  ✓ ${pkg.name} → ${pkg.name.replace(INTERNAL_SCOPE, PUBLISH_SCOPE)}`
      );
    }
  }

  // Step 3: Rewrite changeset config so it recognizes the new package names
  const changesetConfigPath = join(ROOT, '.changeset', 'config.json');
  const changesetRaw = readFileSync(changesetConfigPath, 'utf8');
  writeFileSync(
    changesetConfigPath,
    changesetRaw.replaceAll(INTERNAL_SCOPE, PUBLISH_SCOPE)
  );

  // Step 4: Rewrite built package outputs to publish scope
  let distFileCount = 0;
  for (const pkg of packages) {
    distFileCount += rewriteDistFiles(join(pkg.path, 'dist'));
  }

  console.log(
    `\nRewrote ${packageJsonCount} package.json files and ${distFileCount} dist files to ${PUBLISH_SCOPE}* scope\n`
  );

  // Step 5: Re-install so pnpm resolves workspace: references with new names
  execFileSync('pnpm', ['install', '--no-frozen-lockfile'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // Step 6: Publish via changeset
  execFileSync('pnpm', ['changeset', 'publish'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
