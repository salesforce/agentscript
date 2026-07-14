/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for compiling connection response_formats:
 * - input description template interpolation
 * - input schema constraint placement (array vs items)
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

function compileSource(source: string) {
  const ast = parseSource(source);
  return compile(ast);
}

function findSurface(result: ReturnType<typeof compile>, surfaceType: string) {
  const surfaces = result.output.agent_version.surfaces ?? [];
  return surfaces.find(s => s.surface_type === surfaceType);
}

function getResponseFormat(
  result: ReturnType<typeof compile>,
  formatName: string
) {
  const surfaces = result.output.agent_version.surfaces ?? [];
  for (const surface of surfaces) {
    const format = surface.response_formats?.find(
      f => f.developer_name === formatName
    );
    if (format) return format;
  }
  throw new Error(`Format ${formatName} not found`);
}

function getFormatInputSchema(
  result: ReturnType<typeof compile>,
  formatName: string
): Record<string, unknown> {
  const format = getResponseFormat(result, formatName);
  if (format.input_schema) {
    return JSON.parse(format.input_schema);
  }
  throw new Error(`Format ${formatName} has no input_schema`);
}

describe('Response format description templates', () => {
  it('should support a static format-level description', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        my_format:
            description: "A static format description"
            inputs:
                field1: string

start_agent main:
    description: "test"
`;
    const format = getResponseFormat(compileSource(source), 'my_format');
    expect(format.description).toBe('A static format description');
  });

  it('should interpolate @variables references in the format-level description', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    channel: string = "messaging"

connection test:
    response_formats:
        my_format:
            description: |
                Use this format on the {!@variables.channel} channel
            inputs:
                field1: string

start_agent main:
    description: "test"
`;
    const format = getResponseFormat(compileSource(source), 'my_format');
    expect(format.description).toBe(
      'Use this format on the {{state.channel}} channel'
    );
  });
});

describe('Response format input description templates', () => {
  it('should support static descriptions (backwards compatibility)', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        my_format:
            description: "Test format"
            inputs:
                field1: string
                    description: "This is a static description"
                    is_required: True

start_agent main:
    description: "test"
`;
    const result = compileSource(source);
    const schema = getFormatInputSchema(result, 'my_format');

    expect(schema.properties.field1.description).toBe(
      'This is a static description'
    );
  });

  it('should interpolate @variables references in descriptions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    field_name: string = "username"

connection test:
    response_formats:
        my_format:
            description: "Test format"
            inputs:
                field1: string
                    description: |
                        The {!@variables.field_name} field
                    is_required: True

start_agent main:
    description: "test"
`;
    const result = compileSource(source);
    const schema = getFormatInputSchema(result, 'my_format');

    expect(schema.properties.field1.description).toBe(
      'The {{state.field_name}} field'
    );
  });

  it('should interpolate @inputs references in descriptions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    inputs:
        user_id: string
            description: "The user ID"

    response_formats:
        my_format:
            description: "Test format"
            inputs:
                field1: string
                    description: "Field for user {!@inputs.user_id}"
                    is_required: True

start_agent main:
    description: "test"
`;
    const result = compileSource(source);
    const schema = getFormatInputSchema(result, 'my_format');

    // @inputs.user_id will resolve to the connection.inputs.user_id reference
    // The template compiles to a reference expression
    expect(schema.properties.field1.description).toContain('user');
  });

  it('should support multi-line template descriptions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    app_name: string = "MyApp"

connection test:
    response_formats:
        my_format:
            description: "Test format"
            inputs:
                field1: string
                    description: |
                        This field is used by {!@variables.app_name}
                        to store user preferences.
                    is_required: True

start_agent main:
    description: "test"
`;
    const result = compileSource(source);
    const schema = getFormatInputSchema(result, 'my_format');

    expect(schema.properties.field1.description).toContain(
      '{{state.app_name}}'
    );
    expect(schema.properties.field1.description).toContain('preferences');
  });

  it('should handle nested object field descriptions with templates', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    entity_type: string = "Product"

connection test:
    response_formats:
        my_format:
            description: "Test format"
            inputs:
                data:
                    description: "Data container"
                    is_required: True
                    type: object
                        fields:
                            name: string
                                description: |
                                    The {!@variables.entity_type} name

                            price: number
                                description: |
                                    The {!@variables.entity_type} price

start_agent main:
    description: "test"
`;
    const result = compileSource(source);
    const schema = getFormatInputSchema(result, 'my_format');

    expect(schema.properties.data.properties.name.description).toBe(
      'The {{state.entity_type}} name'
    );
    expect(schema.properties.data.properties.price.description).toBe(
      'The {{state.entity_type}} price'
    );
  });
});

describe('Messaging component inputs', () => {
  it('should compile a parameterless messaging component as an object schema without properties', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    response_formats:
        forms_component:
            description: "Use this when the user wants to create a case."
            inputs:
                penguin_form: object
                    schema: "messaging_component://1mdSB000002Z7VJYA0"

start_agent main:
    description: "test"
`;
    const result = compileSource(source);
    const schema = getFormatInputSchema(result, 'forms_component');

    expect(schema.type).toBe('messaging_component');
    expect(schema.properties.penguin_form).toEqual({
      type: 'object',
      $schema: 'messaging_component://1mdSB000002Z7VJYA0',
    });
  });

  it('should compile a parameterized messaging component into an object schema', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    defaultDate: date
    Users: list[id]

connection messaging:
    response_formats:
        dynamic_new_pet_intake_form:
            label: "New Pet Intake Form"
            description: "Ask the user for pet information."
            inputs:
                penguin_pet_intake_form:
                    schema: "messaging_component://FormMessage__PetIntakeForm"
                    type: object
                        fields:
                            defaultSelectedDate: date = @variables.defaultDate
                                description: "the default selected date"
                            timestamp: datetime = "2026-06-08 15:30:00"
                                description: "some description from the component definition"
                            linkedAccounts: list[id] = @variables.Users
                                description: "a list of user record ids"
                            defaultVet: number = 0
                                description: "some description from the component definition"

start_agent main:
    description: "test"
`;
    const result = compileSource(source);
    const schema = getFormatInputSchema(result, 'dynamic_new_pet_intake_form');

    // A format containing a messaging component is typed as messaging_component
    // at the top level (the component property itself stays `object`).
    expect(schema.type).toBe('messaging_component');

    expect(schema.properties.penguin_pet_intake_form).toEqual({
      type: 'object',
      $schema: 'messaging_component://FormMessage__PetIntakeForm',
      properties: {
        defaultSelectedDate: {
          type: 'date',
          description: 'the default selected date',
          const: '{{state.defaultDate}}',
        },
        timestamp: {
          type: 'datetime',
          description: 'some description from the component definition',
          const: '2026-06-08 15:30:00',
        },
        linkedAccounts: {
          type: 'list',
          itemType: 'id',
          description: 'a list of user record ids',
          const: '{{state.Users}}',
        },
        defaultVet: {
          type: 'number',
          description: 'some description from the component definition',
          const: 0,
        },
      },
    });
  });

  it('should NOT interpolate templates in messaging component parameter descriptions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    petType: string = "dog"

connection messaging:
    response_formats:
        dynamic_form:
            description: "d"
            inputs:
                regularField: string
                    description: |
                        A regular {!@variables.petType} field
                form:
                    schema: "messaging_component://FormMessage__PetIntakeForm"
                    type: object
                        fields:
                            petName: string = ""
                                description: |
                                    The {!@variables.petType} name

start_agent main:
    description: "test"
`;
    const schema = getFormatInputSchema(compileSource(source), 'dynamic_form');

    // Regular (non-messaging-component) input descriptions DO interpolate.
    expect(schema.properties.regularField.description).toBe(
      'A regular {{state.petType}} field'
    );
    // Messaging component parameter descriptions are static —
    // `{!...}` left verbatim (no interpolation).
    expect(schema.properties.form.properties.petName.description).toBe(
      'The {!@variables.petType} name'
    );
  });
});

describe('Surface instructions and response_actions', () => {
  it('should set surface.instructions from reasoning.instructions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    reasoning:
        instructions: |
            Be helpful and concise
    adaptive_response_allowed: True

start_agent main:
    description: "test"
`;
    const surface = findSurface(compileSource(source), 'messaging');
    expect(surface?.instructions).toBe('Be helpful and concise');
  });

  it('should resolve @response_actions references in instructions to response_formats names', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    reasoning:
        instructions: |
            Use format {!@response_actions.my_format} for responses
        response_actions:
            my_format: @response_formats.my_format
    response_formats:
        my_format:
            description: "A test format"
            inputs:
                f: string

start_agent main:
    description: "test"
`;
    const surface = findSurface(compileSource(source), 'messaging');
    expect(surface?.instructions).toBe('Use format my_format for responses');
  });

  it('should resolve reasoning.response_actions aliases in instructions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    reasoning:
        response_actions:
            my_choice: @response_formats.messaging_choices
        instructions: |
            Use {!@response_actions.my_choice} when offering options
    response_formats:
        messaging_choices:
            description: "A choices format"
            inputs:
                f: string

start_agent main:
    description: "test"
`;
    const surface = findSurface(compileSource(source), 'messaging');
    // @response_actions.my_choice resolves via the response-format reference
    // map to the underlying messaging_choices format name, then the
    // response_formats. prefix is stripped.
    expect(surface?.instructions).toBe(
      'Use messaging_choices when offering options'
    );
  });

  it('should compile reasoning.response_actions into surface.response_actions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    reasoning:
        response_actions:
            my_choice: @response_formats.messaging_choices
            my_link: @response_formats.messaging_rich_link
    response_formats:
        messaging_choices:
            description: "A choices format"
            inputs:
                f: string
        messaging_rich_link:
            description: "A rich link format"
            inputs:
                f: string

start_agent main:
    description: "test"
`;
    const surface = findSurface(compileSource(source), 'messaging');
    // `name` is the action alias; `target` resolves to the referenced
    // response_format's name.
    expect(surface?.response_actions).toEqual([
      {
        target: 'messaging_choices',
        name: 'my_choice',
        description: 'My Choice',
      },
      {
        target: 'messaging_rich_link',
        name: 'my_link',
        description: 'My Link',
      },
    ]);
  });

  it('should resolve @inputs references in instructions to connection.<name>.<field>', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection service_email:
    outbound_route_type: OmniChannelFlow
    outbound_route_name: "flow://PenguinSlide"
    inputs:
        LegalDisclosure: string = "This response was generated by a penguin."
    reasoning:
        instructions: |
            Use {!@inputs.LegalDisclosure} in every response.

start_agent main:
    description: "test"
`;
    const surface = findSurface(compileSource(source), 'service_email');
    expect(surface?.instructions).toContain(
      '{{connection.service_email.LegalDisclosure}}'
    );
  });
});

describe('Response format input schema constraints', () => {
  describe('list[string] constraints', () => {
    it('should place enum on items, not array', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                tags:
                    type: list
                        value: string
                            enum:
                                - "tag1"
                                - "tag2"
                                - "tag3"

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.tags).toEqual({
        type: 'array',
        items: {
          type: 'string',
          enum: ['tag1', 'tag2', 'tag3'],
        },
      });
    });

    it('should place minLength/maxLength on items, minItems/maxItems on array', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                tags:
                    type: list
                        value: string
                            min_length: 3
                            max_length: 20
                        min_items: 1
                        max_items: 10

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.tags).toEqual({
        type: 'array',
        items: {
          type: 'string',
          minLength: 3,
          maxLength: 20,
        },
        minItems: 1,
        maxItems: 10,
      });
    });

    // Note: Array literal default values (const for lists) are not currently supported
    // The constraint placement logic is correct - if array literals were supported,
    // const would be placed at array level, not items level
  });

  describe('list[number] constraints', () => {
    it('should place minimum/maximum on items, not array', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                scores:
                    type: list
                        value: number
                            minimum: 0
                            maximum: 100

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.scores).toEqual({
        type: 'array',
        items: {
          type: 'number',
          minimum: 0,
          maximum: 100,
        },
      });
    });

    it('should handle enum on list[number]', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                grades:
                    type: list
                        value: number
                            enum:
                                - 1
                                - 2
                                - 3
                                - 4
                                - 5

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.grades).toEqual({
        type: 'array',
        items: {
          type: 'number',
          enum: [1, 2, 3, 4, 5],
        },
      });
    });
  });

  describe('non-list constraints (baseline)', () => {
    it('should place constraints directly on string type', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                username:
                    type: string
                        min_length: 3
                        max_length: 20
                        enum:
                            - "alice"
                            - "bob"
                            - "charlie"

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.username).toEqual({
        type: 'string',
        minLength: 3,
        maxLength: 20,
        enum: ['alice', 'bob', 'charlie'],
      });
    });

    it('should place constraints directly on number type', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                age:
                    type: number
                        minimum: 0
                        maximum: 120

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.age).toEqual({
        type: 'number',
        minimum: 0,
        maximum: 120,
      });
    });
  });

  describe('list[object] constraints (should not interfere)', () => {
    it('should not apply item-level constraints to object items', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                users:
                    type: list
                        value: object
                            fields:
                                name:
                                    type: string
                                        min_length: 2
                                age:
                                    type: number
                                        minimum: 0
                        min_items: 1
                        max_items: 10

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.users).toEqual({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              minLength: 2,
            },
            age: {
              type: 'number',
              minimum: 0,
            },
          },
          required: ['name', 'age'],
        },
        minItems: 1,
        maxItems: 10,
      });
    });
  });

  describe('nested list[string] in list[object]', () => {
    it('should correctly handle nested list constraints', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                tokens:
                    type: list
                        value: object
                            fields:
                                name: string
                                values:
                                    type: list
                                        value: string
                                            enum:
                                                - "val1"
                                                - "val2"

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.tokens.items.properties.values).toEqual({
        type: 'array',
        items: {
          type: 'string',
          enum: ['val1', 'val2'],
        },
      });
    });
  });

  // Type-mismatched constraints are no longer possible: the TypeDescriptor
  // schema enforces that only valid constraints appear on each type
  // (e.g., min_items only on list, min_length only on string).

  describe('edge cases', () => {
    it('should handle mixed constraints on list[string]', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                tags:
                    description: "A list of tags"
                    type: list
                        value: string
                            min_length: 2
                            max_length: 50
                            enum:
                                - "tag1"
                                - "tag2"
                        min_items: 1
                        max_items: 20

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.tags).toEqual({
        type: 'array',
        items: {
          type: 'string',
          minLength: 2,
          maxLength: 50,
          enum: ['tag1', 'tag2'],
        },
        description: 'A list of tags',
        minItems: 1,
        maxItems: 20,
      });
    });
  });

  describe('input default value → const', () => {
    const compileInputs = (inputs: string) =>
      getFormatInputSchema(
        compileSource(`
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    my_var: string = "hello"

connection test:
    response_formats:
        f:
            description: "d"
            inputs:
${inputs}

start_agent main:
    description: "test"
`),
        'f'
      );

    it('compiles a string literal default to const', () => {
      const schema = compileInputs('                a: string = "fixed"\n');
      expect(
        (schema.properties as Record<string, { const?: unknown }>).a.const
      ).toBe('fixed');
    });

    it('compiles a number literal default to const', () => {
      const schema = compileInputs('                a: number = 5\n');
      expect(
        (schema.properties as Record<string, { const?: unknown }>).a.const
      ).toBe(5);
    });

    it('compiles a boolean literal default to const', () => {
      const schema = compileInputs('                a: boolean = True\n');
      expect(
        (schema.properties as Record<string, { const?: unknown }>).a.const
      ).toBe(true);
    });

    it('compiles a variable reference default to an interpolation const', () => {
      const schema = compileInputs(
        '                a: string = @variables.my_var\n'
      );
      expect(
        (schema.properties as Record<string, { const?: unknown }>).a.const
      ).toBe('{{state.my_var}}');
    });

    it('compiles a list[string] literal default to an array const', () => {
      const schema = compileInputs(
        '                a: list[string] = ["x", "y"]\n'
      );
      expect(
        (schema.properties as Record<string, { const?: unknown }>).a.const
      ).toEqual(['x', 'y']);
    });

    it('compiles a list[number] literal default to an array const', () => {
      const schema = compileInputs(
        '                a: list[number] = [1, 2, 3]\n'
      );
      expect(
        (schema.properties as Record<string, { const?: unknown }>).a.const
      ).toEqual([1, 2, 3]);
    });

    it('emits no const for a list default of references (lint rejects these)', () => {
      const schema = compileInputs(
        '                a: list[string] = [@variables.my_var]\n'
      );
      expect(
        (schema.properties as Record<string, { const?: unknown }>).a.const
      ).toBeUndefined();
    });
  });
});
