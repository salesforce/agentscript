/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Skill target URI scheme validation.
 *
 * Skills declared under a subagent or start_agent must have a `target:` that
 * starts with the `skill://` scheme. Other schemes are rejected.
 *
 * Diagnostic: invalid-skill-target
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

const SKILL_SCHEME = 'skill';

class SkillTargetSchemePass implements LintPass {
  readonly id = storeKey('invalid-skill-target');
  readonly description = `Skill target URIs must use the ${SKILL_SCHEME}:// scheme.`;

  run(_store: PassStore, root: AstRoot): void {
    for (const key of ['subagent', 'start_agent'] as const) {
      const collection = root[key];
      if (!isNamedMap(collection)) continue;

      for (const [parentName, block] of collection as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;
        const skills = (block as Record<string, unknown>)['skills'];
        if (!isNamedMap(skills)) continue;

        for (const [skillName, skillBlock] of skills as NamedMap<unknown>) {
          if (!skillBlock || typeof skillBlock !== 'object') continue;
          const targetNode = (skillBlock as Record<string, unknown>)['target'];
          if (targetNode == null) continue;

          const targetValue = extractStringValue(targetNode);
          if (targetValue == null) continue;

          checkScheme(
            parentName,
            skillName,
            targetValue,
            targetNode,
            skillBlock as AstNodeLike
          );
        }
      }
    }
  }
}

function checkScheme(
  parentName: string,
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
        `Skill '${skillName}' on '${parentName}' has an invalid target "${value}". ` +
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
        `Skill '${skillName}' on '${parentName}' uses unsupported target scheme "${scheme}://". ` +
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
