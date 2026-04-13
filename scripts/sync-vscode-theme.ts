#!/usr/bin/env npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */
/**
 * Syncs theme colors from packages/monaco/src/theme.ts → packages/vscode/package.json
 *
 * Usage: pnpm sync-theme
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  darkThemeColors,
  lightThemeColors,
  buildVscodeRules,
} from '../packages/monaco/src/theme';

const PACKAGE_JSON_PATH = resolve(
  import.meta.dirname,
  '../packages/vscode/package.json'
);

const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));

const darkRules = buildVscodeRules(darkThemeColors);
const lightRules = buildVscodeRules(lightThemeColors);

pkg.contributes.configurationDefaults[
  'editor.semanticTokenColorCustomizations'
] = {
  // Top-level rules = dark theme (default for all themes)
  rules: darkRules,
  // Light theme overrides
  '[Default Light+]': { rules: lightRules },
  '[Default Light Modern]': { rules: lightRules },
  '[Default High Contrast Light]': { rules: lightRules },
};

writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n');

console.log('Synced theme colors to packages/vscode/package.json');
