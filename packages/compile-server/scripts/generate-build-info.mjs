/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

const buildInfo = {
  // "commit" follows the reasoner's build_message convention: it is the
  // human-readable subject. git_sha is the immutable source revision.
  git_commit: git('log', '-1', '--pretty=%s'),
  git_sha: git('rev-parse', 'HEAD'),
};

writeFileSync(
  join(packageRoot, 'build-info.json'),
  `${JSON.stringify(buildInfo, null, 2)}\n`,
  'utf8'
);
