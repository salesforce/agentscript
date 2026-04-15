/**
 * Tests for response format input schema constraint placement.
 * Verifies that constraints are applied at the correct level (array vs items).
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

function compileSource(source: string) {
  const ast = parseSource(source);
  return compile(ast);
}

function getFormatInputSchema(
  result: ReturnType<typeof compile>,
  formatName: string
): Record<string, unknown> {
  const surfaces = result.output.agent_version.surfaces ?? [];
  for (const surface of surfaces) {
    const format = surface.format_definitions?.find(
      f => f.developer_name === formatName
    );
    if (format?.input_schema) {
      return JSON.parse(format.input_schema);
    }
  }
  throw new Error(`Format ${formatName} not found`);
}

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
                tags: list[string]
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
                tags: list[string]
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
                scores: list[number]
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
                grades: list[number]
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
                username: string
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
                age: number
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
                users: list[object]
                    min_items: 1
                    max_items: 10

                    name: string
                        min_length: 2
                    age: number
                        minimum: 0

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
                tokens: list[object]
                    name: string
                    values: list[string]
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

  describe('type-mismatched constraints (semantically incorrect but allowed)', () => {
    it('should allow array constraints on non-array types (validator will ignore)', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                username: string
                    min_items: 5
                    max_items: 10

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      // The compiler doesn't validate semantic correctness - it just places constraints
      // JSON Schema validators will ignore minItems/maxItems on string types
      expect(schema.properties.username).toEqual({
        type: 'string',
        minItems: 5,
        maxItems: 10,
      });
    });

    it('should allow string constraints on number types (validator will ignore)', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                age: number
                    min_length: 3
                    max_length: 20

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      // The compiler doesn't validate semantic correctness
      // JSON Schema validators will ignore minLength/maxLength on number types
      expect(schema.properties.age).toEqual({
        type: 'number',
        minLength: 3,
        maxLength: 20,
      });
    });
  });

  describe('edge cases', () => {
    it('should handle list[boolean] with enum', () => {
      const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection test:
    response_formats:
        test_format:
            inputs:
                flags: list[boolean]
                    enum:
                        - True
                        - False

start_agent main:
    description: "test"
`;
      const result = compileSource(source);
      const schema = getFormatInputSchema(result, 'test_format');

      expect(schema.properties.flags).toEqual({
        type: 'array',
        items: {
          type: 'boolean',
          enum: [true, false],
        },
      });
    });

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
                tags: list[string]
                    description: "A list of tags"
                    min_length: 2
                    max_length: 50
                    min_items: 1
                    max_items: 20
                    enum:
                        - "tag1"
                        - "tag2"

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
});
