/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { Workflow } from '../types.js';
import type { NamedMap, Expression } from '@agentscript/language';
import {
  extractStringValue,
  iterateNamedMap,
  getCstRange,
  resolveAtReference,
} from '../ast-helpers.js';

/**
 * Compile workflow declarations to AgentJSON Workflow objects.
 *
 * - `agent`-only: type 'agent', no prompt
 * - `agent` + `prompt`: type 'agent' with an additional prompt instruction
 * - `prompt`-only: type 'prompt'
 */
export function compileWorkflows(
  workflows: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): Workflow[] {
  if (!workflows) return [];

  const result: Workflow[] = [];

  for (const [id, block] of iterateNamedMap(workflows)) {
    const hasAgent = block.agent != null;
    const hasPrompt = block.prompt != null;

    if (!hasAgent && !hasPrompt) {
      ctx.error(`Workflow '${id}' must set either 'agent' or 'prompt' or both`);
      continue;
    }

    if (hasAgent) {
      const target = resolveAtReference(
        block.agent as Expression,
        ['subagent', 'connected_subagent'],
        ctx,
        `workflow '${id}' agent target`
      );

      if (target === undefined) {
        continue;
      }

      const entry: Workflow = {
        id,
        invocation_target_type: 'agent',
        invocation_target_name: target,
      };

      if (hasPrompt) {
        const prompt = extractStringValue(block.prompt);
        if (!prompt || prompt.trim() === '') {
          ctx.error(
            `Workflow '${id}' prompt must be a non-empty string`,
            getCstRange(block.prompt)
          );
          continue;
        }
        entry.prompt = prompt;
      }

      result.push(entry);
    } else {
      // prompt-only
      const prompt = extractStringValue(block.prompt);

      if (!prompt || prompt.trim() === '') {
        ctx.error(
          `Workflow '${id}' with a prompt requires a non-empty prompt string`,
          getCstRange(block.prompt)
        );
        continue;
      }

      result.push({
        id,
        invocation_target_type: 'prompt',
        prompt,
      });
    }
  }

  return result;
}
