#!/usr/bin/env node

/**
 * Pre-package changelog check for the Agent Script VS Code extension.
 *
 * Ensures CHANGELOG.md contains a release entry for the current package version
 * (e.g. ## [1.2.11] - YYYY-MM-DD) before creating a VSIX. If the version is
 * missing, prints a warning and prompts for confirmation; in non-TTY environments
 * (e.g. CI), set ACCEPT_CHANGELOG_WARNING=1 to continue without interaction.
 * Run automatically via the "prepackage" npm script before "package" / build:vsix.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

const cwd = process.cwd();
const packagePath = resolve(cwd, 'package.json');
const changelogPath = resolve(cwd, 'CHANGELOG.md');

if (!existsSync(packagePath)) {
  console.error('package.json not found');
  process.exit(1);
}

if (!existsSync(changelogPath)) {
  console.error(
    'CHANGELOG.md not found. Please add a CHANGELOG.md before packaging.'
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
const version = pkg.version;
if (!version) {
  console.error('No version in package.json');
  process.exit(1);
}

const changelog = readFileSync(changelogPath, 'utf-8');
// Match ## [X.Y.Z] or ## [X.Y.Z] - date (Keep a Changelog format)
const versionHeadingRe = /^##\s+\[([^\]]+)\]/gm;
const versionsInChangelog = [];
let m;
while ((m = versionHeadingRe.exec(changelog)) !== null) {
  const v = m[1].trim();
  if (v.toLowerCase() !== 'unreleased') {
    versionsInChangelog.push(v);
  }
}

const hasVersion = versionsInChangelog.includes(version);

function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(res => {
    rl.question(question, answer => {
      rl.close();
      res((answer || '').trim().toLowerCase());
    });
  });
}

if (hasVersion) {
  process.exit(0);
}

console.warn('');
console.warn(
  `CHANGELOG.md has no release entry for version ${version}. Please add a section like: ## [${version}] - YYYY-MM-DD`
);
console.warn('');

if (!process.stdin.isTTY) {
  if (process.env.ACCEPT_CHANGELOG_WARNING === '1') {
    process.exit(0);
  }
  console.error(
    'Run with ACCEPT_CHANGELOG_WARNING=1 to continue without a TTY, or update CHANGELOG.md.'
  );
  process.exit(1);
}

const answer = await prompt('Continue with packaging anyway? (y/N): ');
if (answer === 'y' || answer === 'yes') {
  process.exit(0);
}
process.exit(1);
