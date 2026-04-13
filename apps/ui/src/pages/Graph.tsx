/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
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

import { useAppStore } from '~/store';
import type { AgentScriptAST } from '~/lib/parser';
import {
  astToOverviewGraph,
  astToTopicDetailGraph,
  type GraphNode,
  type GraphEdge,
} from '~/lib/ast-to-graph';
import {
  applyDagreOverviewLayout,
  applyDagreDetailLayout,
} from '~/lib/graph-layout';
import { graphNodeTypes } from '~/components/graph/nodes';
import { graphEdgeTypes } from '~/components/graph/edges';
import { ErrorBoundary } from '~/components/shared/ErrorBoundary';
import { ChevronLeft } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { findPathEdges } from '~/lib/graph-path';
import { GraphDrawer } from '~/components/graph/GraphDrawer';

const defaultEdgeOptions = {
  style: { stroke: '#64748b', strokeWidth: 2 },
  markerEnd: {
    type: 'arrowclosed' as const,
    color: '#64748b',
    width: 18,
    height: 18,
  },
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

function GraphInner() {
  const { agentId, topicId } = useParams();
  const navigate = useNavigate();
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;
  const setSelectedNodeId = useAppStore(state => state.setSelectedNodeId);
  const theme = useAppStore(state => state.theme.theme);
  const closeGraphDrawer = useAppStore(state => state.closeGraphDrawer);
  const openGraphDrawer = useAppStore(state => state.openGraphDrawer);
  const setHighlightedEdgeIds = useAppStore(
    state => state.setHighlightedEdgeIds
  );
  const { fitView } = useReactFlow();

  const isTopicDetail = !!topicId;

  // Graph data from AST (before layout)
  const rawGraph = useMemo(() => {
    if (!ast) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };

    if (isTopicDetail) {
      return astToTopicDetailGraph(ast, topicId!);
    }

    return astToOverviewGraph(ast);
  }, [ast, isTopicDetail, topicId]);

  // Synchronous detail layout (computed directly, no effect needed)
  const detailLayout = useMemo(() => {
    if (!isTopicDetail || rawGraph.nodes.length === 0) return null;
    const result = applyDagreDetailLayout(rawGraph.nodes, rawGraph.edges);
    const nodesWithHandles = injectConnectedHandles(
      result.nodes,
      result.connectedHandles
    );
    return { nodes: nodesWithHandles, edges: result.edges };
  }, [rawGraph, isTopicDetail]);

  // Synchronous overview layout
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

  // Derive final layout
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

  // Node state (needs useNodesState for dragging/selection via onNodesChange)
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);

  // Path highlighting state (overview only)
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(
    null
  );

  // Compute highlighted edge IDs and push to store for edge components
  useEffect(() => {
    if (!selectedGraphNodeId || isTopicDetail) {
      setHighlightedEdgeIds(null);
      return;
    }
    const ids = findPathEdges(layoutEdges, 'start', selectedGraphNodeId);
    setHighlightedEdgeIds(ids);
  }, [selectedGraphNodeId, layoutEdges, isTopicDetail, setHighlightedEdgeIds]);

  // Clear highlighting on unmount
  useEffect(() => {
    return () => setHighlightedEdgeIds(null);
  }, [setHighlightedEdgeIds]);

  // Sync node layout + fit view on layout changes
  useEffect(() => {
    setNodes(layoutNodes);
    requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 300 });
    });
  }, [layoutNodes, setNodes, fitView]);

  // Double-click topic → navigate to topic detail
  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (
        !isTopicDetail &&
        (node.data.nodeType === 'topic' ||
          node.data.nodeType === 'start-agent') &&
        node.data.topicName
      ) {
        void navigate(`/agents/${agentId}/graph/${node.data.topicName}`);
      }
    },
    [agentId, isTopicDetail, navigate]
  );

  // Single-click → sync with explorer + path highlighting + open drawer
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Path highlighting (overview only)
      if (!isTopicDetail) {
        setSelectedGraphNodeId(node.id);
      }

      if (node.data.topicName) {
        const isStartAgent = node.data.isStartAgent;
        const prefix = isStartAgent ? 'start_agent' : 'topic';
        setSelectedNodeId(`${prefix}-${node.data.topicName}`);
      }

      // Open node detail drawer (detail view only, skip non-interactive containers)
      if (isTopicDetail && node.data.nodeType !== 'reasoning-group') {
        openGraphDrawer({
          type: 'node',
          data: {
            nodeId: node.id,
            nodeType: node.data.nodeType,
            label: node.data.label,
            subtitle: node.data.subtitle,
            topicName: node.data.topicName,
            conditionText: node.data.conditionText,
            conditionLabel: node.data.conditionLabel,
            transitionTarget: node.data.transitionTarget,
            phaseType: node.data.phaseType,
            actionNames: node.data.actionNames,
            actionKeys: node.data.actionKeys,
            isEmpty: node.data.isEmpty,
          },
        });
      }
    },
    [setSelectedNodeId, isTopicDetail, openGraphDrawer]
  );

  // Click background → clear selection + close drawer
  const handlePaneClick = useCallback(() => {
    setSelectedGraphNodeId(null);
    closeGraphDrawer();
  }, [closeGraphDrawer]);

  const handleBackToOverview = useCallback(() => {
    void navigate(`/agents/${agentId}/graph`);
  }, [agentId, navigate]);

  // Resolve color mode for React Flow
  const colorMode: ColorMode =
    theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-9 items-center gap-2 border-b border-[#f1f1f2] bg-[#fafafd] px-3 dark:border-[#2b2b2b] dark:bg-[#191a1b]">
        {isTopicDetail && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-gray-600 hover:bg-gray-300/50 hover:text-gray-900 dark:text-[#cccccc] dark:hover:bg-[#454646] dark:hover:text-white"
            onClick={handleBackToOverview}
            title="Back to overview"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <h2 className="text-sm font-semibold text-[#606060] dark:font-normal dark:text-[#bfbfbf]">
          {isTopicDetail ? `Topic: ${topicId}` : 'Agent Graph'}
        </h2>
      </div>

      {/* Graph Canvas */}
      <div className="relative flex-1">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            No topics defined. Add topics in the Script or Builder view.
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
        <GraphDrawer />
      </div>
    </div>
  );
}

/**
 * Graph page — wraps the inner component with ReactFlowProvider
 * so useReactFlow() is available.
 */
export function Graph() {
  return (
    <ReactFlowProvider>
      <ErrorBoundary fallbackMessage="The graph could not be rendered.">
        <GraphInner />
      </ErrorBoundary>
    </ReactFlowProvider>
  );
}
