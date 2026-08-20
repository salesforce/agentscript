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
 * Compile a parsed `skill_definitions:` collection into the AgentJSON `skills`
 * array.
 *
 * A skill is either *stored* (`target`) or *inline* (`instructions`); the
 * either-or invariant is enforced upstream by the `invalid-skill-shape` lint
 * pass, so here we simply carry whichever source is present:
 *
 * - **Stored**: `<name>: { target, description?, label? }`. Any leading URI
 *   scheme on `target` (e.g. `skill://`) is stripped — runtime resolution is
 *   owned downstream and the wire format carries bare identifiers.
 * - **Inline**: `<name>: { instructions, description?, label? }`. The SKILL.md
 *   body is carried verbatim; the runtime injects it into the catalog directly.
 *   Authors write `instructions:`, but the AgentJSON wire field is `content` —
 *   that name is fixed by the generated AgentDSL schema, so the rename stops
 *   here at the authoring surface.
 *
 * A skill with neither source is skipped (already flagged by lint).
 */
export function compileSkills(
  skills: NamedMap<Record<string, unknown>> | undefined
): Skill[] {
  if (!skills) return [];

  const result: Skill[] = [];
  for (const [name, rawDef] of iterateNamedMap(skills)) {
    const def = rawDef as Record<string, unknown>;
    const target = extractStringValue(def.target);
    const instructions = extractStringValue(def.instructions);
    if (!target && !instructions) continue;

    const skill: Skill = { name };
    if (target) skill.target = target.replace(URI_SCHEME_PREFIX, '');
    if (instructions) skill.content = instructions;

    const description = extractStringValue(def.description);
    if (description) skill.description = description;
    const label = extractStringValue(def.label);
    if (label) skill.label = label;

    result.push(skill);
  }
  return result;
}
