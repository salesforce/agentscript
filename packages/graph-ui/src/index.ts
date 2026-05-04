/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export { Graph } from './Graph';
export type { GraphProps, GraphNodeClickPayload } from './Graph';

// AST + layout
export {
  astToOverviewGraph,
  astToTopicDetailGraph,
  type GraphNode,
  type GraphEdge,
  type GraphNodeData,
  type GraphNodeType,
  type PhaseType,
  type ConditionalEdgeData,
  type ActionDrawerData,
  type NodeDrawerData,
  type GraphDrawerPayload,
} from './ast/ast-to-graph';
export {
  applyDagreOverviewLayout,
  applyDagreDetailLayout,
} from './ast/graph-layout';
export { findPathEdges } from './ast/graph-path';
export { findTopicBlock, type AgentScriptAST } from './ast/ast-utils';

// Tokens / visual config
export { GRAPH } from './tokens/graph-tokens';
export {
  getBlockTypeConfig,
  type BlockTypeConfig,
} from './tokens/block-type-config';

// Context (for hosts that want to configure callbacks outside <Graph>)
export {
  GraphContextProvider,
  useGraphContext,
  type ActionClickPayload,
  type ConditionalClickPayload,
  type GraphContextValue,
} from './context/GraphContext';

// Registries (for hosts rendering their own React Flow)
export { graphNodeTypes } from './components/nodes';
export { graphEdgeTypes } from './components/edges';

// Reusable UI bits
export { DiagnosticHoverCard } from './components/nodes/DiagnosticHoverCard';
