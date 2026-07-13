/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../src/compile.js';
import { parseSource } from '../../test/test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('language modality compilation', () => {
  describe('invalid locale produces warning instead of error', () => {
    it('should emit a warning (not error) for invalid default_locale', () => {
      const source = `
config:
    agent_name: "InvalidLocaleBot"

language:
    default_locale: "xx_INVALID"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const localeWarnings = diagnostics.filter(
        d =>
          d.severity === DiagnosticSeverity.Warning &&
          d.message.includes('default_locale')
      );
      expect(localeWarnings.length).toBe(1);
      expect(localeWarnings[0].message).toContain('xx_INVALID');

      const localeErrors = diagnostics.filter(
        d =>
          d.severity === DiagnosticSeverity.Error &&
          d.message.includes('default_locale')
      );
      expect(localeErrors).toHaveLength(0);

      expect(output.agent_version.modality_parameters.language).toBeDefined();
    });

    it('should emit warnings for invalid additional_locales', () => {
      const source = `
config:
    agent_name: "InvalidAdditionalLocaleBot"

language:
    default_locale: "en_US"
    additional_locales: "zz_BAD, yy_NOPE"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const localeWarnings = diagnostics.filter(
        d =>
          d.severity === DiagnosticSeverity.Warning &&
          d.message.includes('additional_locale')
      );
      expect(localeWarnings.length).toBe(2);
      expect(localeWarnings[0].message).toContain('zz_BAD');
      expect(localeWarnings[1].message).toContain('yy_NOPE');

      const localeErrors = diagnostics.filter(
        d =>
          d.severity === DiagnosticSeverity.Error &&
          d.message.includes('additional_locale')
      );
      expect(localeErrors).toHaveLength(0);

      expect(output.agent_version.modality_parameters.language).toBeDefined();
      expect(
        output.agent_version.modality_parameters.language?.default_locale
      ).toBe('en_US');
    });

    it('should still compile language config when locales are invalid', () => {
      const source = `
config:
    agent_name: "CompilesDespiteInvalidBot"

language:
    default_locale: "not_a_locale"
    all_additional_locales: True

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      expect(output.agent_version.modality_parameters.language).toBeDefined();
      expect(
        output.agent_version.modality_parameters.language
          ?.all_additional_locales
      ).toBe(true);

      const hasWarning = diagnostics.some(
        d =>
          d.severity === DiagnosticSeverity.Warning &&
          d.message.includes('not_a_locale')
      );
      expect(hasWarning).toBe(true);
    });
  });

  describe('adaptive flag', () => {
    it('omits adaptive from output when not specified in source', () => {
      const source = `
config:
    agent_name: "LangBot"

language:
    default_locale: "en_US"

start_agent main:
    description: "test"
`;
      const { output } = compile(parseSource(source));
      const lang = output.agent_version.modality_parameters.language;
      expect(lang).toBeDefined();
      expect(lang?.default_locale).toBe('en_US');
      expect(JSON.parse(JSON.stringify(lang))).not.toHaveProperty('adaptive');
    });

    it('emits adaptive: true and skips the missing default_locale error when adaptive is True', () => {
      const source = `
config:
    agent_name: "AdaptiveBot"

language:
    adaptive: True

start_agent main:
    description: "test"
`;
      const { output, diagnostics } = compile(parseSource(source));
      const lang = output.agent_version.modality_parameters.language;
      expect(lang).toBeDefined();
      expect(lang?.adaptive).toBe(true);
      expect(lang?.default_locale).toBeUndefined();
      expect(JSON.parse(JSON.stringify(lang))).not.toHaveProperty(
        'default_locale'
      );
      expect(lang?.additional_locales).toEqual([]);
      expect(lang?.all_additional_locales).toBe(false);

      const errors = diagnostics.filter(
        d =>
          d.severity === DiagnosticSeverity.Error &&
          d.message.includes('default_locale')
      );
      expect(errors).toHaveLength(0);
    });

    it('keeps every supplied field in JSON when adaptive: True coexists with other fields', () => {
      const source = `
config:
    agent_name: "AdaptiveWithLocaleBot"

language:
    adaptive: True
    default_locale: "en_US"
    additional_locales: "fr, de"
    all_additional_locales: True

start_agent main:
    description: "test"
`;
      const { output } = compile(parseSource(source));
      const lang = output.agent_version.modality_parameters.language;
      expect(lang).toEqual({
        adaptive: true,
        default_locale: 'en_US',
        additional_locales: expect.arrayContaining(['fr', 'de']),
        all_additional_locales: true,
      });
    });

    it('does not warn when adaptive is False even with default_locale set', () => {
      const source = `
config:
    agent_name: "NonAdaptiveBot"

language:
    adaptive: False
    default_locale: "fr"

start_agent main:
    description: "test"
`;
      const { output } = compile(parseSource(source));
      const lang = output.agent_version.modality_parameters.language;
      expect(lang?.adaptive).toBe(false);
      expect(lang?.default_locale).toBe('fr');
    });

    it('preserves the missing-default_locale error when adaptive is False', () => {
      const source = `
config:
    agent_name: "BadLangBot"

language:
    adaptive: False

start_agent main:
    description: "test"
`;
      const { diagnostics } = compile(parseSource(source));
      const errors = diagnostics.filter(
        d =>
          d.severity === DiagnosticSeverity.Error &&
          d.message.includes('default_locale')
      );
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
