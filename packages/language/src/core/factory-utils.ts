/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Schema, FieldType, FieldMetadata } from './types.js';
import { union } from './primitives.js';

/**
 * Override builder methods on a factory to mutate `__metadata` in-place and
 * return the factory itself, instead of creating a FieldBuilder wrapper.
 *
 * Factories are one-off objects (unlike shared primitives such as StringValue),
 * so mutation is safe. This preserves the concrete factory type through
 * `.describe()` / `.required()` / etc. chains, avoiding TS7056 serialization
 * overflow that occurs when FieldBuilder wrapping expands the type.
 *
 * Structural methods (extend, omit, pick) still create NEW factories (via the
 * factory's own implementation), but propagate the parent's `__metadata` so
 * that `.describe('x').extend({...})` carries the description forward.
 */
export function overrideFactoryBuilderMethods(factory: object): void {
  const f = factory as Record<string, unknown>;
  // Helper: merge into __metadata and return the factory
  const applyMeta = (updates: Partial<FieldMetadata>) => {
    f.__metadata = {
      ...(f.__metadata as FieldMetadata | undefined),
      ...updates,
    };
    return f;
  };

  // Pure metadata methods — mutate in place, return self
  f.describe = (desc: string) => applyMeta({ description: desc });
  f.example = (ex: string) => applyMeta({ example: ex });
  f.required = () => applyMeta({ required: true });
  f.minVersion = (v: string) => applyMeta({ minVersion: v });
  f.deprecated = (
    msg?: string,
    opts?: { since?: string; removeIn?: string; replacement?: string }
  ) => applyMeta({ deprecated: { message: msg, ...opts } });
  f.experimental = () => applyMeta({ experimental: true });
  f.crossBlockReferenceable = () =>
    applyMeta({ crossBlockReferenceable: true });
  f.singular = () => applyMeta({ singular: true });

  // clone — create an independent copy with its own __metadata.
  // Each factory type sets `__clone` to its own re-creation function.
  f.clone = () => {
    const cloneFn = f.__clone as (() => unknown) | undefined;
    if (typeof cloneFn !== 'function') {
      throw new Error('Factory does not support clone()');
    }
    const result = cloneFn() as Record<string, unknown>;
    // Carry current metadata to the clone
    if (f.__metadata) {
      result.__metadata = { ...(f.__metadata as FieldMetadata) };
    }
    return result;
  };

  // Structural methods — delegate to the factory's own implementation,
  // then propagate __metadata onto the newly created factory.
  for (const method of [
    'extend',
    'omit',
    'pick',
    'withProperties',
    'extendProperties',
    'withKeyPattern',
  ] as const) {
    const orig = f[method] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof orig !== 'function') continue;
    f[method] = (...args: unknown[]) => {
      const result = orig.apply(f, args);
      if (result != null && f.__metadata) {
        const r = result as Record<string, unknown>;
        r.__metadata = {
          ...(f.__metadata as FieldMetadata),
          ...(r.__metadata as FieldMetadata | undefined),
        };
      }
      return result;
    };
  }
}

/**
 * If the discriminant field is no longer present in the schema (e.g. after omit/pick),
 * strip the discriminant and variants options so the Block constructor doesn't throw.
 */
export function stripDiscriminantIfMissing<
  O extends { discriminant?: string; variants?: Record<string, Schema> },
>(newSchema: Record<string, FieldType>, opts: O | undefined): O | undefined {
  if (opts?.discriminant && !(opts.discriminant in newSchema)) {
    const { discriminant: _discriminant, variants: _variants, ...rest } = opts;
    return rest as O;
  }
  return opts;
}

export function normalizeSchema(schema: Schema): Record<string, FieldType> {
  const result: Record<string, FieldType> = {};
  for (const [key, value] of Object.entries(schema)) {
    result[key] = Array.isArray(value) ? union(...value) : value;
  }
  return result;
}

export function validateSchemaFields(schema: Schema): void {
  for (const key of Object.keys(schema)) {
    if (key.startsWith('__')) {
      throw new Error(
        `Field name '${key}' is invalid - field names cannot start with '__' (reserved for internal properties)`
      );
    }
  }
}
