/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Graph Layout Engine
 *
 * Uses dagre for hierarchical layout of both overview and detail views.
 * Nodes define multiple handles and edges are distributed across available
 * handles to reduce visual overlap.
 */

import dagre from '@dagrejs/dagre';
import type { GraphNode, GraphEdge, GraphNodeType } from './ast-to-graph';
import {
  OVERVIEW_SIDES,
  DETAIL_SIDES,
  START_SIDES,
  TERMINAL_SIDES,
  PHASE_SIDES,
  LLM_SIDES,
  BUILD_INSTRUCTIONS_SIDES,
  type HandleSide,
} from '~/components/graph/nodes/NodeHandles';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LayoutOptions {
  direction: 'TB' | 'LR';
  /** When true, use detail handle side configs instead of overview. */
  isDetail?: boolean;
  rankSep?: number;
  nodeSep?: number;
}

/** Default node dimensions per type. */
const NODE_DIMENSIONS: Record<
  GraphNodeType,
  { width: number; height: number }
> = {
  start: { width: 160, height: 56 },
  'start-agent': { width: 260, height: 88 },
  topic: { width: 260, height: 88 },
  action: { width: 200, height: 70 },
  'compound-topic': { width: 220, height: 200 },
  conditional: { width: 200, height: 56 },
  transition: { width: 200, height: 70 },
  run: { width: 200, height: 70 },
  set: { width: 240, height: 70 },
  template: { width: 300, height: 80 },
  phase: { width: 280, height: 56 },
  'phase-label': { width: 280, height: 44 },
  llm: { width: 460, height: 72 },
  'build-instructions': { width: 280, height: 44 },
  'reasoning-group': { width: 10, height: 10 },
};

function getNodeDimensions(node: GraphNode): {
  width: number;
  height: number;
} {
  const base = NODE_DIMENSIONS[node.data.nodeType] ?? {
    width: 200,
    height: 70,
  };

  // Dynamic height for LLM nodes with action pills
  if (node.data.nodeType === 'llm') {
    const actions = node.data.actionNames as string[] | undefined;
    if (actions && actions.length > 0) {
      const pillRows = Math.ceil(actions.length / 4);
      // border-t (1px) + py-3 (24px) + rows * (pill height ~26px + gap 8px)
      const pillSectionHeight = 25 + pillRows * 28;
      return { width: base.width, height: base.height + pillSectionHeight };
    }
  }

  return base;
}

// ---------------------------------------------------------------------------
// Handle side config per node type
// ---------------------------------------------------------------------------

interface SideConfig {
  type: 'source' | 'target';
}

function getOverviewSides(
  nodeType: GraphNodeType
): Partial<Record<HandleSide, SideConfig>> {
  switch (nodeType) {
    case 'start':
      return START_SIDES;
    case 'transition':
      return TERMINAL_SIDES;
    default:
      return OVERVIEW_SIDES;
  }
}

function getDetailSides(
  nodeType: GraphNodeType
): Partial<Record<HandleSide, SideConfig>> {
  switch (nodeType) {
    case 'transition':
      return TERMINAL_SIDES;
    case 'phase':
    case 'phase-label':
      return PHASE_SIDES;
    case 'llm':
      return LLM_SIDES;
    case 'build-instructions':
      return BUILD_INSTRUCTIONS_SIDES;
    case 'conditional':
      return { top: { type: 'target' }, bottom: { type: 'source' } };
    case 'reasoning-group':
      // Handles are rendered directly in the component (not via NodeHandles grid)
      return {};
    default:
      return DETAIL_SIDES;
  }
}

// ---------------------------------------------------------------------------
// Route point type (used by edge components for orthogonal routing)
// ---------------------------------------------------------------------------

export interface RoutePoint {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface LayoutResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Map of nodeId → Set of connected handle IDs (local, not prefixed) */
  connectedHandles: Map<string, Set<string>>;
}

/**
 * Dagre-based layout for the overview graph.
 *
 * Positions nodes in a hierarchical layered layout (TB) and distributes
 * edges across available handles to reduce overlap.
 *
 * Synchronous — instant render.
 */
export function applyDagreOverviewLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], connectedHandles: new Map() };
  }

  const g = new dagre.graphlib.Graph({ directed: true });
  g.setGraph({
    rankdir: options.direction,
    nodesep: options.nodeSep ?? 80,
    ranksep: options.rankSep ?? 120,
    marginx: 40,
    marginy: 40,
    ranker: 'network-simplex',
  });
  g.setDefaultNodeLabel(() => ({}));
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const dims = getNodeDimensions(node);
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Extract positions (dagre returns center coords → convert to top-left)
  const positionedNodes = nodes.map(node => {
    const dn = g.node(node.id) as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    return {
      ...node,
      position: {
        x: dn ? dn.x - dn.width / 2 : 0,
        y: dn ? dn.y - dn.height / 2 : 0,
      },
    };
  });

  // Assign handles to edges using handle pools (same approach as detail layout)
  const sourcePool = new Map<string, string[]>();
  const targetPool = new Map<string, string[]>();
  const consumedSet = new Map<string, Set<string>>();

  for (const node of nodes) {
    const sides = getOverviewSides(node.data.nodeType);

    const sources: string[] = [];
    if (sides.bottom?.type === 'source') sources.push('bottom');
    if (sides.right?.type === 'source') sources.push('right');

    const targets: string[] = [];
    if (sides.top?.type === 'target') targets.push('top');
    if (sides.left?.type === 'target') targets.push('left');

    sourcePool.set(node.id, sources);
    targetPool.set(node.id, targets);
    consumedSet.set(node.id, new Set());
  }

  function consume(nodeId: string, handleId: string): void {
    consumedSet.get(nodeId)?.add(handleId);
  }

  function takeSource(nodeId: string): string {
    const pool = sourcePool.get(nodeId) ?? [];
    const used = consumedSet.get(nodeId) ?? new Set();
    for (const h of pool) {
      if (!used.has(h)) {
        consume(nodeId, h);
        return h;
      }
    }
    return 'bottom';
  }

  function takeTarget(nodeId: string): string {
    const pool = targetPool.get(nodeId) ?? [];
    const used = consumedSet.get(nodeId) ?? new Set();
    for (const h of pool) {
      if (!used.has(h)) {
        consume(nodeId, h);
        return h;
      }
    }
    return 'top';
  }

  // Reserve explicit handles first
  for (const edge of edges) {
    if (edge.sourceHandle) consume(edge.source, edge.sourceHandle);
    if (edge.targetHandle) consume(edge.target, edge.targetHandle);
  }

  const connectedHandles = new Map<string, Set<string>>();

  const updatedEdges = edges.map(edge => {
    const sourceHandle = edge.sourceHandle ?? takeSource(edge.source);
    const targetHandle = edge.targetHandle ?? takeTarget(edge.target);

    trackHandle(connectedHandles, edge.source, sourceHandle);
    trackHandle(connectedHandles, edge.target, targetHandle);

    return {
      ...edge,
      sourceHandle,
      targetHandle,
    };
  });

  return {
    nodes: positionedNodes,
    edges: updatedEdges,
    connectedHandles,
  };
}

// ---------------------------------------------------------------------------
// Dagre Detail Layout (with React Flow parentId nesting)
// ---------------------------------------------------------------------------

/** Padding inside group containers. */
const GROUP_PAD = { x: 72, top: 64, bottom: 60 };
const GROUP_PAD_EMPTY = { x: 36, top: 48, bottom: 36 };

/** Uniform width for spine nodes in detail view. */
const SPINE_WIDTH = 460;

/**
 * Dagre-based layout for the topic detail view.
 *
 * Runs dagre on all non-group nodes, computes group bounding boxes from
 * member positions, then converts child positions to parent-relative
 * coordinates for React Flow's parentId nesting.
 *
 * Synchronous — instant render.
 */
export function applyDagreDetailLayout(
  nodes: GraphNode[],
  edges: GraphEdge[]
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], connectedHandles: new Map() };
  }

  // -------------------------------------------------------------------------
  // 1. Build flat dagre graph (excluding group container nodes)
  // -------------------------------------------------------------------------
  const g = new dagre.graphlib.Graph({ directed: true });
  g.setGraph({
    rankdir: 'TB',
    nodesep: 80,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
    ranker: 'network-simplex',
  });
  g.setDefaultNodeLabel(() => ({}));
  g.setDefaultEdgeLabel(() => ({}));

  const nodeMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    if (node.data.nodeType === 'reasoning-group') continue;

    const dims = getNodeDimensions(node);
    g.setNode(node.id, {
      width: node.data.isSpine ? SPINE_WIDTH : dims.width,
      height: dims.height,
    });
  }

  // Add edges with weights based on role:
  //   spine edges (high weight) keep the main flow tight and vertical
  //   branch/converge edges (low weight) allow horizontal spread
  //   cross-group spine edges get minlen=2 to prevent group overlap
  for (const edge of edges) {
    if (edge.type === 'loop-back') continue;
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;

    const edgeData = edge.data as Record<string, unknown> | undefined;
    const edgeRole = edgeData?.edgeRole as string | undefined;

    // Detect cross-group boundary (different groupId on source vs target)
    const sourceGroup = nodeMap.get(edge.source)?.data.groupId as
      | string
      | undefined;
    const targetGroup = nodeMap.get(edge.target)?.data.groupId as
      | string
      | undefined;
    const isCrossGroup = sourceGroup !== targetGroup;

    let weight = 1;
    let minlen = 1;
    if (edgeRole === 'spine') {
      weight = 10;
      // Extra rank separation at group boundaries for visual breathing room
      minlen = isCrossGroup ? 3 : 1;
    } else if (edgeRole === 'converge') {
      weight = 1;
      minlen = 1;
    } else {
      // branch edges
      weight = 1;
      minlen = 1;
    }

    g.setEdge(edge.source, edge.target, { weight, minlen });
  }

  // Add bridge edges for edges that pass through group nodes.
  // Group nodes aren't in dagre, so we create direct edges between the
  // non-group endpoints to preserve layout ordering.
  // Enter pair: A → group (t-c), group (enter-out) → B  ⇒  bridge A → B
  // Exit pair:  A → group (exit-in), group (b-c) → B    ⇒  bridge A → B
  const groupIncoming = new Map<
    string,
    Array<{ source: string; targetHandle?: string | null }>
  >();
  const groupOutgoing = new Map<
    string,
    Array<{ target: string; sourceHandle?: string | null }>
  >();
  for (const edge of edges) {
    if (edge.type === 'loop-back') continue;
    const targetNode = nodeMap.get(edge.target);
    const sourceNode = nodeMap.get(edge.source);
    if (targetNode?.data.nodeType === 'reasoning-group') {
      const arr = groupIncoming.get(edge.target) ?? [];
      arr.push({ source: edge.source, targetHandle: edge.targetHandle });
      groupIncoming.set(edge.target, arr);
    }
    if (sourceNode?.data.nodeType === 'reasoning-group') {
      const arr = groupOutgoing.get(edge.source) ?? [];
      arr.push({ target: edge.target, sourceHandle: edge.sourceHandle });
      groupOutgoing.set(edge.source, arr);
    }
  }
  for (const [groupId, inEdges] of groupIncoming) {
    const outEdges = groupOutgoing.get(groupId);
    if (!outEdges) continue;
    for (const inc of inEdges) {
      for (const out of outEdges) {
        // Match enter pair (top / enter-out) or exit pair (exit-in / bottom)
        const isEnter =
          inc.targetHandle === 'top' && out.sourceHandle === 'enter-out';
        const isExit =
          inc.targetHandle === 'exit-in' && out.sourceHandle === 'bottom';
        if (
          (isEnter || isExit) &&
          g.hasNode(inc.source) &&
          g.hasNode(out.target)
        ) {
          g.setEdge(inc.source, out.target, { weight: 10, minlen: 3 });
        }
      }
    }
  }

  // Handle group-to-group spine transitions.
  // When the spine passes through consecutive groups (e.g., before-reasoning → reasoning-loop),
  // both endpoints are group nodes (not in dagre), so the standard bridge logic above fails.
  // Fix: find the last real node exiting the source group and the first real node entering
  // the target group, then create a bridge edge to preserve vertical ordering.
  for (const edge of edges) {
    if (edge.type === 'loop-back') continue;
    const srcNode = nodeMap.get(edge.source);
    const tgtNode = nodeMap.get(edge.target);
    if (
      srcNode?.data.nodeType !== 'reasoning-group' ||
      tgtNode?.data.nodeType !== 'reasoning-group'
    )
      continue;

    // Find the node flowing into the source group's exit-in handle
    let exitNodeId: string | undefined;
    for (const e of edges) {
      if (e.target === edge.source && e.targetHandle === 'exit-in') {
        exitNodeId = e.source;
        break;
      }
    }

    // Find the node flowing out of the target group's enter-out handle
    let enterNodeId: string | undefined;
    for (const e of edges) {
      if (e.source === edge.target && e.sourceHandle === 'enter-out') {
        enterNodeId = e.target;
        break;
      }
    }

    if (
      exitNodeId &&
      enterNodeId &&
      g.hasNode(exitNodeId) &&
      g.hasNode(enterNodeId)
    ) {
      g.setEdge(exitNodeId, enterNodeId, { weight: 10, minlen: 3 });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Run dagre layout
  // -------------------------------------------------------------------------
  dagre.layout(g);

  // -------------------------------------------------------------------------
  // 3. Extract absolute positions (dagre returns center coords → top-left)
  // -------------------------------------------------------------------------
  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const absPositions = new Map<string, Rect>();

  for (const nodeId of g.nodes()) {
    const dn = g.node(nodeId) as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    if (!dn) continue;
    absPositions.set(nodeId, {
      x: dn.x - dn.width / 2,
      y: dn.y - dn.height / 2,
      w: dn.width,
      h: dn.height,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Compute group bounding boxes from member absolute positions
  // -------------------------------------------------------------------------
  const groupNodes = nodes.filter(n => n.data.nodeType === 'reasoning-group');
  const groupPositions = new Map<string, Rect>();

  for (const groupNode of groupNodes) {
    const members: Rect[] = [];
    for (const [id, pos] of absPositions) {
      const n = nodeMap.get(id);
      if (n?.data.groupId === groupNode.id) members.push(pos);
    }
    if (members.length === 0) continue;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const m of members) {
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + m.w);
      maxY = Math.max(maxY, m.y + m.h);
    }

    const isEmpty = groupNode.data.isEmpty === true;
    const pad = isEmpty ? GROUP_PAD_EMPTY : GROUP_PAD;

    groupPositions.set(groupNode.id, {
      x: minX - pad.x,
      y: minY - pad.top,
      w: maxX - minX + pad.x * 2,
      h: maxY - minY + pad.top + pad.bottom,
    });
  }

  // -------------------------------------------------------------------------
  // 4b. Center all group containers on the spine
  //     Find the spine center X (from spine nodes), then horizontally center
  //     each group around it — widening narrower groups so they all share
  //     a common center line.
  // -------------------------------------------------------------------------
  let spineCenterX: number | undefined;
  for (const [id, pos] of absPositions) {
    const n = nodeMap.get(id);
    if (n?.data.isSpine) {
      spineCenterX = pos.x + pos.w / 2;
      break;
    }
  }

  if (spineCenterX !== undefined) {
    // Find the max half-width across all groups so they all share
    // the same width — aligned and centered on the spine.
    let maxHalfWidth = 0;
    for (const [, pos] of groupPositions) {
      const leftDist = spineCenterX - pos.x;
      const rightDist = pos.x + pos.w - spineCenterX;
      maxHalfWidth = Math.max(maxHalfWidth, leftDist, rightDist);
    }

    for (const [groupId, pos] of groupPositions) {
      groupPositions.set(groupId, {
        ...pos,
        x: spineCenterX - maxHalfWidth,
        w: maxHalfWidth * 2,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4c. Stretch LLM nodes to fill their group container width
  // -------------------------------------------------------------------------
  for (const node of nodes) {
    if (node.data.nodeType === 'llm' && node.data.groupId) {
      const groupPos = groupPositions.get(node.data.groupId as string);
      const abs = absPositions.get(node.id);
      if (groupPos && abs) {
        const pad = GROUP_PAD.x;
        absPositions.set(node.id, {
          x: groupPos.x + pad,
          y: abs.y,
          w: groupPos.w - pad * 2,
          h: abs.h,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Build positioned node array
  //    - Group nodes first (React Flow requires parents before children)
  //    - Child positions converted to parent-relative coordinates
  // -------------------------------------------------------------------------
  const positioned: GraphNode[] = [];

  // Group containers
  for (const groupNode of groupNodes) {
    const pos = groupPositions.get(groupNode.id);
    if (!pos) continue;
    positioned.push({
      ...groupNode,
      position: { x: pos.x, y: pos.y },
      style: { width: pos.w, height: pos.h, zIndex: -1 },
      selectable: false,
      draggable: false,
    });
  }

  // All other nodes
  for (const node of nodes) {
    if (node.data.nodeType === 'reasoning-group') continue;
    const absPos = absPositions.get(node.id);
    if (!absPos) continue;

    let position = { x: absPos.x, y: absPos.y };

    // Convert to parent-relative if this node has a parentId (group child)
    if (node.parentId) {
      const parentPos = groupPositions.get(node.parentId);
      if (parentPos) {
        position = {
          x: absPos.x - parentPos.x,
          y: absPos.y - parentPos.y,
        };
      }
    }

    positioned.push({
      ...node,
      position,
      ...(node.data.nodeType === 'llm' && node.parentId
        ? { style: { width: absPos.w } }
        : node.data.isSpine
          ? { width: SPINE_WIDTH }
          : {}),
    });
  }

  // -------------------------------------------------------------------------
  // 6. Assign handles to edges + compute route points
  //    - Each handle used at most once per node
  //    - TB layout: prefer bottom handles for sources, top for targets
  // -------------------------------------------------------------------------

  // Build source/target handle pools per node based on side configs.
  // Order: bottom/top preferred (TB primary), then side handles as overflow.
  const sourcePool = new Map<string, string[]>();
  const targetPool = new Map<string, string[]>();
  const consumedSet = new Map<string, Set<string>>();

  for (const node of nodes) {
    if (node.data.nodeType === 'reasoning-group') continue;
    const sides = getDetailSides(node.data.nodeType);

    const sources: string[] = [];
    if (sides.bottom?.type === 'source') sources.push('bottom');
    if (sides.right?.type === 'source') sources.push('right');
    if (sides.left?.type === 'source') sources.push('left');

    const targets: string[] = [];
    if (sides.top?.type === 'target') targets.push('top');
    if (sides.left?.type === 'target') targets.push('left');
    if (sides.right?.type === 'target') targets.push('right');

    sourcePool.set(node.id, sources);
    targetPool.set(node.id, targets);
    consumedSet.set(node.id, new Set());
  }

  function consume(nodeId: string, handleId: string): void {
    consumedSet.get(nodeId)?.add(handleId);
  }

  function takeSource(nodeId: string): string {
    const pool = sourcePool.get(nodeId) ?? [];
    const used = consumedSet.get(nodeId) ?? new Set();
    for (const h of pool) {
      if (!used.has(h)) {
        consume(nodeId, h);
        return h;
      }
    }
    return 'bottom';
  }

  function takeTarget(nodeId: string): string {
    const pool = targetPool.get(nodeId) ?? [];
    const used = consumedSet.get(nodeId) ?? new Set();
    for (const h of pool) {
      if (!used.has(h)) {
        consume(nodeId, h);
        return h;
      }
    }
    return 'top';
  }

  // Helper: check if a node is a group container (no handle pools)
  const isGroupNode = (nodeId: string): boolean =>
    nodeMap.get(nodeId)?.data.nodeType === 'reasoning-group';

  // Reserve handles that are already spoken for:
  //   - spine edges always use bottom → top (except for group-connected edges)
  //   - loop-back edges have pre-assigned handles
  //   - any edge with explicit sourceHandle/targetHandle from ast-to-graph
  for (const edge of edges) {
    if (edge.type === 'loop-back') {
      if (edge.sourceHandle) consume(edge.source, edge.sourceHandle);
      if (edge.targetHandle) consume(edge.target, edge.targetHandle);
      continue;
    }
    const ed = edge.data as Record<string, unknown> | undefined;
    if ((ed?.edgeRole as string | undefined) === 'spine') {
      // Group nodes have custom handles — don't reserve standard spine handles
      if (!isGroupNode(edge.source)) consume(edge.source, 'bottom');
      if (!isGroupNode(edge.target)) consume(edge.target, 'top');
    }
    if (edge.sourceHandle && !isGroupNode(edge.source))
      consume(edge.source, edge.sourceHandle);
    if (edge.targetHandle && !isGroupNode(edge.target))
      consume(edge.target, edge.targetHandle);
  }

  // Absolute handle position from node rect + handle ID
  function handleAbsPos(rect: Rect, handleId: string): RoutePoint {
    const { x, y, w, h: ht } = rect;
    switch (handleId) {
      case 'top':
        return { x: x + w * 0.5, y };
      case 'bottom':
        return { x: x + w * 0.5, y: y + ht };
      case 'left':
        return { x, y: y + ht * 0.5 };
      case 'right':
        return { x: x + w, y: y + ht * 0.5 };
      // Conditional node if/else handles at 30% and 70% along the bottom
      case 'if':
        return { x: x + w * 0.3, y: y + ht };
      case 'else':
        return { x: x + w * 0.7, y: y + ht };
      // Custom handles for reasoning loop group enter/exit (at the border)
      case 'enter-out':
        return { x: x + w * 0.5, y };
      case 'exit-in':
        return { x: x + w * 0.5, y: y + ht };
      default:
        return { x: x + w * 0.5, y: y + ht };
    }
  }

  const connectedHandles = new Map<string, Set<string>>();

  const lookupAbs = (nodeId: string): Rect | undefined =>
    absPositions.get(nodeId) ?? groupPositions.get(nodeId);

  const updatedEdges = edges.map(edge => {
    // Loop-back: keep pre-assigned handles, inject group container left X for edge snapping
    if (edge.type === 'loop-back') {
      trackHandle(connectedHandles, edge.source, edge.sourceHandle);
      trackHandle(connectedHandles, edge.target, edge.targetHandle);
      const sourceNode = nodeMap.get(edge.source);
      const groupId = sourceNode?.data.groupId as string | undefined;
      const groupPos = groupId ? groupPositions.get(groupId) : undefined;
      return {
        ...edge,
        data: {
          ...(edge.data as Record<string, unknown> | undefined),
          groupLeftX: groupPos?.x,
        },
      };
    }

    const edgeData = edge.data as Record<string, unknown> | undefined;
    const edgeRole = edgeData?.edgeRole as string | undefined;
    const isSpineEdge = edgeRole === 'spine';

    let sourceHandle: string;
    let targetHandle: string;

    if (isSpineEdge) {
      // Group-connected spine edges use their explicit handles (enter-out, exit-in, etc.)
      // rather than the standard bottom → top spine handles.
      sourceHandle = isGroupNode(edge.source)
        ? (edge.sourceHandle ?? 'bottom')
        : 'bottom';
      targetHandle = isGroupNode(edge.target)
        ? (edge.targetHandle ?? 'top')
        : 'top';
    } else {
      sourceHandle = edge.sourceHandle ?? takeSource(edge.source);
      targetHandle = edge.targetHandle ?? takeTarget(edge.target);
    }

    trackHandle(connectedHandles, edge.source, sourceHandle);
    trackHandle(connectedHandles, edge.target, targetHandle);

    // Compute route points (absolute coords for React Flow edge rendering)
    let elkPoints: RoutePoint[] | undefined;

    if (!isSpineEdge) {
      const sourcePos = lookupAbs(edge.source);
      const targetPos = lookupAbs(edge.target);
      if (sourcePos && targetPos) {
        const src = handleAbsPos(sourcePos, sourceHandle);
        const tgt = handleAbsPos(targetPos, targetHandle);
        const srcDown =
          sourceHandle === 'bottom' ||
          sourceHandle === 'if' ||
          sourceHandle === 'else';
        const srcRight = sourceHandle === 'right';
        const tgtUp = targetHandle === 'top';
        const tgtLeft = targetHandle === 'left';

        if (Math.abs(src.x - tgt.x) < 5) {
          // Nearly aligned vertically — straight line
          elkPoints = [src, tgt];
        } else if (srcDown && tgtUp) {
          // Both vertical (bottom → top): step route via midpoint Y
          const midY = (src.y + tgt.y) / 2;
          elkPoints = [src, { x: src.x, y: midY }, { x: tgt.x, y: midY }, tgt];
        } else if (srcDown && tgtLeft) {
          // Down from source, then across to left-side target
          elkPoints = [src, { x: src.x, y: tgt.y }, tgt];
        } else if (srcRight && tgtUp) {
          // Right from source, then up to top target
          elkPoints = [src, { x: tgt.x, y: src.y }, tgt];
        } else if (srcRight && tgtLeft) {
          // Horizontal: straight or S-bend
          if (Math.abs(src.y - tgt.y) < 5) {
            elkPoints = [src, tgt];
          } else {
            const midX = (src.x + tgt.x) / 2;
            elkPoints = [
              src,
              { x: midX, y: src.y },
              { x: midX, y: tgt.y },
              tgt,
            ];
          }
        } else {
          // Default: L-bend
          elkPoints = [src, { x: tgt.x, y: src.y }, tgt];
        }
      }
    }

    return {
      ...edge,
      sourceHandle,
      targetHandle,
      data: {
        ...(edgeData ?? {}),
        ...(elkPoints ? { elkPoints } : {}),
      },
    };
  });

  return {
    nodes: positioned,
    edges: updatedEdges,
    connectedHandles,
  };
}

function trackHandle(
  map: Map<string, Set<string>>,
  nodeId: string,
  handle: string | null | undefined
): void {
  if (!handle) return;
  let set = map.get(nodeId);
  if (!set) {
    set = new Set();
    map.set(nodeId, set);
  }
  set.add(handle);
}
