/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Zero-dependency validation of LLM-provided tool arguments against the tool's
 * input JSON Schema, run *before* the tool executes. This is a loop
 * "escape hatch": a model that emits malformed arguments (missing a required
 * field, wrong type, or truncated JSON that parsed to `{}`) gets a precise
 * synthetic error result instead of the tool running with garbage — the same
 * self-correction gate the reference agent applies at preflight (loop/tool-call.ts).
 *
 * The schemas we validate against are the small, closed shapes produced by
 * `inputSchemaFromParams` in the turn runtime: `{ type: 'object', properties,
 * required? }` where each property carries a JSON primitive `type`. We do NOT
 * need a full JSON-Schema engine (no ajv) — a targeted checker over that shape
 * is smaller, faster, and has no draft-dialect ambiguity.
 */

interface ObjectSchema {
  type?: string;
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

interface PropertySchema {
  type?: string | string[];
  description?: string;
}

/** The JSON primitive type name of a runtime value, for schema comparison. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return t; // 'string' | 'boolean' | 'object' | 'undefined' | ...
}

/**
 * Does a runtime value satisfy a schema `type` declaration? Mirrors JSON
 * Schema's numeric widening: an `integer` value also satisfies `number`, and a
 * whole-valued `number` satisfies `integer`.
 */
function typeMatches(value: unknown, expected: string): boolean {
  const actual = jsonTypeOf(value);
  if (actual === expected) return true;
  if (expected === 'number' && actual === 'integer') return true;
  if (expected === 'integer' && actual === 'number') {
    return Number.isInteger(value);
  }
  return false;
}

/**
 * Validate `args` against `schema`. Returns `null` when valid, or a single
 * human-readable message (multiple problems joined with `; `) describing every
 * violation — phrased for the model to read and correct.
 */
export function validateToolArgs(
  schema: unknown,
  args: unknown
): string | null {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as ObjectSchema;

  // Only object schemas carry field-level constraints we can check. Anything
  // else (or an untyped schema) is treated as permissive.
  if (s.type !== undefined && s.type !== 'object') return null;

  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return `arguments must be an object, received ${jsonTypeOf(args)}`;
  }
  const obj = args as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of s.required ?? []) {
    if (obj[key] === undefined) {
      problems.push(`missing required parameter "${key}"`);
    }
  }

  const props = s.properties ?? {};
  for (const [key, propSchema] of Object.entries(props)) {
    const value = obj[key];
    if (value === undefined) continue; // absence handled by `required` above
    const expected = propSchema?.type;
    if (expected === undefined) continue;
    const expectedList = Array.isArray(expected) ? expected : [expected];
    if (!expectedList.some(t => typeMatches(value, t))) {
      problems.push(
        `parameter "${key}" must be of type ${expectedList.join(' | ')}, ` +
          `received ${jsonTypeOf(value)}`
      );
    }
  }

  return problems.length ? problems.join('; ') : null;
}
