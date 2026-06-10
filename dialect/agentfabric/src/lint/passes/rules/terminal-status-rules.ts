/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { extractGraph } from '../../../graph/extractor.js';
import { AgentFabricSchemaInfo, A2A_TERMINAL_STATES } from '../../../schema.js';
import { attachError, extractStringValue, type AstLike } from './shared.js';

/**
 * All terminal branches in a graph MUST contain an echo node with
 * kind "a2a:status_update_event" that sets a terminal A2A state
 * ("completed", "failed", or "canceled"). The echo need not be the
 * leaf node — the graph may continue after it (e.g. for cleanup).
 */
export function checkTerminalStatusRules(root: Record<string, unknown>): void {
  const { nodes, edges } = extractGraph(root, AgentFabricSchemaInfo);
  if (nodes.length === 0) return;

  const triggerIds = new Set<string>(
    nodes.filter(n => n.namespace === 'trigger').map(n => n.id)
  );

  const nonTriggerNodes = nodes.filter(n => !triggerIds.has(n.id));
  if (nonTriggerNodes.length === 0) return;

  // Build forward adjacency and find terminal (leaf) nodes.
  const outgoingCount = new Map<string, number>();
  for (const node of nonTriggerNodes) outgoingCount.set(node.id, 0);
  for (const edge of edges) {
    if (!outgoingCount.has(edge.from)) continue;
    outgoingCount.set(edge.from, (outgoingCount.get(edge.from) ?? 0) + 1);
  }

  const terminalNodeIds = nonTriggerNodes
    .filter(n => (outgoingCount.get(n.id) ?? 0) === 0)
    .map(n => n.id);

  if (terminalNodeIds.length === 0) return;

  // Collect the set of echo nodes that emit a terminal status update.
  const terminalStatusEchoIds = collectTerminalStatusEchoIds(root);

  // If the graph already has at least one terminal status echo, check
  // that every terminal node can be reached FROM one (i.e., a terminal
  // status echo is an ancestor of every leaf node).
  // Build reverse adjacency: for each node, which nodes point to it.
  const reverseAdj = new Map<string, string[]>();
  for (const node of nonTriggerNodes) reverseAdj.set(node.id, []);
  for (const edge of edges) {
    if (!reverseAdj.has(edge.to)) continue;
    reverseAdj.get(edge.to)!.push(edge.from);
  }

  for (const terminalId of terminalNodeIds) {
    if (terminalStatusEchoIds.has(terminalId)) continue;

    if (hasAncestorInSet(terminalId, terminalStatusEchoIds, reverseAdj)) {
      continue;
    }

    const astNode = findAstNode(root, terminalId);
    if (astNode) {
      // TODO: post-GA, improve this diagnostic to show the full branch path
      // and highlight which execution paths lack a terminal status update.
      const shortName = terminalId.split('.').pop() ?? terminalId;
      attachError(
        astNode,
        `Every execution path must set a terminal task state before ending. ` +
          `The branch ending at '${shortName}' has no echo with kind "a2a:status_update_event" ` +
          `and a terminal state (TASK_STATE_COMPLETED, TASK_STATE_FAILED, or TASK_STATE_CANCELED).`,
        'terminal-requires-status-update'
      );
    }
  }
}

/**
 * Collect IDs of echo nodes whose kind is "a2a:status_update_event"
 * and whose state is a terminal value.
 */
function collectTerminalStatusEchoIds(
  root: Record<string, unknown>
): Set<string> {
  const ids = new Set<string>();
  const echoEntries = root.echo;
  if (!isNamedMap(echoEntries)) return ids;

  for (const [name, entry] of echoEntries) {
    if (entry == null || typeof entry !== 'object') continue;
    const echoEntry = entry as Record<string, unknown>;
    const kind = extractStringValue(echoEntry.kind);
    if (kind !== 'a2a:status_update_event') continue;
    const state = extractStringValue(echoEntry.state);
    if (state !== undefined && A2A_TERMINAL_STATES.has(state)) {
      ids.add(`echo.${name}`);
    }
  }
  return ids;
}

/**
 * BFS backwards from `startId` through reverse edges to check if any
 * node in `targetSet` is an ancestor.
 */
function hasAncestorInSet(
  startId: string,
  targetSet: Set<string>,
  reverseAdj: Map<string, string[]>
): boolean {
  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const predecessors = reverseAdj.get(current) ?? [];
    for (const pred of predecessors) {
      if (targetSet.has(pred)) return true;
      if (!visited.has(pred)) {
        visited.add(pred);
        queue.push(pred);
      }
    }
  }
  return false;
}

function findAstNode(
  root: Record<string, unknown>,
  nodeId: string
): AstLike | null {
  const dotIndex = nodeId.indexOf('.');
  if (dotIndex < 0) return null;
  const namespace = nodeId.slice(0, dotIndex);
  const name = nodeId.slice(dotIndex + 1);
  const group = root[namespace];
  if (!isNamedMap(group)) return null;
  for (const [key, entry] of group as Iterable<[string, unknown]>) {
    if (key === name && entry != null && typeof entry === 'object') {
      return entry as AstLike;
    }
  }
  return null;
}
