/**
 * Publish script for CI: rewrites @agentscript/* → @sf-agentscript/* in all
 * package.json files at publish time, then runs changeset publish.
 *
 * This allows the codebase to use @agentscript/* internally while publishing
 * under the @sf-agentscript npm scope.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const INTERNAL_SCOPE = '@agentscript/';
const PUBLISH_SCOPE = '@sf-agentscript/';

// Step 1: Discover all workspace packages
const output = execFileSync('pnpm', ['-r', 'list', '--json', '--depth', '-1'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const packages = JSON.parse(output);

// Step 2: Rewrite package.json files to publish scope
let count = 0;
for (const pkg of packages) {
  const pkgJsonPath = join(pkg.path, 'package.json');
  const raw = readFileSync(pkgJsonPath, 'utf8');
  const rewritten = raw.replaceAll(INTERNAL_SCOPE, PUBLISH_SCOPE);

  if (rewritten !== raw) {
    writeFileSync(pkgJsonPath, rewritten);
    count++;
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

console.log(
  `\nRewrote ${count} package.json files to ${PUBLISH_SCOPE}* scope\n`
);

// Step 4: Re-install so pnpm resolves workspace: references with new names
execFileSync('pnpm', ['install', '--no-frozen-lockfile'], {
  cwd: ROOT,
  stdio: 'inherit',
});

// Step 5: Publish via changeset
execFileSync('pnpm', ['changeset', 'publish'], {
  cwd: ROOT,
  stdio: 'inherit',
});
