/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Schema-driven snake_case → camelCase conversion of compiled AgentJSON.
 *
 * The AgentJSON schema (zod) declares some object shapes with snake_case keys
 * and exposes other fields as `z.record(z.string(), ...)` whose keys are
 * user-controlled (variable names, locale codes, etc.). A naive deep walk
 * over the output would mangle those user keys; this walker drives the
 * traversal from the schema and only renames declared keys.
 */

import type { Range } from '@agentscript/types';

/**
 * Structural shape of a zod 4 schema, used to introspect the AgentJSON
 * schema without taking a direct zod dependency in this package.
 */
type ZodType = unknown;

type RangeMap = WeakMap<object, Map<string, Range>>;

interface ZodDef {
  type: string;
  innerType?: ZodType;
  element?: ZodType;
  valueType?: ZodType;
  options?: ZodType[];
  left?: ZodType;
  right?: ZodType;
  discriminator?: string;
  shape?: Record<string, ZodType>;
}

interface ZodInternals {
  _zod: { def: ZodDef };
  shape?: Record<string, ZodType>;
}

function getDef(schema: ZodType | undefined): ZodDef | undefined {
  return schema ? (schema as unknown as ZodInternals)._zod.def : undefined;
}

function getShape(schema: ZodType): Record<string, ZodType> | undefined {
  return (schema as unknown as ZodInternals).shape;
}

/**
 * Strip wrappers like optional / nullable / nullish / default / readonly /
 * brand to reach the underlying schema.
 */
function unwrap(schema: ZodType | undefined): ZodType | undefined {
  let cur = schema;
  while (cur) {
    const def = getDef(cur);
    if (!def) return cur;
    if (def.innerType) {
      cur = def.innerType;
      continue;
    }
    return cur;
  }
  return cur;
}

/**
 * Collect all object shapes that could apply to `value`. Handles unions,
 * intersections, and discriminated unions. Returns a merged shape plus a
 * flag indicating whether the schema accepts arbitrary string keys (record).
 */
function resolveObjectSchema(
  schema: ZodType | undefined,
  value: Record<string, unknown>
): {
  shape: Record<string, ZodType>;
  recordValueType?: ZodType;
} {
  const result: Record<string, ZodType> = {};
  let recordValueType: ZodType | undefined;

  function visit(s: ZodType | undefined): void {
    const u = unwrap(s);
    if (!u) return;
    const def = getDef(u);
    if (!def) return;
    if (def.type === 'object') {
      const shape = getShape(u);
      if (shape) {
        for (const [k, v] of Object.entries(shape)) {
          if (!(k in result)) result[k] = v;
        }
      }
      return;
    }
    if (def.type === 'record') {
      if (def.valueType) recordValueType = def.valueType;
      return;
    }
    if (def.type === 'union') {
      const opts = def.options ?? [];
      // Prefer a discriminated match by `type` field when possible.
      const valType = value['type'];
      let chosen: ZodType[] = opts;
      if (typeof valType === 'string') {
        const matches = opts.filter(o => optionMatchesType(o, valType));
        if (matches.length > 0) chosen = matches;
      }
      for (const o of chosen) visit(o);
      return;
    }
    if (def.type === 'intersection') {
      visit(def.left);
      visit(def.right);
      return;
    }
    // Other types (primitive, unknown, array, etc.) contribute nothing.
  }

  visit(schema);
  return { shape: result, recordValueType };
}

/**
 * Check whether a union option's `type` literal matches the value's `type`.
 * Handles bare object schemas with a literal `type`, intersections, and
 * wrapper-wrapped variants.
 */
function optionMatchesType(opt: ZodType, valType: string): boolean {
  const u = unwrap(opt);
  if (!u) return false;
  const def = getDef(u);
  if (!def) return false;
  if (def.type === 'object') {
    const shape = getShape(u);
    const tField = shape?.['type'];
    if (!tField) return false;
    return literalMatches(tField, valType);
  }
  if (def.type === 'intersection') {
    return (
      optionMatchesType(def.left as ZodType, valType) ||
      optionMatchesType(def.right as ZodType, valType)
    );
  }
  return false;
}

function literalMatches(schema: ZodType, valType: string): boolean {
  const u = unwrap(schema);
  if (!u) return false;
  const def = getDef(u);
  if (!def) return false;
  // z.literal('action') has def.type === 'literal' and a `values` array in v4.
  const literalValues = (def as unknown as { values?: unknown[] }).values;
  if (Array.isArray(literalValues)) {
    return literalValues.includes(valType);
  }
  return false;
}

function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Walk `value` with the AgentJSON schema as a guide, renaming snake_case
 * declared keys to camelCase. User-controlled keys inside `z.record()`
 * fields are preserved verbatim. Source ranges are remapped so the new
 * objects map to the new key names.
 */
export function snakeKeysToCamel(
  value: unknown,
  ranges: RangeMap,
  schema: ZodType
): { value: unknown; ranges: RangeMap } {
  const newRanges: RangeMap = new WeakMap();

  function walk(input: unknown, currentSchema: ZodType | undefined): unknown {
    if (Array.isArray(input)) {
      const elemDef = getDef(unwrap(currentSchema));
      const elemSchema = elemDef?.element;
      return input.map(item => walk(item, elemSchema));
    }
    if (input !== null && typeof input === 'object') {
      const src = input as Record<string, unknown>;
      const dst: Record<string, unknown> = {};
      const srcRanges = ranges.get(src);
      let dstRanges: Map<string, Range> | undefined;

      const { shape, recordValueType } = resolveObjectSchema(
        currentSchema,
        src
      );

      for (const key of Object.keys(src)) {
        const fieldSchema = shape[key];
        let outKey: string;
        let nextSchema: ZodType | undefined;

        if (fieldSchema) {
          // Declared key — rename it.
          outKey = snakeToCamelKey(key);
          nextSchema = fieldSchema;
        } else if (recordValueType) {
          // Record key — keep as-is.
          outKey = key;
          nextSchema = recordValueType;
        } else {
          // Schema doesn't declare this key and isn't a record. Leave the
          // key and its subtree alone — we have no guidance and renaming
          // could corrupt user data.
          dst[key] = src[key];
          const range = srcRanges?.get(key);
          if (range) {
            if (!dstRanges) dstRanges = new Map();
            dstRanges.set(key, range);
          }
          continue;
        }

        dst[outKey] = walk(src[key], nextSchema);

        const range = srcRanges?.get(key);
        if (range) {
          if (!dstRanges) dstRanges = new Map();
          dstRanges.set(outKey, range);
        }
      }

      if (dstRanges) newRanges.set(dst, dstRanges);
      return dst;
    }
    return input;
  }

  return { value: walk(value, schema), ranges: newRanges };
}
