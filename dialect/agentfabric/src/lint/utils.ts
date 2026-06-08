/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/** Convert kebab-case identifiers to snake_case. */
export function normalizeId(name: string): string {
  return name ? name.replace(/-/g, '_') : name;
}

/**
 * Iterate key/value pairs from a dialect collection block.
 * Parsed collections are `NamedMap` (iterable, not `instanceof Map`) or native `Map`.
 */
export function iterateCollection(
  block: unknown
): [string, Record<string, unknown>][] {
  if (block == null) return [];
  if (block instanceof Map) {
    return [...block.entries()] as [string, Record<string, unknown>][];
  }
  if (typeof block === 'object' && Symbol.iterator in block) {
    return [...(block as Iterable<[string, unknown]>)] as [
      string,
      Record<string, unknown>,
    ][];
  }
  return [];
}

/**
 * Input parameter names declared on an action_definition `inputs:` map (declaration order).
 */
export function listActionDefInputNames(
  actionDef: Record<string, unknown>
): string[] {
  const names: string[] = [];
  for (const [name] of iterateCollection(actionDef.inputs)) {
    if (name) names.push(name);
  }
  return names;
}

/**
 * Implicit parameter names allowed in `with` clauses without being declared
 * in the action's `inputs:` map.
 */
export const IMPLICIT_WITH_PARAMS = new Set(['http_headers']);
