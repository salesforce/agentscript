/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { AgentNode, ModelConfiguration } from '../types.js';
import type { ParsedTopicLike, ParsedSystem } from '../parsed-types.js';
import { HYPERCLASSIFIER_MODEL_PREFIX } from '../constants.js';
import { extractStringValue } from '../ast-helpers.js';
import { compileSubAgentNode } from './compile-subagent-node.js';
import { compileRouterNode } from './compile-router-node.js';

/**
 * Compile a topic block into either a SubAgentNode or RouterNode,
 * depending on the model configuration.
 */
export function compileNode(
  topicName: string,
  topicBlock: ParsedTopicLike,
  systemBlock: ParsedSystem | undefined,
  topicDescriptions: Record<string, string>,
  globalModelConfig: ModelConfiguration | undefined,
  ctx: CompilerContext
): AgentNode {
  if (isHyperclassifierNode(topicBlock)) {
    return compileRouterNode(
      topicName,
      topicBlock,
      systemBlock,
      topicDescriptions,
      globalModelConfig,
      ctx
    );
  }

  return compileSubAgentNode(
    topicName,
    topicBlock,
    systemBlock,
    topicDescriptions,
    globalModelConfig,
    ctx
  );
}

/**
 * Check if a topic block uses the hyperclassifier model,
 * which means it should compile to a RouterNode.
 */
function isHyperclassifierNode(topicBlock: ParsedTopicLike): boolean {
  if (!topicBlock.model_config) return false;

  const modelStr = extractStringValue(topicBlock.model_config.model);
  if (!modelStr) return false;

  return modelStr.includes(HYPERCLASSIFIER_MODEL_PREFIX);
}
