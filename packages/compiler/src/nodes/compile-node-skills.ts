/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Expression } from '@agentscript/language';
import { decomposeAtMemberExpression } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { NodeSkillReference } from '../types.js';
import { getCstRange, iterateNamedMap } from '../ast-helpers.js';

/**
 * Extract node-level skill references from a subagent's `reasoning.skills` map.
 *
 * `reasoning.skills` is authored as a map of local handles to skill references —
 * `<handle>: @skill_definitions.<name>` — mirroring `reasoning.actions`. Each
 * entry compiles to a NodeSkillReference whose `name` is the local handle (the
 * map key, presented to the reasoner/LLM) and whose `target` is the top-level
 * `skill_definitions` entry it resolves to.
 */
export function extractNodeSkills(
  reasoningBlock: { skills?: unknown } | null | undefined,
  ctx: CompilerContext
): NodeSkillReference[] {
  const skills = reasoningBlock?.skills;
  if (!skills) return [];

  const result: NodeSkillReference[] = [];
  for (const [handle, def] of iterateNamedMap(
    skills as Parameters<typeof iterateNamedMap>[0]
  )) {
    const value = (def as { value?: Expression }).value;
    const ref = value ? decomposeAtMemberExpression(value) : null;

    if (!ref || ref.namespace !== 'skill_definitions') {
      ctx.error(
        `Node-level skill '${handle}' must reference @skill_definitions.<name>`,
        getCstRange(def)
      );
      continue;
    }

    result.push({ name: handle, target: ref.property });
  }

  return result;
}
