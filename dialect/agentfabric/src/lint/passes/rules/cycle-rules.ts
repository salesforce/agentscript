/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { extractGraph } from '../../../graph/extractor.js';
import type { GraphEdge } from '../../../graph/extractor.js';
import { AgentFabricSchemaInfo } from '../../../schema.js';
import { attachWarning, type AstLike } from './shared.js';

// Produce a rotation-invariant signature for a cycle so duplicates from different entry points dedupe.
function canonicalSignature(cycle: string[]): string {
  if (cycle.length === 0) return '';
  let smallestIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[smallestIndex]) smallestIndex = i;
  }
  const rotated = cycle
    .slice(smallestIndex)
    .concat(cycle.slice(0, smallestIndex));
  return rotated.join('|');
}

// Rotate a cycle so it begins at the given node, used for rendering messages
function rotateAtNode(cycle: string[], node: string): string[] {
  const idx = cycle.indexOf(node);
  if (idx <= 0) return cycle.slice();
  return cycle.slice(idx).concat(cycle.slice(0, idx));
}

// Format a cycle as an arrow-joined path closed back to the anchor node, e.g. `@a → @b → @a`.
function formatCyclePath(cycle: string[], node: string): string {
  const rotated = rotateAtNode(cycle, node);
  const closed = [...rotated, node];
  return closed.map(id => `@${id}`).join(' → ');
}

type TraversalState = 'unvisited' | 'visiting' | 'visited';

// A frame on the DFS stack:
// `nextNeighbor` is the index of the next neighbor of `node` left to examine.
interface Frame {
  node: string;
  nextNeighbor: number;
}

// Iterative DFS tracking each node's traversal state. Reaching a node still in
// the 'visiting' state closes a cycle, which is sliced off the active path and
// deduped by its canonical rotation-invariant signature.
function findCycles(
  nodeIds: Set<string>,
  adjacency: Map<string, string[]>,
  seeds: string[]
): string[][] {
  const traversalState = new Map<string, TraversalState>();
  for (const id of nodeIds) traversalState.set(id, 'unvisited');

  const cycles: string[][] = [];
  const seenSignatures = new Set<string>();

  // The active DFS path — the chain of nodes currently being visited
  const path: string[] = [];
  const pathPositions = new Map<string, number>();

  function enter(node: string, work: Frame[]): void {
    traversalState.set(node, 'visiting');
    pathPositions.set(node, path.length);
    path.push(node);
    work.push({ node, nextNeighbor: 0 });
  }

  // Process seeds first (in order), then any remaining nodes
  for (const root of [...seeds, ...nodeIds]) {
    if (traversalState.get(root) !== 'unvisited') continue;

    const work: Frame[] = [];
    enter(root, work);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.nextNeighbor >= neighbors.length) {
        // All neighbors explored: do the post-order bookkeeping — leave the
        // path, forget the position, mark visited — then pop the frame.
        path.pop();
        pathPositions.delete(frame.node);
        traversalState.set(frame.node, 'visited');
        work.pop();
        continue;
      }

      const next = neighbors[frame.nextNeighbor++];
      const state = traversalState.get(next);
      if (state === 'visiting') {
        const startIdx = pathPositions.get(next);
        if (startIdx === undefined) continue;
        const cycle = path.slice(startIdx);
        const signature = canonicalSignature(cycle);
        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          cycles.push(cycle);
        }
      } else if (state === 'unvisited') {
        enter(next, work);
      }
    }
  }

  return cycles;
}

function buildAdjacency(
  nodeIds: Set<string>,
  edges: GraphEdge[]
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
  }
  return adjacency;
}

function buildASTNodesIndex(
  root: Record<string, unknown>,
  nodeIds: Set<string>
): Map<string, AstLike> {
  const index = new Map<string, AstLike>();
  for (const [namespace, group] of Object.entries(root)) {
    if (!isNamedMap(group)) continue;
    for (const [name, entry] of group as Iterable<[string, unknown]>) {
      const id = `${namespace}.${name}`;
      if (!nodeIds.has(id)) continue;
      if (entry == null || typeof entry !== 'object') continue;
      index.set(id, entry as AstLike);
    }
  }
  return index;
}

// Entry point: detect cycles in the agent's execution graph and attach a
// warning to each cycle member that resolves to a defining AST instance.
export function checkCycleRules(root: Record<string, unknown>): void {
  const { nodes, edges } = extractGraph(root, AgentFabricSchemaInfo);
  if (nodes.length === 0) return;

  const triggerIds = new Set<string>();
  for (const edge of edges) {
    if (edge.via === 'trigger') triggerIds.add(edge.from);
  }
  const nodeIds = new Set(
    nodes.map(node => node.id).filter(id => !triggerIds.has(id))
  );
  if (nodeIds.size === 0) return;

  const adjacency = buildAdjacency(nodeIds, edges);
  // Seeds: the first nodes reached from each trigger's transition container.
  const seeds = edges
    .filter(edge => edge.via === 'trigger' && nodeIds.has(edge.to))
    .map(edge => edge.to);

  const cycles = findCycles(nodeIds, adjacency, seeds);
  if (cycles.length === 0) return;

  const astNodesIndex = buildASTNodesIndex(root, nodeIds);
  for (const cycle of cycles) {
    for (const nodeId of cycle) {
      const astNode = astNodesIndex.get(nodeId);
      if (!astNode) continue;
      const message = `Cycle detected in execution flow: ${formatCyclePath(cycle, nodeId)}`;
      attachWarning(astNode, message, 'cycle-detected');
    }
  }
}
