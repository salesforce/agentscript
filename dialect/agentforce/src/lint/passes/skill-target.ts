/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Skill shape validation.
 *
 * A skill is either *inline* (defines `instructions`) or *stored* (references a
 * `target` URI). This pass enforces:
 *
 * 1. Exactly one of `instructions` / `target` is present (mutually exclusive,
 *    and at least one required).                → diagnostic: invalid-skill-shape
 * 2. Inline skills (with `instructions`) must declare a `description`.
 *                                               → diagnostic: invalid-skill-shape
 * 3. A `target`, when present, uses the `skill://` scheme.
 *                                               → diagnostic: invalid-skill-target
 */

import type {
  AstNodeLike,
  AstRoot,
  LintPass,
  NamedMap,
  PassStore,
} from '@agentscript/language';
import {
  attachDiagnostic,
  isNamedMap,
  lintDiagnostic,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { extractStringValue, getBlockRange } from '../utils.js';

/**
 * URI pattern that reasoner uses to recognize that it's a SkillStore skill
 * example: skill://skillStoreSkillName
 **/
const SKILL_SCHEME = 'skill';

class SkillTargetSchemePass implements LintPass {
  readonly id = storeKey('invalid-skill-target');
  readonly description =
    'A skill must define exactly one of `instructions` (inline) or ' +
    `\`target\` (stored, ${SKILL_SCHEME}:// scheme); inline skills require a description.`;

  run(_store: PassStore, root: AstRoot): void {
    // Skill definitions live at the top level (`skill_definitions:`); subagents
    // reference them by name via `reasoning.skills`. Validate the definitions
    // once, where they are declared.
    const skills = root['skill_definitions'];
    if (!isNamedMap(skills)) return;

    for (const [skillName, skillBlock] of skills as NamedMap<unknown>) {
      if (!skillBlock || typeof skillBlock !== 'object') continue;
      checkSkillDefinition(skillName, skillBlock as AstNodeLike);
    }
  }
}

/**
 * Validate a single skill block's shape: the instructions/target either-or, the
 * inline-description requirement, and the target URI scheme.
 */
function checkSkillDefinition(
  skillName: string,
  skillBlock: AstNodeLike
): void {
  const record = skillBlock as unknown as Record<string, unknown>;
  const instructionsNode = record['instructions'];
  const targetNode = record['target'];
  const hasInstructions = instructionsNode != null;
  const hasTarget = targetNode != null;

  // R1: exactly one of instructions / target.
  if (!hasInstructions && !hasTarget) {
    attachDiagnostic(
      skillBlock,
      lintDiagnostic(
        getBlockRange(skillBlock),
        `Skill '${skillName}' must define either ` +
          `'instructions' (inline skill) or 'target' (stored skill).`,
        DiagnosticSeverity.Error,
        'invalid-skill-shape'
      )
    );
    return;
  }

  if (hasInstructions && hasTarget) {
    attachDiagnostic(
      skillBlock,
      lintDiagnostic(
        getBlockRange(targetNode),
        `Skill '${skillName}' defines both 'instructions' ` +
          `and 'target'. A skill is either inline ('instructions') or stored ` +
          `('target'), not both.`,
        DiagnosticSeverity.Error,
        'invalid-skill-shape'
      )
    );
    return;
  }

  // R2: inline skills must declare a description.
  if (hasInstructions && record['description'] == null) {
    attachDiagnostic(
      skillBlock,
      lintDiagnostic(
        getBlockRange(skillBlock),
        `Inline skill '${skillName}' must declare a 'description'.`,
        DiagnosticSeverity.Error,
        'invalid-skill-shape'
      )
    );
  }

  // R3: a stored skill's target must use the skill:// scheme.
  if (hasTarget) {
    const targetValue = extractStringValue(targetNode);
    if (targetValue != null) {
      checkScheme(skillName, targetValue, targetNode, skillBlock);
    }
  }
}

function checkScheme(
  skillName: string,
  value: string,
  targetNode: unknown,
  diagnosticHost: AstNodeLike
): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    attachDiagnostic(
      diagnosticHost,
      lintDiagnostic(
        getBlockRange(targetNode),
        `Skill '${skillName}' has an invalid target "${value}". ` +
          `Expected a URI with the ${SKILL_SCHEME}:// scheme.`,
        DiagnosticSeverity.Error,
        'invalid-skill-target'
      )
    );
    return;
  }

  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  if (scheme !== SKILL_SCHEME) {
    attachDiagnostic(
      diagnosticHost,
      lintDiagnostic(
        getBlockRange(targetNode),
        `Skill '${skillName}' uses unsupported target scheme "${scheme}://". ` +
          `Expected ${SKILL_SCHEME}://.`,
        DiagnosticSeverity.Error,
        'invalid-skill-target'
      )
    );
  }
}

export function skillTargetSchemeRule(): LintPass {
  return new SkillTargetSchemePass();
}
