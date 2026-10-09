/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentDSLAuthoring,
  AgentVersion,
  SubAgentNode,
} from '@agentscript/compiler';
import type { StateVarSpec } from '../state/store.js';

export interface LoadedGraph {
  initialNode: string;
  nodes: Map<string, SubAgentNode>;
  stateVars: StateVarSpec[];
}

/**
 * Load a compiled AgentDSLAuthoring document. We intentionally keep only
 * subagent nodes in the v1 runtime — BYON/router/related_agent can layer on.
 */
export function loadGraph(doc: AgentDSLAuthoring): LoadedGraph {
  const version: AgentVersion = Array.isArray(doc.agent_version)
    ? doc.agent_version[0]
    : doc.agent_version;

  if (!version) throw new Error('agent_version missing from AgentDSLAuthoring');

  const nodes = new Map<string, SubAgentNode>();
  const unsupportedNodes: string[] = [];
  for (const node of version.nodes) {
    if (node.type === 'subagent') {
      nodes.set(node.developer_name, node as SubAgentNode);
      continue;
    }
    unsupportedNodes.push(`${node.developer_name} (${node.type})`);
  }

  if (unsupportedNodes.length > 0) {
    throw new Error(
      `Unsupported node type(s) in document: ${unsupportedNodes.join(', ')}. ` +
        'Only subagent nodes are supported by this runtime version.'
    );
  }

  if (!nodes.has(version.initial_node)) {
    throw new Error(
      `initial_node "${version.initial_node}" is not a subagent in this document`
    );
  }

  const stateVars: StateVarSpec[] = (version.state_variables ?? []).map(v => ({
    name: v.developer_name,
    dataType: v.data_type as StateVarSpec['dataType'],
    isList: Boolean(v.is_list),
    default: v.default,
    visibility: (v.visibility ?? 'Internal') as StateVarSpec['visibility'],
  }));

  return { initialNode: version.initial_node, nodes, stateVars };
}
