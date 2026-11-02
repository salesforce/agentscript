/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isAstNodeLike, isNamedMap } from '@agentscript/language';

import type { AstNodeLike } from '@agentscript/language';

/** Top-level blocks that, like `workflow`, compile to an agent graph node. */
const NODE_NAMESPACES = [
  'start_agent',
  'topic',
  'subagent',
  'orchestrator',
  'connected_subagent',
] as const;

export interface WorkflowNameCollision {
  name: string;
  /** The other namespace declaring `name`. */
  namespace: string;
  /** The workflow block, for diagnostic attachment. */
  workflow: AstNodeLike;
  message: string;
}

/**
 * Workflows whose name is also declared by another node-producing block. Both
 * would compile to an agent node with the same `developer_name`.
 */
export function workflowNameCollisions(root: object): WorkflowNameCollision[] {
  const blocks = root as Record<string, unknown>;
  const workflows = blocks.workflow;
  if (!isNamedMap(workflows)) return [];

  const collisions: WorkflowNameCollision[] = [];
  for (const [name, workflow] of workflows) {
    if (!isAstNodeLike(workflow)) continue;
    const namespace = NODE_NAMESPACES.find(ns => {
      const named = blocks[ns];
      return isNamedMap(named) && named.has(name);
    });
    if (!namespace) continue;
    collisions.push({
      name,
      namespace,
      workflow,
      message: `Workflow '${name}' has the same name as ${namespace} '${name}'. Each workflow needs a name no other subagent, topic, or connected agent uses.`,
    });
  }
  return collisions;
}
