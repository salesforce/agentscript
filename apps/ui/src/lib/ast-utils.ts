/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import type { AgentScriptAST } from '~/lib/parser';

/** Find a topic block by name in either start_agent or topic maps. */
export function findTopicBlock(
  ast: AgentScriptAST,
  name: string
): unknown | null {
  if (isNamedMap(ast.start_agent) && ast.start_agent.has(name)) {
    return ast.start_agent.get(name) ?? null;
  }
  if (isNamedMap(ast.topic) && ast.topic.has(name)) {
    return ast.topic.get(name) ?? null;
  }
  return null;
}
