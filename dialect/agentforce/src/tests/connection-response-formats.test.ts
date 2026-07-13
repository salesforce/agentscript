/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine, collectDiagnostics } from '@agentscript/language';
import { parseDocument, emitDocument, testSchemaCtx } from './test-utils.js';
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

    it('allows all supported URI schemes', () => {
      const source = `
connection messaging:
    response_formats:
        apex_format:
            target: "apex://MyClass"
            inputs:
                field: string
        flow_format:
            target: "flow://MyFlow"
            inputs:
                field: string
        invocable_format:
            target: "standardInvocableAction://MyAction"
            inputs:
                field: string
        prompt_format:
            target: "prompt://MyPrompt"
            inputs:
                field: string
        system_format:
            target: "system://MessagingRichLink"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const targetErrors = diagnostics.filter(
        d =>
          d.code === 'response-format-invalid-target' ||
          d.code === 'response-format-unsupported-target-scheme'
      );
      expect(targetErrors).toHaveLength(0);
    });

    it('errors when target uses an unsupported scheme', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: "externalService://MyService"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const schemeErrors = diagnostics.filter(
        d => d.code === 'response-format-unsupported-target-scheme'
      );

      expect(schemeErrors.length).toBeGreaterThan(0);
      expect(schemeErrors[0].message).toContain('externalService');
      expect(schemeErrors[0].message).toContain('my_format');
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

    it('allows known system:// target names without warning', () => {
      const source = `
connection messaging:
    response_formats:
        rich_link:
            target: "system://MessagingRichLink"
            inputs:
                field: string
        choices:
            target: "system://MessagingChoices"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const warnings = diagnostics.filter(
        d => d.code === 'response-format-unknown-system-target'
      );
      expect(warnings).toHaveLength(0);
    });

    it('warns (non-blocking) when system:// target name is not recognized', () => {
      const source = `
connection messaging:
    response_formats:
        mystery:
            target: "system://NotARealSystemTarget"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const warnings = diagnostics.filter(
        d => d.code === 'response-format-unknown-system-target'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].severity).toBe(2 /* Warning */);
      expect(warnings[0].message).toContain('NotARealSystemTarget');

      // Non-blocking: no error diagnostics for this target.
      const errors = diagnostics.filter(
        d =>
          d.code === 'response-format-invalid-target' ||
          d.code === 'response-format-unsupported-target-scheme'
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe('inputs required, source and target optional', () => {
    it('errors when only source is specified (description and inputs missing)', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            source: "ExistingFormat"
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );
      // Should have 2 errors: missing description and missing inputs
      expect(missingErrors.length).toBeGreaterThanOrEqual(2);
      const messages = missingErrors.map(e => e.message).join(' ');
      expect(messages).toContain('description');
      expect(messages).toContain('inputs');
    });

    it('allows input and target together', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            description: "My format description"
            target: "apex://MyClass"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );
      expect(missingErrors).toHaveLength(0);
    });

    it('allows input alone', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            description: "My format description"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );
      expect(missingErrors).toHaveLength(0);
    });

    it('errors when only target is specified (description and inputs missing)', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            target: "apex://MyClass"
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );
      // Should have 2 errors: missing description and missing inputs
      expect(missingErrors.length).toBeGreaterThanOrEqual(2);
      const messages = missingErrors.map(e => e.message).join(' ');
      expect(messages).toContain('description');
      expect(messages).toContain('inputs');
    });

    it('allows source and input together', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            description: "My format description"
            source: "ExistingFormat"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );

      expect(missingErrors).toHaveLength(0);
    });

    it('errors when source and target are specified without description or inputs', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            source: "ExistingFormat"
            target: "apex://MyClass"
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );

      // Should have 2 errors: missing description and missing inputs
      expect(missingErrors.length).toBeGreaterThanOrEqual(2);
      const messages = missingErrors.map(e => e.message).join(' ');
      expect(messages).toContain('description');
      expect(messages).toContain('inputs');
    });

    it('allows source, input, and target all together', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            description: "My format description"
            source: "ExistingFormat"
            target: "apex://MyClass"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );

      expect(missingErrors).toHaveLength(0);
    });
  });

  describe('required fields validation', () => {
    it('errors when inputs is not specified', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            description: "A format without inputs"
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );

      expect(missingErrors.length).toBeGreaterThan(0);
      expect(missingErrors[0].message).toContain('inputs');
    });

    it('errors when response_formats block is empty (missing all required fields)', () => {
      const source = `
connection messaging:
    response_formats:
        my_format:
`.trimStart();

      const diagnostics = runLint(source);
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );

      // Should have errors for missing required fields (description and/or inputs)
      expect(missingErrors.length).toBeGreaterThan(0);
    });

    it('does not require inputs when target is system://ESTypeMessage', () => {
      const source = `
connection messaging:
    response_formats:
        es_type_format:
            description: "Planner-supplied input schema"
            target: "system://ESTypeMessage"
`.trimStart();

      const diagnostics = runLint(source);
      const missingInputs = diagnostics.filter(
        d =>
          d.code === 'missing-required-field' && d.message.includes("'inputs'")
      );
      expect(missingInputs).toHaveLength(0);
    });

    it('still requires inputs for other system:// targets', () => {
      const source = `
connection messaging:
    response_formats:
        rich_link:
            description: "Needs inputs"
            target: "system://MessagingRichLink"
`.trimStart();

      const diagnostics = runLint(source);
      const missingInputs = diagnostics.filter(
        d =>
          d.code === 'missing-required-field' && d.message.includes("'inputs'")
      );
      expect(missingInputs.length).toBeGreaterThan(0);
    });

    it('warns when inputs are authored for system://ESTypeMessage', () => {
      const source = `
connection messaging:
    response_formats:
        es_type_format:
            description: "Dynamic schema target"
            target: "system://ESTypeMessage"
            inputs:
                ignored: string
`.trimStart();

      const diagnostics = runLint(source);
      const warnings = diagnostics.filter(
        d => d.code === 'response-format-inputs-ignored-for-target'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].severity).toBe(2 /* Warning */);
      expect(warnings[0].message).toContain('ESTypeMessage');
    });
  });

  describe('multiple formats validation', () => {
    it('validates each format independently', () => {
      const source = `
connection messaging:
    response_formats:
        valid_format:
            description: "Valid format"
            source: "ExistingFormat"
            inputs:
                field: string
        invalid_format:
            description: "Invalid target format"
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

      // Should have errors for the missing_required format — it is the only
      // format lacking description and inputs, so the missing-required-field
      // diagnostics must originate from it.
      const missingErrors = diagnostics.filter(
        d => d.code === 'missing-required-field'
      );
      expect(missingErrors.length).toBeGreaterThan(0);
      const messages = missingErrors.map(e => e.message).join(' ');
      expect(messages).toContain('description');
      expect(messages).toContain('inputs');
    });
  });

  describe('response_actions reference validation', () => {
    it('accepts a valid @response_formats reference without errors', () => {
      const source = `
connection messaging:
    reasoning:
        response_actions:
            my_action: @response_formats.real_format
    response_formats:
        real_format:
            description: "Real format"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);
      const refErrors = diagnostics.filter(
        d =>
          d.code === 'response-action-invalid-reference' ||
          d.code === 'lint-pass-error'
      );
      expect(refErrors).toHaveLength(0);
    });

    it('errors when a response_action references a non-response_formats namespace', () => {
      const source = `
connection messaging:
    reasoning:
        response_actions:
            bad_action: @actions.something
    response_formats:
        real_format:
            description: "Real format"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);

      // The validator must not crash (no lint-pass-error from a bad value type)
      const crashes = diagnostics.filter(d => d.code === 'lint-pass-error');
      expect(crashes).toHaveLength(0);

      const refErrors = diagnostics.filter(
        d => d.code === 'response-action-invalid-reference'
      );
      expect(refErrors.length).toBeGreaterThan(0);
      expect(refErrors[0].message).toContain('bad_action');
    });

    it('flags a dangling @response_formats reference without crashing', () => {
      const source = `
connection messaging:
    reasoning:
        response_actions:
            my_action: @response_formats.does_not_exist
    response_formats:
        real_format:
            description: "Real format"
            inputs:
                field: string
`.trimStart();

      const diagnostics = runLint(source);

      const crashes = diagnostics.filter(d => d.code === 'lint-pass-error');
      expect(crashes).toHaveLength(0);

      const undefinedRefs = diagnostics.filter(
        d =>
          d.code === 'undefined-reference' &&
          d.message.includes('does_not_exist')
      );
      expect(undefinedRefs.length).toBeGreaterThan(0);
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
            description: "Custom format with various types"
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
            description: "Portal form format"
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
            description: "Product recommendation format"
            target: "apex://ProductHandler"
            inputs:
                tone:
                    description: "The tone of the response"
                    type: string
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
            description: "Format with numeric constraints"
            target: "apex://Handler"
            inputs:
                greeting:
                    type: string
                        min_length: 1
                        max_length: 200
                confidence:
                    type: integer
                        minimum: 1
                        maximum: 10
                tags:
                    type: list
                        value: string
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
                titleObject:
                    type: object
                        fields:
                            penguin_form:
                                schema: "messaging_component://FormComponent_Penguin"
                                type: object
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

    it('errors when messaging_component schema is used outside of messaging connection', () => {
      const source = `
connection penguin:
    response_formats:
        forms_component:
            inputs:
                penguin_form: object
                    schema: "messaging_component://FormComponent_Penguin"
`.trimStart();

      const diagnostics = runLint(source);
      const surfaceErrors = diagnostics.filter(
        d => d.code === 'response-format-messaging-component-wrong-surface'
      );
      expect(surfaceErrors.length).toBeGreaterThan(0);
      expect(surfaceErrors[0].severity).toBe(1 /* Error */);
      expect(surfaceErrors[0].message).toContain('Messaging components');
      expect(surfaceErrors[0].message).toContain('messaging connection');
    });

    it('does not error for messaging_component schema under connection messaging', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            inputs:
                penguin_form: object
                    schema: "messaging_component://FormComponent_Penguin"
`.trimStart();

      const diagnostics = runLint(source);
      const surfaceErrors = diagnostics.filter(
        d => d.code === 'response-format-messaging-component-wrong-surface'
      );
      expect(surfaceErrors).toHaveLength(0);
    });
  });

  describe('messaging component default value validation', () => {
    it('allows messaging component params that all have default values', () => {
      const source = `
connection messaging:
    response_formats:
        pet_intake_form:
            description: "Pet intake form"
            inputs:
                penguin_form:
                    schema: "messaging_component://FormMessage__PetIntakeForm"
                    type: object
                        fields:
                            defaultSelectedDate: date = @variables.defaultDate
                                description: "the default selected date"
                            timestamp: datetime = "2026-06-08 15:30:00"
                                description: "a timestamp"
                            defaultVet: number = 0
                                description: "the default vet"

variables:
    defaultDate: mutable date
        description: "Default date"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const defaultErrors = diagnostics.filter(
        d => d.code === 'response-format-messaging-component-missing-default'
      );
      expect(defaultErrors).toHaveLength(0);
    });

    it('errors when a messaging component param has no default value', () => {
      const source = `
connection messaging:
    response_formats:
        pet_intake_form:
            description: "Pet intake form"
            inputs:
                penguin_form:
                    schema: "messaging_component://FormMessage__PetIntakeForm"
                    type: object
                        fields:
                            defaultSelectedDate: date
                                description: "the default selected date"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const defaultErrors = diagnostics.filter(
        d => d.code === 'response-format-messaging-component-missing-default'
      );
      expect(defaultErrors.length).toBeGreaterThan(0);
      expect(defaultErrors[0].message).toContain('defaultSelectedDate');
      expect(defaultErrors[0].message).toContain('must have a default value');
    });

    it('reports each messaging component param missing a default', () => {
      const source = `
connection messaging:
    response_formats:
        pet_intake_form:
            description: "Pet intake form"
            inputs:
                penguin_form:
                    schema: "messaging_component://FormMessage__PetIntakeForm"
                    type: object
                        fields:
                            defaultSelectedDate: date
                                description: "the default selected date"
                            defaultVet: number
                                description: "the default vet"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const defaultErrors = diagnostics.filter(
        d => d.code === 'response-format-messaging-component-missing-default'
      );
      const flagged = new Set(
        defaultErrors.flatMap(d =>
          ['defaultSelectedDate', 'defaultVet'].filter(p =>
            d.message.includes(p)
          )
        )
      );
      expect(flagged).toEqual(new Set(['defaultSelectedDate', 'defaultVet']));
    });

    it('does not require defaults on non-messaging-component object inputs', () => {
      const source = `
connection messaging:
    response_formats:
        regular_format:
            description: "Regular format"
            inputs:
                data:
                    type: object
                        fields:
                            name: string
                                description: "a name"
                            age: number
                                description: "an age"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const defaultErrors = diagnostics.filter(
        d => d.code === 'response-format-messaging-component-missing-default'
      );
      expect(defaultErrors).toHaveLength(0);
    });
  });

  describe('schema input exclusivity validation', () => {
    it('allows a schema input as the only input', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            description: "Forms component"
            inputs:
                msgComp: object
                    schema: "messaging_component://DevName"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(
        d => d.code === 'response-format-schema-input-not-exclusive'
      );
      expect(errors).toHaveLength(0);
    });

    it('errors when two schema inputs coexist', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            description: "Forms component"
            inputs:
                msgComp: object
                    schema: "messaging_component://DevName"
                msgComp2: object
                    schema: "messaging_component://DevName"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(
        d => d.code === 'response-format-schema-input-not-exclusive'
      );
      expect(errors.length).toBeGreaterThan(0);
      const messages = errors.map(e => e.message).join(' ');
      expect(messages).toContain('msgComp');
    });

    it('errors when a schema input coexists with a non-schema input', () => {
      const source = `
connection messaging:
    response_formats:
        forms_component:
            description: "Forms component"
            inputs:
                msgComp: object
                    schema: "messaging_component://DevName"
                other: string = "test"
                    description: "another input"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(
        d => d.code === 'response-format-schema-input-not-exclusive'
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('msgComp'))).toBe(true);
    });

    it('does not flag multiple inputs when none declare a schema', () => {
      const source = `
connection messaging:
    response_formats:
        regular_format:
            description: "Regular format"
            inputs:
                field1: string
                    description: "a field"
                field2: string
                    description: "another field"

start_agent main:
    description: "test"
`.trimStart();

      const diagnostics = runLint(source);
      const errors = diagnostics.filter(
        d => d.code === 'response-format-schema-input-not-exclusive'
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe('list default value validation', () => {
    it('allows a list default of primitive literals', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            inputs:
                tags: list[string] = ["a", "b"]

start_agent main:
    description: "test"
`.trimStart();

      const errors = runLint(source).filter(
        d => d.code === 'response-format-list-default-non-primitive'
      );
      expect(errors).toHaveLength(0);
    });

    it('errors on a list default containing variable references', () => {
      const source = `
variables:
    A: string = "a"
    B: string = "b"

connection messaging:
    response_formats:
        f:
            description: "d"
            inputs:
                refs: list[string] = [@variables.A, @variables.B]

start_agent main:
    description: "test"
`.trimStart();

      const errors = runLint(source).filter(
        d => d.code === 'response-format-list-default-non-primitive'
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('refs');
    });

    it('errors on a nested list default of references inside list[object]', () => {
      const source = `
variables:
    A: string = "a"

connection messaging:
    response_formats:
        f:
            description: "d"
            inputs:
                items:
                    type: list
                        value: object
                            fields:
                                tags: list[string] = [@variables.A]

start_agent main:
    description: "test"
`.trimStart();

      const errors = runLint(source).filter(
        d => d.code === 'response-format-list-default-non-primitive'
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('tags');
    });
  });

  describe('fields block placement validation', () => {
    it('warns when an object input declares no fields block', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                shapeless: object
                    is_required: True
`.trimStart();

      const warnings = runLint(source).filter(
        d => d.code === 'response-format-object-missing-fields'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].severity).toBe(2 /* Warning */);
      expect(warnings[0].message).toContain('shapeless');
    });

    it('warns when a list[object] input declares no fields block', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                rows: list[object]
                    is_required: True
`.trimStart();

      const warnings = runLint(source).filter(
        d => d.code === 'response-format-object-missing-fields'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('rows');
    });

    it('does not warn for a messaging component object that uses schema instead of fields', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            inputs:
                form: object
                    schema: "messaging_component://FormMessage__X"
`.trimStart();

      const warnings = runLint(source).filter(
        d => d.code === 'response-format-object-missing-fields'
      );
      expect(warnings).toHaveLength(0);
    });

    it('errors when a non-object input declares a fields block', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                name:
                    is_required: True
                    type: string
                        fields:
                            nope: string
`.trimStart();

      // `fields:` under `type: string` is rejected at parse time
      // (string type doesn't accept the fields parameter).
      const allDiags = runLint(source);
      const errors = allDiags.filter(
        d => d.severity === 1 && d.message.includes('fields')
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    it('does not warn for an object input that declares its fields', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                data:
                    is_required: True
                    type: object
                        fields:
                            title: string
                                is_required: True
`.trimStart();

      const diagnostics = runLint(source).filter(
        d =>
          d.code === 'response-format-object-missing-fields' ||
          d.code === 'response-format-fields-on-non-object'
      );
      expect(diagnostics).toHaveLength(0);
    });

    it('does not error for long-form list with value: object > fields', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                items:
                    is_required: True
                    type: list
                        value: object
                            fields:
                                name: string
                                    is_required: True
`.trimStart();

      const diagnostics = runLint(source).filter(
        d => d.code === 'response-format-fields-on-non-object'
      );
      expect(diagnostics).toHaveLength(0);
    });

    it('warns when long-form list with value: object declares no fields block', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                rows:
                    is_required: True
                    type: list
                        value: object
`.trimStart();

      const warnings = runLint(source).filter(
        d => d.code === 'response-format-object-missing-fields'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('rows');
    });

    it('errors when long-form list with primitive value declares a fields block', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                items:
                    is_required: True
                    type: list
                        value: string
                            fields:
                                nope: string
`.trimStart();

      const allDiags = runLint(source);
      const errors = allDiags.filter(
        d => d.severity === 1 && d.message.includes('fields')
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    it('warns on a nested object sub-field that declares no fields block', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                outer:
                    is_required: True
                    type: object
                        fields:
                            inner: object
                                is_required: True
`.trimStart();

      const warnings = runLint(source).filter(
        d => d.code === 'response-format-object-missing-fields'
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('inner');
    });
  });

  describe('list value parameter validation', () => {
    it('errors when type: list is used without value:', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                items:
                    type: list
                        min_items: 1
`.trimStart();

      const errors = runLint(source).filter(
        d => d.code === 'response-format-list-missing-value'
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].severity).toBe(1 /* Error */);
      expect(errors[0].message).toContain('items');
      expect(errors[0].message).toContain('value');
    });

    it('does not error when type: list has value:', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                items:
                    type: list
                        value: string
                        min_items: 1
`.trimStart();

      const errors = runLint(source).filter(
        d => d.code === 'response-format-list-missing-value'
      );
      expect(errors).toHaveLength(0);
    });

    it('does not error for short-form list[string]', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                items: list[string]
`.trimStart();

      const errors = runLint(source).filter(
        d => d.code === 'response-format-list-missing-value'
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe('fields block parsing', () => {
    it('round-trips a nested fields block through emit', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                choices:
                    is_required: True
                    type: list
                        value: object
                            fields:
                                title: string
                                    is_required: True
`.trimStart();

      const emitted = emitDocument(parseDocument(source));
      expect(emitted).toContain('fields:');
      expect(emitted).toContain('title: string');
      // Re-parsing the emitted source preserves the nested field.
      const reparsed = emitDocument(parseDocument(emitted));
      expect(reparsed).toBe(emitted);
    });

    it('treats a quoted "fields" key as a nested parameter, not the keyword', () => {
      const source = `
connection messaging:
    response_formats:
        f:
            description: "d"
            target: "apex://H"
            inputs:
                data:
                    is_required: True
                    type: object
                        fields:
                            "fields": string
                                is_required: True
`.trimStart();

      const errors = runLint(source).filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });
  });
});
