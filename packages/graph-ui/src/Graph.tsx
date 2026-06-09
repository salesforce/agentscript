/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  type ColorMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  astToOverviewGraph,
  astToTopicDetailGraph,
  type GraphNode,
  type GraphEdge,
  type GraphNodeData,
} from './ast/ast-to-graph';
import {
  applyDagreOverviewLayout,
  applyDagreDetailLayout,
} from './ast/graph-layout';
import { findPathEdges } from './ast/graph-path';
import { graphNodeTypes } from './components/nodes';
import { graphEdgeTypes } from './components/edges';
import {
  GraphContextProvider,
  type ActionClickPayload,
  type ConditionalClickPayload,
} from './context/GraphContext';
import type { AgentScriptAST } from './ast/ast-utils';

export interface GraphNodeClickPayload {
  nodeId: string;
  nodeType: string;
  topicName: string | undefined;
  isStartAgent: boolean;
  /** Raw node data for host-specific drawers. */
  data: GraphNodeData;
}

export interface GraphProps {
  ast: AgentScriptAST | null;
  /** Undefined = overview view; set = topic detail view for that topic name. */
  topicId?: string;
  theme: 'light' | 'dark' | 'system';
  /** Called when user double-clicks a topic node in the overview. */
  onTopicOpen?: (topicName: string, isStartAgent: boolean) => void;
  /** Called when an LLM action pill is clicked (detail view). */
  onActionClick?: (payload: ActionClickPayload) => void;
  /** Called when a conditional edge gate icon is clicked. */
  onConditionalClick?: (payload: ConditionalClickPayload) => void;
  /** Called on single-click — host syncs selection/drawer state. */
  onNodeClick?: (payload: GraphNodeClickPayload) => void;
  /** Called when user clicks the pane background. */
  onPaneClick?: () => void;
  /** Content to render when there are no nodes. */
  emptyMessage?: string;
}

const defaultEdgeOptions = {
  style: { stroke: '#64748b', strokeWidth: 2 },
};

/** Inject connectedHandles sets into node data after layout. */
function injectConnectedHandles(
  nodes: GraphNode[],
  connectedHandles: Map<string, Set<string>>
): GraphNode[] {
  return nodes.map(node => {
    const connected = connectedHandles.get(node.id);
    if (connected) {
      return { ...node, data: { ...node.data, connectedHandles: connected } };
    }
    return node;
  });
}

function GraphInner({
  ast,
  topicId,
  theme,
  onTopicOpen,
  onActionClick,
  onConditionalClick,
  onNodeClick,
  onPaneClick,
  emptyMessage,
}: GraphProps) {
  const { fitView } = useReactFlow();
  const isTopicDetail = !!topicId;

  const rawGraph = useMemo(() => {
    if (!ast) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    if (isTopicDetail) return astToTopicDetailGraph(ast, topicId!);
    return astToOverviewGraph(ast);
  }, [ast, isTopicDetail, topicId]);

  const detailLayout = useMemo(() => {
    if (!isTopicDetail || rawGraph.nodes.length === 0) return null;
    const result = applyDagreDetailLayout(rawGraph.nodes, rawGraph.edges);
    const nodesWithHandles = injectConnectedHandles(
      result.nodes,
      result.connectedHandles
    );
    return { nodes: nodesWithHandles, edges: result.edges };
  }, [rawGraph, isTopicDetail]);

  const overviewLayout = useMemo(() => {
    if (isTopicDetail || rawGraph.nodes.length === 0) return null;
    const layoutableNodes = rawGraph.nodes.filter(
      n => n.data.nodeType !== 'reasoning-group'
    );
    const result = applyDagreOverviewLayout(layoutableNodes, rawGraph.edges, {
      direction: 'TB',
    });
    const nodesWithHandles = injectConnectedHandles(
      result.nodes,
      result.connectedHandles
    );
    return { nodes: nodesWithHandles, edges: result.edges };
  }, [rawGraph, isTopicDetail]);

  const layoutNodes = useMemo(() => {
    if (detailLayout) return detailLayout.nodes;
    if (overviewLayout) return overviewLayout.nodes;
    return [];
  }, [detailLayout, overviewLayout]);
  const layoutEdges = useMemo(() => {
    if (detailLayout) return detailLayout.edges;
    if (overviewLayout) return overviewLayout.edges;
    return [];
  }, [detailLayout, overviewLayout]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(
    null
  );

  const highlightedEdgeIds = useMemo<Set<string> | null>(() => {
    if (!selectedGraphNodeId || isTopicDetail) return null;
    return findPathEdges(layoutEdges, 'start', selectedGraphNodeId);
  }, [selectedGraphNodeId, layoutEdges, isTopicDetail]);

  useEffect(() => {
    setNodes(layoutNodes);
    requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 300 });
    });
  }, [layoutNodes, setNodes, fitView]);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as unknown as GraphNodeData;
      if (
        !isTopicDetail &&
        (data.nodeType === 'topic' || data.nodeType === 'start-agent') &&
        typeof data.topicName === 'string'
      ) {
        onTopicOpen?.(data.topicName, !!data.isStartAgent);
      }
    },
    [isTopicDetail, onTopicOpen]
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!isTopicDetail) setSelectedGraphNodeId(node.id);
      const data = node.data as unknown as GraphNodeData;
      onNodeClick?.({
        nodeId: node.id,
        nodeType: data.nodeType,
        topicName: data.topicName,
        isStartAgent: !!data.isStartAgent,
        data,
      });
    },
    [isTopicDetail, onNodeClick]
  );

  const handlePaneClick = useCallback(() => {
    setSelectedGraphNodeId(null);
    onPaneClick?.();
  }, [onPaneClick]);

  const colorMode: ColorMode =
    theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';

  return (
    <GraphContextProvider
      value={{ highlightedEdgeIds, onActionClick, onConditionalClick }}
    >
      <div className="relative h-full w-full">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            {emptyMessage ??
              'No topics defined. Add topics in the Script or Builder view.'}
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={layoutEdges}
            onNodesChange={onNodesChange}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={graphNodeTypes}
            edgeTypes={graphEdgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            colorMode={colorMode}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background gap={32} size={0.8} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </GraphContextProvider>
  );
}

export function Graph(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
