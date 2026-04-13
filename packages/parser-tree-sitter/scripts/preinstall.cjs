#!/usr/bin/env node

/*
 * Copyright 2026 Salesforce Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

const fs = require('fs');
const path = require('path');

const parserPath = path.join(__dirname, '..', 'src', 'parser.c');

// Check if parser.c exists — it should be checked into git,
// so this is just a safety check for unusual situations.
if (!fs.existsSync(parserPath)) {
  console.warn(
    'Warning: src/parser.c not found. It should be checked into git.'
  );
  console.warn('Run "pnpm run generate" after install to regenerate it.');
  console.warn(
    'If tree-sitter CLI is not installed: cargo install tree-sitter-cli'
  );
} else {
  console.log('Parser source file found, skipping generation.');
}
