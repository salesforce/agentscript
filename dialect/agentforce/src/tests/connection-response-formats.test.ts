import { describe, it, expect } from 'vitest';
import { LintEngine, collectDiagnostics } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';
import type { Diagnostic } from '@agentscript/types';

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  const { diagnostics: lintDiags } = engine.run(ast, testSchemaCtx);
  const astDiags = collectDiagnostics(ast);
  return [...astDiags, ...lintDiags];
}

describe('connection response_formats validation', () => {
  describe('target URI format validation', () => {
    it('allows valid target URI format (type://Name)', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: "apex://MyApexClass"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const targetErrors = diagnostics.filter(
        d => d.code === 'response-format-invalid-target'
      );
      expect(targetErrors).toHaveLength(0);
    });

    it('allows various valid URI schemes', () => {
      const source = `
connection messaging:
    response_formats:
        apex_format:
            target: "apex://MyClass"
            inputs:
                field: string
        external_format:
            target: "externalService://MyService"
            inputs:
                field: string
        custom_format:
            target: "custom://Something"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const targetErrors = diagnostics.filter(
        d => d.code === 'response-format-invalid-target'
      );
      expect(targetErrors).toHaveLength(0);
    });

    it('errors when target is missing ://', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: "InvalidTarget"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const targetErrors = diagnostics.filter(
        d => d.code === 'response-format-invalid-target'
      );

      expect(targetErrors.length).toBeGreaterThan(0);
      expect(targetErrors[0].message).toContain('type://Name');
      expect(targetErrors[0].message).toContain('my_format');
    });

    it('errors when target has multiple :// separators', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: "type://name://extra"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const targetErrors = diagnostics.filter(
        d => d.code === 'response-format-invalid-target'
      );

      expect(targetErrors.length).toBeGreaterThan(0);
    });

    it('errors when target is empty string', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: ""
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const targetErrors = diagnostics.filter(
        d => d.code === 'response-format-invalid-target'
      );

      expect(targetErrors.length).toBeGreaterThan(0);
    });
  });

  describe('source vs input/target XOR validation', () => {
    it('allows source alone', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            source: "ExistingFormat"
`.trimStart();

      const diagnostics = runLint(source);
      const conflictErrors = diagnostics.filter(
        d => d.code === 'response-format-conflicting-fields'
      );
      expect(conflictErrors).toHaveLength(0);
    });

    it('allows input and target together', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: "apex://MyClass"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const conflictErrors = diagnostics.filter(
        d => d.code === 'response-format-conflicting-fields'
      );
      expect(conflictErrors).toHaveLength(0);
    });

    it('allows input alone', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const conflictErrors = diagnostics.filter(
        d => d.code === 'response-format-conflicting-fields'
      );
      expect(conflictErrors).toHaveLength(0);
    });

    it('allows target alone', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: "apex://MyClass"
`.trimStart();

      const diagnostics = runLint(source);
      const conflictErrors = diagnostics.filter(
        d => d.code === 'response-format-conflicting-fields'
      );
      expect(conflictErrors).toHaveLength(0);
    });

    it('errors when source and input are both specified', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            source: "ExistingFormat"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const conflictErrors = diagnostics.filter(
        d => d.code === 'response-format-conflicting-fields'
      );

      expect(conflictErrors.length).toBeGreaterThan(0);
      expect(conflictErrors[0].message).toContain('my_format');
      expect(conflictErrors[0].message).toContain('source');
      expect(conflictErrors[0].message).toContain('inputs');
    });

    it('errors when source and target are both specified', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            source: "ExistingFormat"
            target: "apex://MyClass"
`.trimStart();

      const diagnostics = runLint(source);
      const conflictErrors = diagnostics.filter(
        d => d.code === 'response-format-conflicting-fields'
      );

      expect(conflictErrors.length).toBeGreaterThan(0);
      expect(conflictErrors[0].message).toContain('my_format');
      expect(conflictErrors[0].message).toContain('source');
      expect(conflictErrors[0].message).toContain('target');
    });

    it('errors when source, input, and target are all specified', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            source: "ExistingFormat"
            target: "apex://MyClass"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const conflictErrors = diagnostics.filter(
        d => d.code === 'response-format-conflicting-fields'
      );

      // Should error for at least one conflict (source vs input or source vs target)
      expect(conflictErrors.length).toBeGreaterThan(0);
    });
  });

  describe('required fields validation', () => {
    it('errors when no source, input, or target is specified', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            description: "A format without required fields"
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'response-format-missing-required-field'
      );

      expect(missingErrors.length).toBeGreaterThan(0);
      expect(missingErrors[0].message).toContain('my_format');
      expect(missingErrors[0].message).toContain('source');
      expect(missingErrors[0].message).toContain('inputs');
      expect(missingErrors[0].message).toContain('target');
    });

    it('errors when response_formats block is empty', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'response-format-missing-required-field'
      );

      expect(missingErrors.length).toBeGreaterThan(0);
    });
  });

  describe('multiple formats validation', () => {
    it('validates each format independently', () => {
      const source = `
connection messaging:
    response_formats:
        valid_format:
            source: "ExistingFormat"
        invalid_format:
            target: "InvalidTarget"
            inputs:
                field: string
        missing_required:
            label: "No required fields"
`.trimStart();

      const diagnostics = runLint(source);

      // Should have error for invalid target
      const targetErrors = diagnostics.filter(
        d => d.code === 'response-format-invalid-target'
      );
      expect(targetErrors.length).toBeGreaterThan(0);
      expect(targetErrors[0].message).toContain('invalid_format');

      // Should have error for missing required fields
      const missingErrors = diagnostics.filter(
        d => d.code === 'response-format-missing-required-field'
      );
      expect(missingErrors.length).toBeGreaterThan(0);
      // Find the error for missing_required format
      const missingRequiredError = missingErrors.find(e =>
        e.message.includes('missing_required')
      );
      expect(missingRequiredError).toBeDefined();
      expect(missingRequiredError!.message).toContain('missing_required');
    });
  });

  describe('structured inputs parsing', () => {
    it('parses flat string inputs without errors', () => {
      const source = `
connection messaging:
    response_formats:
        messaging_choices:
            description: "Messaging choices format"
            target: "apex://MessagingChoicesHandler"
            inputs:
                message: string
                    description: "The message text"
                    is_required: True
                choices: list[string]
                    is_required: True
                title: string
                    description: "Heading for the options"
                    is_required: True
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });

    it('parses inputs with various types', () => {
      const source = `
connection messaging:
    response_formats:
        custom_format:
            target: "apex://Handler"
            inputs:
                name: string
                age: integer
                score: number
                active: boolean
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });

    it('parses inputs with const default value', () => {
      const source = `
connection messaging:
    response_formats:
        portal_form:
            target: "apex://FormHandler"
            inputs:
                form_id: string = "registrationForm"
                    description: "Fixed identifier"
                    is_required: True
                message: string
                    is_required: True
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });

    it('parses inputs with enum values', () => {
      const source = `
connection messaging:
    response_formats:
        product_rec:
            target: "apex://ProductHandler"
            inputs:
                tone: string
                    description: "The tone of the response"
                    enum:
                        - "casual"
                        - "professional"
                        - "enthusiastic"
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });

    it('parses inputs with numeric constraints', () => {
      const source = `
connection messaging:
    response_formats:
        constrained_format:
            target: "apex://Handler"
            inputs:
                greeting: string
                    min_length: 1
                    max_length: 200
                confidence: integer
                    minimum: 1
                    maximum: 10
                tags: list[string]
                    min_items: 1
                    max_items: 5
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });
  });

  describe('schema URI validation', () => {
    it('allows valid messaging_component:// schema URI', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            description: "Use this for forms"
            inputs:
                penguin_form: object
                    schema: "messaging_component://FormMessagingComponent_Penguin"
`.trimStart();

      const diagnostics = runLint(source);
      const schemaErrors = diagnostics.filter(
        d =>
          d.code === 'response-format-invalid-schema-uri' ||
          d.code === 'response-format-invalid-schema-type'
      );
      expect(schemaErrors).toHaveLength(0);
    });

    it('errors for unsupported schema types', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            inputs:
                penguin_form: object
                    schema: "city://city_schema"
`.trimStart();

      const diagnostics = runLint(source);
      const schemaErrors = diagnostics.filter(
        d => d.code === 'response-format-unsupported-schema-type'
      );
      expect(schemaErrors.length).toBeGreaterThan(0);
      expect(schemaErrors[0].message).toContain(
        "unsupported schema type 'city'"
      );
      expect(schemaErrors[0].message).toContain('messaging_component');
    });

    it('errors with invalid-schema-uri for missing :// structure', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            inputs:
                penguin_form: object
                    schema: "just_a_string"
`.trimStart();

      const diagnostics = runLint(source);
      const schemaErrors = diagnostics.filter(
        d => d.code === 'response-format-invalid-schema-uri'
      );
      expect(schemaErrors.length).toBeGreaterThan(0);
      expect(schemaErrors[0].message).toContain(
        "Expected format: 'type://target'"
      );
    });

    it('errors when messaging_component schema is used on a nested field', () => {
      const source = `
connection messaging:
    response_formats:
        choices:
            inputs:
                titleObject: object
                    penguin_form: object
                        schema: "messaging_component://FormComponent_Penguin"
`.trimStart();

      const diagnostics = runLint(source);
      const schemaErrors = diagnostics.filter(
        d => d.code === 'response-format-nested-schema'
      );
      expect(schemaErrors.length).toBeGreaterThan(0);
      expect(schemaErrors[0].message).toContain('nested field');
      expect(schemaErrors[0].message).toContain('top-level');
    });

    it('allows messaging_component schema on top-level input field', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            inputs:
                penguin_form: object
                    schema: "messaging_component://FormComponent_Penguin"
`.trimStart();

      const diagnostics = runLint(source);
      const schemaErrors = diagnostics.filter(
        d => d.code === 'response-format-nested-schema'
      );
      expect(schemaErrors).toHaveLength(0);
    });
  });
});
