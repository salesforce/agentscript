/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Generates src/pkg-meta.ts from package.json for dialect packages.
 * Run from the package root: node ../../scripts/sync-pkg-meta.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const dialectName = pkg.name
  .replace('@agentscript/', '')
  .replace('-dialect', '');

const header =
  `/*\n` +
  ` * Copyright (c) 2026, Salesforce, Inc.\n` +
  ` * All rights reserved.\n` +
  ` * SPDX-License-Identifier: Apache-2.0\n` +
  ` * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0\n` +
  ` */\n\n`;

writeFileSync(
  'src/pkg-meta.ts',
  header +
    `// Auto-generated from package.json — do not edit manually.\n` +
    `// Regenerated on build via: node ../../scripts/sync-pkg-meta.mjs\n` +
    `export const DIALECT_NAME = ${JSON.stringify(dialectName)};\n` +
    `export const DIALECT_VERSION = ${JSON.stringify(pkg.version)};\n`
);
