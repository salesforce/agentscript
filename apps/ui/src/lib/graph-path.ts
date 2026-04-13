/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Graph Path Finding
 *
 * Finds all edges on simple (non-repeating) routes from start to target.
 * Used for path highlighting when a node is selected.
 */

import type { GraphEdge } from './ast-to-graph';

/**
 * Find edges to highlight when selecting `targetId`, showing all simple
 * routes from `startId` to `targetId`.
 *
 * Algorithm:
 * 1. Backward BFS from target to find which nodes can reach the target.
 *    This prunes the search space so the DFS doesn't explore dead ends.
 * 2. Forward DFS from start, only exploring nodes that can reach the target.
 *    The visited set prevents revisiting nodes, naturally handling cycles.
 * 3. Every simple path found contributes its edges to the result set.
 */
export function findPathEdges(
  edges: GraphEdge[],
  startId: string,
  targetId: string
): Set<string> | null {
  if (startId === targetId) return new Set<string>();

  // Build forward and reverse adjacency
  const fwd = new Map<string, Array<{ target: string; edgeId: string }>>();
  const rev = new Map<string, string[]>();
  for (const edge of edges) {
    if (!fwd.has(edge.source)) fwd.set(edge.source, []);
    fwd.get(edge.source)!.push({ target: edge.target, edgeId: edge.id });
    if (!rev.has(edge.target)) rev.set(edge.target, []);
    rev.get(edge.target)!.push(edge.source);
  }

  // Backward BFS: find all nodes that can reach the target
  const canReachTarget = new Set<string>([targetId]);
  const queue = [targetId];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const src of rev.get(node) ?? []) {
      if (!canReachTarget.has(src)) {
        canReachTarget.add(src);
        queue.push(src);
      }
    }
  }

  if (!canReachTarget.has(startId)) return null;

  // Forward DFS: enumerate all simple paths, collecting edges
  const result = new Set<string>();
  const pathEdges: string[] = [];
  const visited = new Set<string>([startId]);

  function dfs(current: string): boolean {
    if (current === targetId) {
      for (const edgeId of pathEdges) {
        result.add(edgeId);
      }
      return true;
    }

    let found = false;
    for (const { target, edgeId } of fwd.get(current) ?? []) {
      if (visited.has(target) || !canReachTarget.has(target)) continue;
      visited.add(target);
      pathEdges.push(edgeId);
      if (dfs(target)) found = true;
      pathEdges.pop();
      visited.delete(target);
    }
    return found;
  }

  dfs(startId);
  return result.size > 0 ? result : null;
}
