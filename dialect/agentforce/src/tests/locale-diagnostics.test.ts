/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import { parse } from '@agentscript/parser';
import { createLanguageService } from '@agentscript/language';
import { agentforceDialect } from '../index.js';

/**
 * These tests assert what the EDITOR sees for `additional_locales`.
 *
 * The editor surfaces diagnostics through `LanguageService` (parse + lint),
 * which reports only diagnostics attached to a CST node — NOT the aggregated
 * parse-time diagnostics list that `parseWithDiagnostics`-style tests inspect.
 * A diagnostic can therefore be present in the parse-time list yet invisible in
 * the editor. Exercising `LanguageService.update()` here closes that gap and
 * guards the locale behavior end to end:
 *   - the three YAML-style forms (block/inline, bare/quoted) are clean,
 *   - the comma-separated string form is also clean (no longer deprecated), and
 *   - non-string members surface a type-mismatch — all in the editor.
 */
function analyze(additionalLocales: string) {
  const source = [
    'config:',
    '    agent_name: "LocaleDemo"',
    '',
    'language:',
    '    default_locale: "en_US"',
    additionalLocales,
    '',
    'start_agent main:',
    '    description: "demo"',
  ].join('\n');
  const service = createLanguageService({ dialect: agentforceDialect });
  service.update(parse(source).rootNode);
  return service;
}

describe('additional_locales diagnostics are visible in the editor', () => {
  test.each([
    [
      'block list, quoted',
      ['    additional_locales:', '        - "en_GB"', '        - "fr"'],
    ],
    [
      'block list, bare',
      ['    additional_locales:', '        - en_GB', '        - fr'],
    ],
    [
      'block list, mixed',
      ['    additional_locales:', '        - en_GB', '        - "fr"'],
    ],
    ['inline list, quoted', ['    additional_locales: ["en_GB", "fr"]']],
    ['inline list, bare', ['    additional_locales: [en_GB, fr]']],
  ])('%s is clean in the editor', (_name, lines) => {
    const service = analyze(lines.join('\n'));
    expect(service.diagnostics).toEqual([]);
  });

  test('bare members do not leak into the identifier-validation lint pass', () => {
    const service = analyze(
      ['    additional_locales:', '        - en_GB', '        - fr'].join('\n')
    );
    // A bare locale is normalized to a string literal, so it is never treated
    // as an undefined reference (`'en_GB' is not a defined value`).
    expect(service.diagnostics.map(d => d.code)).not.toContain(
      'unknown-identifier'
    );
  });

  test('comma-separated string is clean in the editor', () => {
    const service = analyze('    additional_locales: "en_GB,fr"');
    expect(service.diagnostics).toEqual([]);
  });

  test('non-string members surface a type-mismatch', () => {
    const service = analyze(
      ['    additional_locales:', '        - 42'].join('\n')
    );
    expect(service.diagnostics.map(d => d.code)).toContain('type-mismatch');
  });
});
