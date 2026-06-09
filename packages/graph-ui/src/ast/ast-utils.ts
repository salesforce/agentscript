/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import type { ParsedAgentforce } from '@agentscript/agentforce-dialect';

export type AgentScriptAST = ParsedAgentforce;

/** Find a topic block by name in either start_agent or topic maps. */
export function findTopicBlock(ast: unknown, name: string): unknown | null {
  const root = ast as { start_agent?: unknown; topic?: unknown };
  if (isNamedMap(root.start_agent) && root.start_agent.has(name)) {
    return root.start_agent.get(name) ?? null;
  }
  if (isNamedMap(root.topic) && root.topic.has(name)) {
    return root.topic.get(name) ?? null;
  }
  return null;
}
