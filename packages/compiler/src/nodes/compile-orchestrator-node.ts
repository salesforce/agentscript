/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type {
  OrchestratorNode,
  Tool,
  SupervisionTool,
  ModelConfiguration,
} from '../types.js';
import type { Sourceable } from '../sourced.js';
import { compileActionDefinitions } from './compile-actions.js';
import { compileReasoningActions } from './compile-reasoning-actions.js';
import {
  extractTopicModelConfiguration,
  mergeModelConfigurations,
} from '../config/model-config.js';
import type { ParsedTopicLike } from '../parsed-types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- compiler handles raw AST shapes
type RawBlock = Record<string, any>;

/**
 * Compile an orchestrator block into an OrchestratorNode.
 *
 * Maps:
 * - `actions:` → action_definitions[]
 * - `reasoning.instructions` → instructions string
 * - `reasoning.actions` → tools[]
 * - `model_config:` (block-level, falling back to the agent-wide default) →
 *   `model_configuration`. Mirrors the subagent/router path in
 *   compile-subagent-node.ts / compile-router-node.ts: `extractTopicModelConfiguration`
 *   reads the orchestrator block's own `model_config`, then
 *   `mergeModelConfigurations` layers it over `globalModelConfig`. Emitted
 *   ONLY when a config actually resolves — no key is written when both the
 *   block-level and agent-wide model_config are absent (no-regression).
 */
export function compileOrchestratorNode(
  name: string,
  block: RawBlock,
  globalModelConfig: ModelConfiguration | undefined,
  ctx: CompilerContext
): Sourceable<OrchestratorNode> {
  // Compile top-level action definitions
  const actionDefinitions = compileActionDefinitions(block.actions, ctx);

  // Extract orchestrator-level model configuration and merge with the
  // agent-wide default (block-level settings override the global default).
  const blockModelConfig = extractTopicModelConfiguration(
    block as ParsedTopicLike,
    ctx
  );
  const modelConfig = mergeModelConfigurations(
    globalModelConfig,
    blockModelConfig
  );

  // Compile reasoning block
  const reasoning = block.reasoning as RawBlock | null | undefined;

  let instructions: string | undefined;
  let tools: Array<Tool | SupervisionTool> = [];

  if (reasoning) {
    const result = compileReasoningActions(
      reasoning,
      {
        nodeType: 'orchestrator',
        topicName: name,
        topicDescriptions: {},
      },
      ctx
    );

    if (result.isProcedural) {
      ctx.error(
        'Procedural statements (run, set, if, transition) are not supported in orchestrator reasoning.instructions. ' +
          'Use reasoning.actions to define tools the LLM can invoke.',
        (reasoning.instructions as { __cst?: { range?: unknown } })?.__cst
          ?.range as Parameters<typeof ctx.error>[1]
      );
    } else {
      if (result.instructionTemplate) {
        instructions = result.instructionTemplate;
      }
    }

    tools = result.tools as Array<Tool | SupervisionTool>;
  }

  const node: Sourceable<OrchestratorNode> = {
    type: 'orchestrator',
    developer_name: name,
  };

  if (actionDefinitions.length > 0) {
    node.action_definitions = actionDefinitions;
  }

  if (instructions !== undefined) {
    node.instructions = instructions;
  }

  if (tools.length > 0) {
    node.tools = tools as OrchestratorNode['tools'];
  }

  if (modelConfig) {
    node.model_configuration = modelConfig;
  }

  return node;
}
