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
});
