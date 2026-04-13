/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { attachError, extractStringValue, type AstLike } from './shared.js';

function hasNonEmptyTextOrProcedure(value: unknown): boolean {
  if (value == null) return false;
  const s = extractStringValue(value);
  if (s !== undefined) return s.trim().length > 0;
  // Procedure-style values (e.g., `prompt: -> ...`) are valid even when
  // they don't expose a direct string/text field.
  if (typeof value === 'object') return true;
  return false;
}

function hasReasoningInstructions(entry: Record<string, unknown>): boolean {
  const reasoning = entry.reasoning;
  if (reasoning == null || typeof reasoning !== 'object') return false;
  const instructions = (reasoning as Record<string, unknown>).instructions;
  return hasNonEmptyTextOrProcedure(instructions);
}

export function checkReasoningInstructionsRules(
  root: Record<string, unknown>
): void {
  const requireForGroups = [
    ['orchestrator', root.orchestrator],
    ['subagent', root.subagent],
  ] as const;

  for (const [groupName, group] of requireForGroups) {
    if (!isNamedMap(group)) continue;
    for (const [name, entry] of group) {
      if (entry == null || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      if (hasReasoningInstructions(record)) continue;
      attachError(
        entry as AstLike,
        `${groupName} '${name}' must set reasoning.instructions.`,
        'reasoning-instructions-required'
      );
    }
  }

  // Generator uses prompt instead of reasoning.instructions.
  if (isNamedMap(root.generator)) {
    for (const [name, entry] of root.generator) {
      if (entry == null || typeof entry !== 'object') continue;
      const prompt = (entry as Record<string, unknown>).prompt;
      if (hasNonEmptyTextOrProcedure(prompt)) continue;
      attachError(
        entry as AstLike,
        `generator '${name}' must set prompt.`,
        'generator-prompt-required'
      );
    }
  }
}
