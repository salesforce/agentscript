/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { NamedMap } from '@agentscript/language';
import type { Skill } from '../types.js';
import { iterateNamedMap, extractStringValue } from '../ast-helpers.js';

const URI_SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//;

/**
 * Compile a parsed `skills:` collection into the AgentJSON `skills` array.
 * Each entry maps `<name>: { target }` to `{ name, target }`. Any leading
 * URI scheme on `target` (e.g. `skill://`) is stripped — runtime resolution
 * is owned downstream and the wire format carries bare identifiers.
 */
export function compileSkills(
  skills: NamedMap<Record<string, unknown>> | undefined
): Skill[] {
  if (!skills) return [];

  const result: Skill[] = [];
  for (const [name, def] of iterateNamedMap(skills)) {
    const target = extractStringValue((def as Record<string, unknown>).target);
    if (!target) continue;
    result.push({ name, target: target.replace(URI_SCHEME_PREFIX, '') });
  }
  return result;
}
