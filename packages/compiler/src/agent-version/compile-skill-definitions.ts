/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NamedMap } from '@agentscript/language';
import type { Skill } from '../types.js';
import { compileSkills } from '../nodes/compile-skills.js';

/**
 * Compile the top-level `skill_definitions:` collection into the AgentJSON
 * `agent_version.skill_definitions` array.
 *
 * Skills are declared once at the top level and referenced by local handle from
 * a subagent's `reasoning.skills`. The per-entry compilation (stored `target`
 * scheme-stripping, inline `instructions` → wire `content`) is shared with
 * `compileSkills`; this wrapper simply scopes it to the version-level table.
 */
export function compileSkillDefinitions(
  skillDefinitions: NamedMap<Record<string, unknown>> | undefined
): Skill[] {
  return compileSkills(skillDefinitions);
}
