/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GuardrailError } from './types.js';

// ---------------------------------------------------------------------------
// Lightweight JSON Schema subset validator (shared utility)
// ---------------------------------------------------------------------------

export type Schema = Record<string, unknown>;

export function validateSchema(
  value: unknown,
  schema: Schema,
  path: string
): GuardrailError[] {
  const errors: GuardrailError[] = [];

  // type check
  if ('type' in schema) {
    const expected = schema['type'] as string;
    if (!checkType(value, expected)) {
      errors.push({
        path: path || '(root)',
        message: `Expected type "${expected}" but got "${typeOf(value)}"`,
        code: 'type',
      });
      return errors; // short-circuit on type mismatch
    }
  }

  // enum check
  if ('enum' in schema) {
    const allowed = schema['enum'] as unknown[];
    if (!allowed.some(v => JSON.stringify(v) === JSON.stringify(value))) {
      errors.push({
        path: path || '(root)',
        message: `Value must be one of: ${JSON.stringify(allowed)}`,
        code: 'enum',
      });
    }
  }

  // number constraints
  if (typeof value === 'number') {
    if ('minimum' in schema && value < (schema['minimum'] as number)) {
      errors.push({
        path: path || '(root)',
        message: `Value ${value} is less than minimum ${schema['minimum']}`,
        code: 'minimum',
      });
    }
    if ('maximum' in schema && value > (schema['maximum'] as number)) {
      errors.push({
        path: path || '(root)',
        message: `Value ${value} is greater than maximum ${schema['maximum']}`,
        code: 'maximum',
      });
    }
  }

  // string constraints
  if (typeof value === 'string') {
    if (
      'minLength' in schema &&
      value.length < (schema['minLength'] as number)
    ) {
      errors.push({
        path: path || '(root)',
        message: `String length ${value.length} is less than minLength ${schema['minLength']}`,
        code: 'minLength',
      });
    }
    if (
      'maxLength' in schema &&
      value.length > (schema['maxLength'] as number)
    ) {
      errors.push({
        path: path || '(root)',
        message: `String length ${value.length} is greater than maxLength ${schema['maxLength']}`,
        code: 'maxLength',
      });
    }
    if ('pattern' in schema) {
      const re = new RegExp(schema['pattern'] as string);
      if (!re.test(value)) {
        errors.push({
          path: path || '(root)',
          message: `String does not match pattern "${schema['pattern']}"`,
          code: 'pattern',
        });
      }
    }
  }

  // object constraints
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // required
    if ('required' in schema) {
      const required = schema['required'] as string[];
      for (const key of required) {
        if (!(key in obj)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Missing required property "${key}"`,
            code: 'required',
          });
        }
      }
    }

    // properties
    if ('properties' in schema) {
      const props = schema['properties'] as Record<string, Schema>;
      for (const [key, subSchema] of Object.entries(props)) {
        if (key in obj) {
          const subPath = path ? `${path}.${key}` : key;
          errors.push(...validateSchema(obj[key], subSchema, subPath));
        }
      }
    }

    // additionalProperties
    if (
      'additionalProperties' in schema &&
      schema['additionalProperties'] === false
    ) {
      const allowed = Object.keys(
        (schema['properties'] as Record<string, unknown>) ?? {}
      );
      for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Additional property "${key}" is not allowed`,
            code: 'additionalProperties',
          });
        }
      }
    }
  }

  // array constraints
  if (Array.isArray(value)) {
    if ('items' in schema) {
      const itemSchema = schema['items'] as Schema;
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        errors.push(...validateSchema(value[i], itemSchema, itemPath));
      }
    }
  }

  return errors;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}
