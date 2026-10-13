/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { extractGraph } from './extractor.js';
import { AgentFabricSchemaInfo } from '../schema.js';
import { Namespace } from '../constants.js';

/**
 * Adjacency-list view of the agent graph for reachability queries, plus
 * the trigger node ids used as BFS seeds.
 */
export function buildGraphAdjacency(root: Record<string, unknown>): {
  adjacency: Map<string, string[]>;
  triggerIds: string[];
} {
  const { nodes, edges } = extractGraph(root, AgentFabricSchemaInfo);
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) continue;
    adjacency.get(edge.from)!.push(edge.to);
  }

  const triggerIds = nodes
    .filter(node => node.namespace === Namespace.Trigger)
    .map(node => node.id);

  return { adjacency, triggerIds };
}

/**
 * Breadth-first forward reachability from `seeds`. Nodes in `removed` are
 * skipped both as seeds and as traversal targets (used to test reachability
 * with selected nodes deleted from the graph).
 */
export function reachableFrom(
  seeds: string[],
  adjacency: Map<string, string[]>,
  removed: Set<string> = new Set()
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const seed of seeds) {
    if (removed.has(seed) || visited.has(seed)) continue;
    visited.add(seed);
    queue.push(seed);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (removed.has(next) || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}
