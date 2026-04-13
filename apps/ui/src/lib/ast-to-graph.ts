/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * AST to Graph Data Transformer
 *
 * Converts AgentScript AST into React Flow-compatible node/edge arrays
 * for the Graph view. Two modes:
 *   - Overview: topics as nodes, transitions as edges
 *   - Topic Detail: compound sections, actions, conditionals, transitions
 */

import type { Node, Edge } from '@xyflow/react';
import {
  collectDiagnostics,
  decomposeAtMemberExpression,
  isNamedMap,
  NamedMap,
  type Diagnostic,
  type Statement,
} from '@agentscript/language';
import type { AgentScriptAST } from '~/lib/parser';
import { findTopicBlock } from '~/lib/ast-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraphNodeType =
  | 'start'
  | 'start-agent'
  | 'topic'
  | 'action'
  | 'compound-topic'
  | 'conditional'
  | 'transition'
  | 'run'
  | 'set'
  | 'template'
  | 'phase'
  | 'phase-label'
  | 'llm'
  | 'build-instructions'
  | 'reasoning-group';

export type PhaseType =
  | 'topic-header'
  | 'before_reasoning'
  | 'after_reasoning'
  | 'before_reasoning_iteration';

/** Well-known group container IDs for post-layout positioning. */
export const GROUP_IDS = {
  beforeReasoning: 'group-before-reasoning',
  reasoningLoop: 'group-reasoning-loop',
  afterReasoning: 'group-after-reasoning',
} as const;

export interface GraphNodeData extends Record<string, unknown> {
  nodeType: GraphNodeType;
  label: string;
  subtitle?: string;
  blockType: string;
  isStartAgent?: boolean;
  topicName?: string;
  conditionText?: string;
  /** Short human-readable label derived from the condition (for compact display). */
  conditionLabel?: string;
  transitionTarget?: string;
  sections?: string[];
  actionNames?: string[];
  /** Raw action map keys (parallel to actionNames) for AST lookup. */
  actionKeys?: string[];
  diagnostics?: Diagnostic[];
  /** Phase type for phase/phase-label nodes */
  phaseType?: PhaseType;
  /** Which group container this node belongs to (for post-layout grouping). */
  groupId?: string;
  /** True for nodes on the main execution pipeline (spine). */
  isSpine?: boolean;
  /** Ordering index on the spine (0 = first). Used by deterministic layout. */
  spineIndex?: number;
  /** True when a container/phase exists but has no child statements. */
  isEmpty?: boolean;
  /** Set of handle IDs that have edges connected (populated after layout). */
  connectedHandles?: ReadonlySet<string>;
  /** Horizontal offset from container left edge to spine center (for group handle positioning). */
  spineOffsetX?: number;
}

/** Data attached to conditional edges for the drawer. */
export interface ConditionalEdgeData extends Record<string, unknown> {
  conditionText: string;
  sourceTopicName: string;
  conditionalKey: string;
}

/** Data for the action detail drawer. */
export interface ActionDrawerData {
  actionDisplayName: string;
  actionIndex: number;
  topicName?: string;
}

/** Data for the node detail drawer (any clickable graph node). */
export interface NodeDrawerData {
  nodeId: string;
  nodeType: GraphNodeType;
  label: string;
  subtitle?: string;
  topicName?: string;
  conditionText?: string;
  conditionLabel?: string;
  transitionTarget?: string;
  phaseType?: PhaseType;
  actionNames?: string[];
  actionKeys?: string[];
  isEmpty?: boolean;
}

/** Discriminated union for graph drawer content types. */
export type GraphDrawerPayload =
  | { type: 'conditional'; data: ConditionalEdgeData }
  | { type: 'action'; data: ActionDrawerData }
  | { type: 'node'; data: NodeDrawerData };

export type GraphNode = Node<GraphNodeData>;
export type GraphEdge = Edge;

interface TransitionInfo {
  targetTopicName: string;
  conditionText?: string;
  /** Which branch of a conditional this transition is in */
  branch?: 'if' | 'else';
  /** Groups if+else branches of the same conditional (uses the condition text) */
  conditionalKey?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a short human-readable label from a condition expression.
 * E.g. `@variables.checked_loyalty_tier == False` → `Checked Loyalty Tier?`
 */
function abbreviateCondition(condText: string): string {
  // Try to extract a variable name from @variables.xxx or @xxx.yyy patterns
  const varMatch = condText.match(/@\w+\.(\w+)/);
  if (varMatch) {
    const varName = varMatch[1];
    // Convert snake_case to Title Case and append "?"
    const label = varName
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return `${label}?`;
  }
  // Fall back to truncated text
  if (condText.length > 18) {
    return `${condText.slice(0, 18)}...`;
  }
  return condText;
}

function toDisplayLabel(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Get the label from a topic block, falling back to formatted name. */
function getTopicLabel(block: Record<string, unknown>, name: string): string {
  const label = block.label as { value?: string } | undefined;
  return label?.value ?? toDisplayLabel(name);
}

/**
 * Resolve a ToClause target expression to a topic name.
 * Handles `@topic.name` MemberExpression patterns.
 */
function resolveTransitionTarget(expr: unknown): string | null {
  const decomposed = decomposeAtMemberExpression(expr);
  if (decomposed && decomposed.namespace === 'topic') {
    return decomposed.property;
  }
  return null;
}

/**
 * Recursively walk statement arrays to extract all transition targets.
 * Handles TransitionStatement (with ToClause children) and IfStatement branches.
 */
function extractTransitions(
  statements: Statement[],
  parentCondition?: string,
  parentBranch?: 'if' | 'else',
  parentConditionalKey?: string
): TransitionInfo[] {
  const transitions: TransitionInfo[] = [];

  for (const stmt of statements) {
    if (stmt.__kind === 'TransitionStatement') {
      const transition = stmt as { clauses: Statement[] };
      for (const clause of transition.clauses) {
        if (clause.__kind === 'ToClause') {
          const toClause = clause as { target: unknown };
          const target = resolveTransitionTarget(toClause.target);
          if (target) {
            transitions.push({
              targetTopicName: target,
              conditionText: parentCondition,
              branch: parentBranch,
              conditionalKey: parentConditionalKey,
            });
          }
        }
      }
    } else if (stmt.__kind === 'IfStatement') {
      const ifStmt = stmt as {
        condition?: { __emit?(ctx: { indent: number }): string };
        body: Statement[];
        orelse: Statement[];
      };
      const condText = ifStmt.condition?.__emit?.({ indent: 0 }) ?? '';
      transitions.push(
        ...extractTransitions(ifStmt.body, condText, 'if', condText)
      );

      if (ifStmt.orelse?.length > 0) {
        if (
          ifStmt.orelse.length === 1 &&
          ifStmt.orelse[0].__kind === 'IfStatement'
        ) {
          // elif chain — recurse (each elif gets its own conditionalKey)
          transitions.push(...extractTransitions(ifStmt.orelse));
        } else {
          // else branch — same conditionalKey as the if
          transitions.push(
            ...extractTransitions(ifStmt.orelse, condText, 'else', condText)
          );
        }
      }
    }
  }

  return transitions;
}

/** Get statements from a ProcedureValue field. */
function getProcedureStatements(procedure: unknown): Statement[] {
  if (!procedure || typeof procedure !== 'object') return [];
  const proc = procedure as { statements?: Statement[] };
  return proc.statements ?? [];
}

/**
 * Extract all transitions from a topic block.
 * Searches three locations:
 * 1. after_reasoning.statements[] — TransitionStatement / IfStatement with ToClause
 * 2. reasoning.instructions.statements[] — TransitionStatement / IfStatement with ToClause
 * 3. reasoning.actions (Map<string, ReasoningActionBlock>) — each has statements[] with ToClause
 *    These are `@utils.transition` reasoning actions (e.g., go_to_identity, go_to_order)
 */
function extractAllTopicTransitions(
  block: Record<string, unknown>
): TransitionInfo[] {
  const transitions: TransitionInfo[] = [];
  const seen = new Set<string>();

  const addUnique = (infos: TransitionInfo[]) => {
    for (const info of infos) {
      const key = `${info.targetTopicName}:${info.conditionText ?? ''}:${info.branch ?? ''}:${info.conditionalKey ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        transitions.push(info);
      }
    }
  };

  // 1. after_reasoning
  addUnique(extractTransitions(getProcedureStatements(block.after_reasoning)));

  // 2. reasoning.instructions
  const reasoning = block.reasoning as Record<string, unknown> | undefined;
  if (reasoning) {
    addUnique(
      extractTransitions(getProcedureStatements(reasoning.instructions))
    );

    // 3. reasoning.actions (Map of ReasoningActionBlock)
    const reasoningActions = reasoning.actions as
      | NamedMap<Record<string, unknown>>
      | undefined;
    if (isNamedMap(reasoningActions)) {
      for (const [, ab] of reasoningActions) {
        const stmts = ab.statements as Statement[] | undefined;
        if (stmts) {
          addUnique(extractTransitionsFromReasoningAction(stmts));
        }
      }
    }
  }

  // 3. before_reasoning (can also contain transitions)
  addUnique(extractTransitions(getProcedureStatements(block.before_reasoning)));

  return transitions;
}

/**
 * Extract transitions from a ReasoningActionBlock's statements.
 * These contain ToClause (direct target) and AvailableWhen (conditions).
 */
function extractTransitionsFromReasoningAction(
  statements: Statement[]
): TransitionInfo[] {
  const transitions: TransitionInfo[] = [];
  for (const stmt of statements) {
    if (stmt.__kind === 'ToClause') {
      const toClause = stmt as { target: unknown };
      const target = resolveTransitionTarget(toClause.target);
      if (target) {
        transitions.push({ targetTopicName: target });
      }
    } else if (stmt.__kind === 'TransitionStatement') {
      const transition = stmt as { clauses: Statement[] };
      for (const clause of transition.clauses) {
        if (clause.__kind === 'ToClause') {
          const toClause = clause as { target: unknown };
          const target = resolveTransitionTarget(toClause.target);
          if (target) {
            transitions.push({ targetTopicName: target });
          }
        }
      }
    }
  }
  return transitions;
}

/** Get the names of all topics (both start_agent and topic). */
function getAllTopicNames(ast: AgentScriptAST): Set<string> {
  const names = new Set<string>();
  const startAgent = ast.start_agent as
    | NamedMap<Record<string, unknown>>
    | undefined;
  const topics = ast.topic as NamedMap<Record<string, unknown>> | undefined;
  if (isNamedMap(startAgent)) {
    for (const name of startAgent.keys()) names.add(name as string);
  }
  if (isNamedMap(topics)) {
    for (const name of topics.keys()) names.add(name as string);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Overview Graph
// ---------------------------------------------------------------------------

/**
 * Convert AST to an overview graph: Start → Start Agents → Topics
 * with transition edges between topics. Conditional transitions use
 * a dedicated edge type with the condition text as a label.
 */
export function astToOverviewGraph(ast: AgentScriptAST): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const validTopics = getAllTopicNames(ast);

  // Start node
  nodes.push({
    id: 'start',
    type: 'start',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'start',
      label: 'Start',
      blockType: 'start',
    },
  });

  /**
   * Process transitions from a source topic node.
   * Unconditional transitions → direct edges.
   * Conditional transitions → conditional edges with condition label.
   */
  function addTransitionEdges(
    sourceNodeId: string,
    block: Record<string, unknown>
  ) {
    try {
      const transitions = extractAllTopicTransitions(block);
      const unconditional: TransitionInfo[] = [];
      // Group conditional transitions by conditionalKey
      const conditionalGroups = new Map<
        string,
        { ifTargets: string[]; elseTargets: string[]; condText: string }
      >();

      for (const t of transitions) {
        if (!validTopics.has(t.targetTopicName)) continue;
        if (t.branch && t.conditionalKey) {
          let group = conditionalGroups.get(t.conditionalKey);
          if (!group) {
            group = {
              ifTargets: [],
              elseTargets: [],
              condText: t.conditionalKey,
            };
            conditionalGroups.set(t.conditionalKey, group);
          }
          const targetId = findTopicNodeId(t.targetTopicName, ast);
          if (t.branch === 'if') {
            group.ifTargets.push(targetId);
          } else {
            group.elseTargets.push(targetId);
          }
        } else {
          unconditional.push(t);
        }
      }

      // Direct edges for unconditional transitions
      for (const t of unconditional) {
        const targetId = findTopicNodeId(t.targetTopicName, ast);
        edges.push({
          id: `e-${sourceNodeId}-${targetId}`,
          source: sourceNodeId,
          target: targetId,
          type: 'smoothstep',
        });
      }

      // Conditional edges with gate-icon labels
      // Derive topic name from node ID (format: "start_agent-name" or "topic-name")
      const sourceTopicName = sourceNodeId.replace(/^(start_agent|topic)-/, '');

      for (const [, group] of conditionalGroups) {
        for (const targetId of group.ifTargets) {
          edges.push({
            id: `e-${sourceNodeId}-if-${targetId}`,
            source: sourceNodeId,
            target: targetId,
            type: 'conditional',
            label: `If: ${group.condText}`,
            markerEnd: { type: 'arrowclosed' as const, color: '#9ca3af' },
            data: {
              conditionText: group.condText,
              sourceTopicName,
              conditionalKey: group.condText,
            },
          });
        }

        for (const targetId of group.elseTargets) {
          edges.push({
            id: `e-${sourceNodeId}-else-${targetId}`,
            source: sourceNodeId,
            target: targetId,
            type: 'conditional',
            label: 'Else',
            markerEnd: { type: 'arrowclosed' as const, color: '#9ca3af' },
            data: {
              conditionText: group.condText,
              sourceTopicName,
              conditionalKey: group.condText,
            },
          });
        }
      }
    } catch {
      // Skip transition extraction if AST is malformed
    }
  }

  // Start Agent nodes
  const startAgent = ast.start_agent as
    | NamedMap<Record<string, unknown>>
    | undefined;
  if (isNamedMap(startAgent)) {
    for (const [name, block] of startAgent) {
      const nodeId = `start_agent-${name}`;
      const blockDiagnostics = collectDiagnostics(block);
      nodes.push({
        id: nodeId,
        type: 'start-agent',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'start-agent',
          label: getTopicLabel(block, name),
          subtitle: 'Start Agent',
          blockType: 'start_agent',
          isStartAgent: true,
          topicName: name,
          diagnostics: blockDiagnostics,
        },
      });

      // Edge from Start to this start_agent
      edges.push({
        id: `e-start-${nodeId}`,
        source: 'start',
        target: nodeId,
        type: 'smoothstep',
      });

      addTransitionEdges(nodeId, block);
    }
  }

  // Topic nodes
  const topics = ast.topic as NamedMap<Record<string, unknown>> | undefined;
  if (isNamedMap(topics)) {
    for (const [name, block] of topics) {
      const nodeId = `topic-${name}`;
      const blockDiagnostics = collectDiagnostics(block);
      nodes.push({
        id: nodeId,
        type: 'topic',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'topic',
          label: getTopicLabel(block, name),
          subtitle: 'Topic',
          blockType: 'topic',
          topicName: name,
          diagnostics: blockDiagnostics,
        },
      });

      addTransitionEdges(nodeId, block);
    }
  }

  return { nodes, edges };
}

/** Resolve a topic name to its node ID (checking start_agent first, then topic). */
function findTopicNodeId(name: string, ast: AgentScriptAST): string {
  const startAgent = ast.start_agent as
    | NamedMap<Record<string, unknown>>
    | undefined;
  if (isNamedMap(startAgent) && startAgent.has(name)) {
    return `start_agent-${name}`;
  }
  return `topic-${name}`;
}

// ---------------------------------------------------------------------------
// Topic Detail Graph — Execution Pipeline
// ---------------------------------------------------------------------------

/**
 * Convert a single topic into a detail graph showing its execution pipeline.
 *
 * Structure:
 *   [Topic Header]
 *        ↓
 *   ┌─ BEFORE REASONING ─────────────┐  (container, only if has statements)
 *   │  [child run/set/template nodes] │
 *   └────────────┬────────────────────┘
 *                ↓
 *   ┌─ REASONING LOOP ───────────────────────────────┐
 *   │  [Before Reasoning Iteration]                   │
 *   │       ↓              ↘ [template/conditional]   │
 *   │  [Agent Reasoning]                              │
 *   │       ↓                                         │
 *   │  [Tool Execution]                               │
 *   │       ↘ [Action nodes]                          │
 *   │       ↓                                         │
 *   │  [After All Tool Calls]                         │
 *   │       ↘ [Transition nodes]                      │
 *   │       ↓           ↑ loop back                   │
 *   └──────┬────────────┴─────────────────────────────┘
 *          ↓  exit
 *   ┌─ AFTER REASONING ──────────────┐  (container, only if has statements)
 *   │  [child set/transition nodes]   │
 *   └────────────────────────────────┘
 *
 * Nodes carry a `groupId` in their data so Graph.tsx can compute container
 * bounding boxes after ELK layout and position the group background nodes.
 */
export function astToTopicDetailGraph(
  ast: AgentScriptAST,
  topicName: string
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const block = findTopicBlock(ast, topicName);
  if (!block) return { nodes, edges };

  const topicBlock = block as Record<string, unknown>;
  const topicDiagnostics = collectDiagnostics(topicBlock);
  const reasoning = topicBlock.reasoning as Record<string, unknown> | undefined;

  let condIdx = 0;
  let transIdx = 0;
  let runIdx = 0;
  let setIdx = 0;
  let tplIdx = 0;
  const counters: IdCounters = {
    getCondIdx: () => condIdx++,
    getTransIdx: () => transIdx++,
    getRunIdx: () => runIdx++,
    getSetIdx: () => setIdx++,
    getTplIdx: () => tplIdx++,
  };

  // Track the last pipeline node for sequential connections
  let lastPipelineId: string | undefined;
  let lastPipelineHandle: string | undefined;
  let spineCounter = 0;

  const connectPipeline = (targetId: string) => {
    // Tag the node as a spine node
    const node = nodes.find(n => n.id === targetId);
    if (node) {
      node.data = { ...node.data, isSpine: true, spineIndex: spineCounter++ };
    }

    if (lastPipelineId) {
      edges.push({
        id: `e-pipe-${lastPipelineId}-${targetId}`,
        source: lastPipelineId,
        sourceHandle: lastPipelineHandle,
        target: targetId,
        type: 'smoothstep',
        data: { edgeRole: 'spine' },
      });
    }
    lastPipelineId = targetId;
    lastPipelineHandle = undefined;
  };

  // -----------------------------------------------------------------------
  // 0. Topic Header — always present
  // -----------------------------------------------------------------------
  const headerId = 'topic-header';
  nodes.push({
    id: headerId,
    type: 'phase',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'phase',
      label: getTopicLabel(topicBlock, topicName),
      subtitle: topicName,
      blockType: 'topic',
      phaseType: 'topic-header',
      topicName,
      diagnostics: topicDiagnostics,
    },
  });
  connectPipeline(headerId);

  // -----------------------------------------------------------------------
  // 1. Before Reasoning phase (always shown; empty if no statements)
  // -----------------------------------------------------------------------
  const beforeStatements = getProcedureStatements(topicBlock.before_reasoning);
  const beforeEmpty = beforeStatements.length === 0;

  // Group container (visual — positioned post-layout)
  nodes.push({
    id: GROUP_IDS.beforeReasoning,
    type: 'reasoning-group',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'reasoning-group',
      label: 'Before Reasoning',
      blockType: 'topic',
      isEmpty: beforeEmpty,
    },
  });

  // Phase header inside the container
  const beforeId = 'before-reasoning';
  nodes.push({
    id: beforeId,
    type: 'phase',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'phase',
      label: 'Before Reasoning',
      subtitle: beforeEmpty ? 'no hooks configured' : 'every turn',
      blockType: 'topic',
      phaseType: 'before_reasoning',
      groupId: GROUP_IDS.beforeReasoning,
      topicName,
      isEmpty: beforeEmpty,
    },
  });
  // Route spine through the before-reasoning group handles:
  //   previous → group (t-c) → group (enter-out) → before-reasoning → group (exit-in) → group (b-c) → next
  edges.push({
    id: `e-pipe-${lastPipelineId}-${GROUP_IDS.beforeReasoning}`,
    source: lastPipelineId!,
    sourceHandle: lastPipelineHandle,
    target: GROUP_IDS.beforeReasoning,
    targetHandle: 'top',
    type: 'smoothstep',
    data: { edgeRole: 'spine' },
  });
  edges.push({
    id: `e-pipe-${GROUP_IDS.beforeReasoning}-${beforeId}`,
    source: GROUP_IDS.beforeReasoning,
    sourceHandle: 'enter-out',
    target: beforeId,
    type: 'smoothstep',
    data: { edgeRole: 'spine' },
  });
  // Tag as spine manually (can't use connectPipeline — it would create a direct edge)
  const beforeNode = nodes.find(n => n.id === beforeId);
  if (beforeNode) {
    beforeNode.data = {
      ...beforeNode.data,
      isSpine: true,
      spineIndex: spineCounter++,
    };
  }
  lastPipelineId = beforeId;
  lastPipelineHandle = undefined;

  if (!beforeEmpty) {
    buildDetailNodes(
      beforeStatements,
      beforeId,
      undefined,
      nodes,
      edges,
      counters,
      GROUP_IDS.beforeReasoning
    );
  }

  // Exit the before-reasoning group
  edges.push({
    id: `e-pipe-${lastPipelineId}-${GROUP_IDS.beforeReasoning}-exit`,
    source: lastPipelineId!,
    sourceHandle: lastPipelineHandle,
    target: GROUP_IDS.beforeReasoning,
    targetHandle: 'exit-in',
    type: 'smoothstep',
    data: { edgeRole: 'spine' },
  });
  lastPipelineId = GROUP_IDS.beforeReasoning;
  lastPipelineHandle = 'bottom';

  // -----------------------------------------------------------------------
  // 2. Reasoning Loop (always shown if reasoning block exists)
  // -----------------------------------------------------------------------
  if (reasoning) {
    // Group container (visual — positioned post-layout)
    nodes.push({
      id: GROUP_IDS.reasoningLoop,
      type: 'reasoning-group',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'reasoning-group',
        label: 'Reasoning Loop',
        blockType: 'topic',
      },
    });

    // 2a. Enter the loop: spine goes through group handles
    //   before-reasoning → group (top) → group (enter-out) → before-reasoning-iteration
    edges.push({
      id: `e-pipe-${lastPipelineId}-${GROUP_IDS.reasoningLoop}`,
      source: lastPipelineId!,
      sourceHandle: lastPipelineHandle,
      target: GROUP_IDS.reasoningLoop,
      targetHandle: 'top',
      type: 'smoothstep',
      data: { edgeRole: 'spine' },
    });

    const iterationId = 'before-reasoning-iteration';
    nodes.push({
      id: iterationId,
      type: 'phase-label',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'phase-label',
        label: 'Before Reasoning Iteration',
        subtitle: 'every iteration',
        blockType: 'topic',
        phaseType: 'before_reasoning_iteration',
        groupId: GROUP_IDS.reasoningLoop,
      },
    });

    // Edge from Enter Loop handle to first child inside the group
    edges.push({
      id: `e-pipe-${GROUP_IDS.reasoningLoop}-${iterationId}`,
      source: GROUP_IDS.reasoningLoop,
      sourceHandle: 'enter-out',
      target: iterationId,
      type: 'smoothstep',
      data: { edgeRole: 'spine' },
    });
    // Tag iteration as spine and continue pipeline from here
    const iterNode = nodes.find(n => n.id === iterationId);
    if (iterNode) {
      iterNode.data = {
        ...iterNode.data,
        isSpine: true,
        spineIndex: spineCounter++,
      };
    }
    lastPipelineId = iterationId;
    lastPipelineHandle = undefined;

    // 2b. Build child nodes from reasoning.instructions (templates, conditionals)
    const instrStatements = getProcedureStatements(reasoning.instructions);
    const nodeCountBeforeInstr = nodes.length;

    const leafNodeIds = buildDetailNodes(
      instrStatements,
      iterationId,
      undefined,
      nodes,
      edges,
      counters,
      GROUP_IDS.reasoningLoop
    );

    // Move transition nodes outside the loop (transitions are exits)
    for (let i = nodeCountBeforeInstr; i < nodes.length; i++) {
      if (nodes[i].data.nodeType === 'transition') {
        nodes[i] = {
          ...nodes[i],
          data: { ...nodes[i].data, groupId: undefined },
        };
      }
    }

    // 2c. Build Instructions node — collects template outputs
    const buildInstrId = 'build-instructions';
    nodes.push({
      id: buildInstrId,
      type: 'build-instructions',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'build-instructions',
        label: 'Build Instructions',
        blockType: 'topic',
        groupId: GROUP_IDS.reasoningLoop,
      },
    });
    // Tag as spine for layout positioning but no edge from iteration
    const biNode = nodes.find(n => n.id === buildInstrId);
    if (biNode) {
      biNode.data = {
        ...biNode.data,
        isSpine: true,
        spineIndex: spineCounter++,
      };
    }
    lastPipelineId = buildInstrId;
    lastPipelineHandle = undefined;

    // Converge edges: each leaf instruction node → build-instructions (top handles)
    for (const leafId of leafNodeIds) {
      edges.push({
        id: `e-converge-${leafId}-${buildInstrId}`,
        source: leafId,
        sourceHandle: 'bottom',
        target: buildInstrId,
        type: 'smoothstep',
        data: { edgeRole: 'converge' },
      });
    }

    // 2d. Agent Reasoning (LLM node)
    const reasoningActions = reasoning.actions as
      | NamedMap<Record<string, unknown>>
      | undefined;
    const actionDisplayNames: string[] = [];
    const actionKeyNames: string[] = [];
    if (isNamedMap(reasoningActions)) {
      for (const [actionName, actionBlock] of reasoningActions) {
        const actionLabel =
          (actionBlock.label as { value?: string })?.value ??
          toDisplayLabel(actionName);
        actionDisplayNames.push(actionLabel);
        actionKeyNames.push(actionName);
      }
    }

    const llmId = 'reasoning-llm';
    nodes.push({
      id: llmId,
      type: 'llm',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'llm',
        label: 'Agent Reasoning',
        subtitle: 'selects tools',
        blockType: 'topic',
        groupId: GROUP_IDS.reasoningLoop,
        actionNames: actionDisplayNames,
        actionKeys: actionKeyNames,
        topicName,
      },
    });
    connectPipeline(llmId);

    // Transition nodes from reasoning actions — OUTSIDE the loop (no groupId)
    if (isNamedMap(reasoningActions)) {
      for (const [, actionBlock] of reasoningActions) {
        const actionStmts = actionBlock.statements as Statement[] | undefined;
        if (actionStmts) {
          buildDetailNodesFromReasoningAction(
            actionStmts,
            llmId,
            nodes,
            edges,
            counters,
            undefined // no groupId — transitions live outside the loop
          );
        }
      }
    }

    // 2e. Loop-back edge from agent reasoning to before-reasoning-iteration
    edges.push({
      id: 'e-loop-back',
      source: llmId,
      sourceHandle: 'left',
      target: iterationId,
      targetHandle: 'left',
      type: 'loop-back',
    });

    // 2f. Exit the loop: spine goes through group handles
    //   reasoning-llm → group (exit-in) → group (b-c) → after-reasoning
    edges.push({
      id: `e-pipe-${lastPipelineId}-${GROUP_IDS.reasoningLoop}-exit`,
      source: lastPipelineId!,
      sourceHandle: lastPipelineHandle,
      target: GROUP_IDS.reasoningLoop,
      targetHandle: 'exit-in',
      type: 'smoothstep',
      data: { edgeRole: 'spine' },
    });
    lastPipelineId = GROUP_IDS.reasoningLoop;
    lastPipelineHandle = 'bottom';
  }

  // -----------------------------------------------------------------------
  // 3. After Reasoning phase (always shown; empty if no statements)
  // -----------------------------------------------------------------------
  const afterStatements = getProcedureStatements(topicBlock.after_reasoning);
  const afterEmpty = afterStatements.length === 0;

  // Group container (visual — positioned post-layout)
  nodes.push({
    id: GROUP_IDS.afterReasoning,
    type: 'reasoning-group',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'reasoning-group',
      label: 'After Reasoning',
      blockType: 'topic',
      isEmpty: afterEmpty,
    },
  });

  // Phase header inside the container
  const afterId = 'after-reasoning';
  nodes.push({
    id: afterId,
    type: 'phase',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'phase',
      label: 'After Reasoning',
      subtitle: afterEmpty ? 'no hooks configured' : 'every turn',
      blockType: 'topic',
      phaseType: 'after_reasoning',
      groupId: GROUP_IDS.afterReasoning,
    },
  });
  // Route spine through the after-reasoning group handles:
  //   previous → group (top) → group (enter-out) → after-reasoning → group (exit-in) → group (bottom) → next
  edges.push({
    id: `e-pipe-${lastPipelineId}-${GROUP_IDS.afterReasoning}`,
    source: lastPipelineId!,
    sourceHandle: lastPipelineHandle,
    target: GROUP_IDS.afterReasoning,
    targetHandle: 'top',
    type: 'smoothstep',
    data: { edgeRole: 'spine' },
  });
  edges.push({
    id: `e-pipe-${GROUP_IDS.afterReasoning}-${afterId}`,
    source: GROUP_IDS.afterReasoning,
    sourceHandle: 'enter-out',
    target: afterId,
    type: 'smoothstep',
    data: { edgeRole: 'spine' },
  });
  // Tag as spine manually
  const afterNode = nodes.find(n => n.id === afterId);
  if (afterNode) {
    afterNode.data = {
      ...afterNode.data,
      isSpine: true,
      spineIndex: spineCounter++,
    };
  }
  lastPipelineId = afterId;
  lastPipelineHandle = undefined;

  if (!afterEmpty) {
    buildDetailNodes(
      afterStatements,
      afterId,
      undefined,
      nodes,
      edges,
      counters,
      GROUP_IDS.afterReasoning
    );
  }

  // Exit the after-reasoning group
  edges.push({
    id: `e-pipe-${lastPipelineId}-${GROUP_IDS.afterReasoning}-exit`,
    source: lastPipelineId!,
    sourceHandle: lastPipelineHandle,
    target: GROUP_IDS.afterReasoning,
    targetHandle: 'exit-in',
    type: 'smoothstep',
    data: { edgeRole: 'spine' },
  });
  lastPipelineId = GROUP_IDS.afterReasoning;
  lastPipelineHandle = 'bottom';

  // -----------------------------------------------------------------------
  // Post-process: set React Flow parentId for group nesting
  // -----------------------------------------------------------------------
  for (const node of nodes) {
    if (node.data.groupId && node.data.nodeType !== 'reasoning-group') {
      node.parentId = node.data.groupId as string;
    }
  }

  // React Flow requires parent nodes before their children in the array.
  // Stable sort: group nodes first, then everything else in original order.
  nodes.sort((a, b) => {
    const aIsGroup = a.data.nodeType === 'reasoning-group' ? 0 : 1;
    const bIsGroup = b.data.nodeType === 'reasoning-group' ? 0 : 1;
    return aIsGroup - bIsGroup;
  });

  return { nodes, edges };
}

interface IdCounters {
  getCondIdx: () => number;
  getTransIdx: () => number;
  getRunIdx: () => number;
  getSetIdx: () => number;
  getTplIdx: () => number;
}

/**
 * Recursively build detail graph nodes from a statement list.
 * Chains sequential leaf nodes (Run, Set, Template) so they form a pipeline.
 * Branching nodes (If, Transition) fan out from the current source
 * without advancing the chain.
 *
 * Returns the IDs of "leaf" nodes — terminal endpoints of all paths
 * through the instruction tree. Used for converge edges to Build Instructions.
 * Transition nodes are excluded (they exit the loop).
 */
function buildDetailNodes(
  statements: Statement[],
  sourceId: string,
  sourceHandle: string | undefined,
  nodes: GraphNode[],
  edges: GraphEdge[],
  counters: IdCounters,
  groupId?: string
): string[] {
  // Track current source for sequential chaining of leaf nodes (Run, Set)
  let curSource = sourceId;
  let curHandle: string | undefined = sourceHandle;
  const leafNodeIds: string[] = [];

  for (const stmt of statements) {
    if (stmt.__kind === 'TransitionStatement') {
      const transition = stmt as { clauses: Statement[] };
      for (const clause of transition.clauses) {
        if (clause.__kind === 'ToClause') {
          const toClause = clause as { target: unknown };
          const target = resolveTransitionTarget(toClause.target);
          if (target) {
            const transId = `transition-${counters.getTransIdx()}`;
            nodes.push({
              id: transId,
              type: 'transition',
              position: { x: 0, y: 0 },
              data: {
                nodeType: 'transition',
                label: toDisplayLabel(target),
                subtitle: 'Transition',
                blockType: 'topic',
                transitionTarget: target,
                groupId,
              },
            });
            edges.push({
              id: `e-${curSource}-${transId}`,
              source: curSource,
              sourceHandle: curHandle,
              target: transId,
              type: 'smoothstep',
              data: { edgeRole: 'branch' },
            });
          }
        }
      }
      // Transition is terminal — don't advance chain
    } else if (stmt.__kind === 'IfStatement') {
      const ifStmt = stmt as {
        condition?: { __emit?(ctx: { indent: number }): string };
        body: Statement[];
        orelse: Statement[];
      };
      const condText = ifStmt.condition?.__emit?.({ indent: 0 }) ?? '';
      const condId = `conditional-${counters.getCondIdx()}`;

      nodes.push({
        id: condId,
        type: 'conditional',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'conditional',
          label: 'Conditional',
          subtitle: 'Conditional',
          blockType: 'conditional',
          conditionText: condText,
          conditionLabel: abbreviateCondition(condText),
          groupId,
        },
      });

      edges.push({
        id: `e-${curSource}-${condId}`,
        source: curSource,
        sourceHandle: curHandle,
        target: condId,
        type: 'smoothstep',
        data: { edgeRole: 'branch' },
      });

      // If branch — collect leaf nodes
      const ifLeaves = buildDetailNodes(
        ifStmt.body,
        condId,
        'if',
        nodes,
        edges,
        counters,
        groupId
      );
      leafNodeIds.push(...ifLeaves);

      // Else branch — collect leaf nodes
      if (ifStmt.orelse.length > 0) {
        const elseLeaves = buildDetailNodes(
          ifStmt.orelse,
          condId,
          'else',
          nodes,
          edges,
          counters,
          groupId
        );
        leafNodeIds.push(...elseLeaves);
      }
      // Branching — don't advance chain (subsequent statements fan from same source)
    } else if (stmt.__kind === 'RunStatement') {
      const runStmt = stmt as { target: unknown; body: Statement[] };
      const decomposed = decomposeAtMemberExpression(runStmt.target);
      if (decomposed) {
        const runId = `run-${counters.getRunIdx()}`;
        nodes.push({
          id: runId,
          type: 'run',
          position: { x: 0, y: 0 },
          data: {
            nodeType: 'run',
            label: toDisplayLabel(decomposed.property),
            subtitle: `@${decomposed.namespace}`,
            blockType: 'actions',
            groupId,
          },
        });
        edges.push({
          id: `e-${curSource}-${runId}`,
          source: curSource,
          sourceHandle: curHandle,
          target: runId,
          type: 'smoothstep',
          data: { edgeRole: 'branch' },
        });
        // Advance chain — next statement connects from this Run
        curSource = runId;
        curHandle = undefined;

        // Process nested body (runs can nest runs)
        if (runStmt.body.length > 0) {
          buildDetailNodes(
            runStmt.body,
            runId,
            undefined,
            nodes,
            edges,
            counters,
            groupId
          );
        }
      }
    } else if (stmt.__kind === 'SetClause') {
      const setStmt = stmt as {
        target: unknown;
        value?: { __emit?(ctx: { indent: number }): string; value?: unknown };
      };
      const decomposed = decomposeAtMemberExpression(setStmt.target);
      if (decomposed) {
        const setId = `set-${counters.getSetIdx()}`;
        const valueText = setStmt.value?.__emit
          ? setStmt.value.__emit({ indent: 0 })
          : String(setStmt.value?.value ?? '');
        nodes.push({
          id: setId,
          type: 'set',
          position: { x: 0, y: 0 },
          data: {
            nodeType: 'set',
            label: `@${decomposed.namespace}.${decomposed.property}`,
            subtitle: valueText,
            blockType: 'set',
            groupId,
          },
        });
        edges.push({
          id: `e-${curSource}-${setId}`,
          source: curSource,
          sourceHandle: curHandle,
          target: setId,
          type: 'smoothstep',
          data: { edgeRole: 'branch' },
        });
        // Advance chain — next statement connects from this Set
        curSource = setId;
        curHandle = undefined;
      }
    } else if (stmt.__kind === 'Template') {
      const tpl = stmt as {
        parts: Array<{
          __kind: string;
          value?: string;
          expression?: unknown;
        }>;
      };
      // Build a summary from template parts
      const textParts: string[] = [];
      for (const part of tpl.parts) {
        if (part.__kind === 'TemplateText' && part.value) {
          textParts.push(part.value.trim());
        } else if (part.__kind === 'TemplateInterpolation' && part.expression) {
          const decomposed = decomposeAtMemberExpression(part.expression);
          if (decomposed) {
            textParts.push(`{@${decomposed.namespace}.${decomposed.property}}`);
          }
        }
      }
      const templateText = textParts.join(' ').trim();
      if (templateText) {
        const tplId = `template-${counters.getTplIdx()}`;
        nodes.push({
          id: tplId,
          type: 'template',
          position: { x: 0, y: 0 },
          data: {
            nodeType: 'template',
            label: templateText,
            blockType: 'template',
            groupId,
          },
        });
        edges.push({
          id: `e-${curSource}-${tplId}`,
          source: curSource,
          sourceHandle: curHandle,
          target: tplId,
          type: 'smoothstep',
          data: { edgeRole: 'branch' },
        });
        // Advance chain — templates append sequentially
        curSource = tplId;
        curHandle = undefined;
      }
    }
  }

  // The final curSource (if it advanced beyond sourceId) is a leaf node.
  // Transitions are excluded (they exit the loop, not converge).
  if (curSource !== sourceId) {
    const leafNode = nodes.find(n => n.id === curSource);
    if (
      leafNode?.data.nodeType !== 'transition' &&
      leafNode?.data.nodeType !== 'set'
    ) {
      leafNodeIds.push(curSource);
    }
  }

  return leafNodeIds;
}

/**
 * Build detail graph nodes from a ReasoningActionBlock's statements.
 * These contain ToClause (direct targets) and TransitionStatement wrappers.
 */
function buildDetailNodesFromReasoningAction(
  statements: Statement[],
  sourceId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  counters: IdCounters,
  groupId?: string
): void {
  for (const stmt of statements) {
    if (stmt.__kind === 'ToClause') {
      const toClause = stmt as { target: unknown };
      const target = resolveTransitionTarget(toClause.target);
      if (target) {
        const transId = `transition-${counters.getTransIdx()}`;
        nodes.push({
          id: transId,
          type: 'transition',
          position: { x: 0, y: 0 },
          data: {
            nodeType: 'transition',
            label: toDisplayLabel(target),
            subtitle: 'Transition',
            blockType: 'topic',
            transitionTarget: target,
            groupId,
          },
        });
        edges.push({
          id: `e-${sourceId}-${transId}`,
          source: sourceId,
          target: transId,
          type: 'smoothstep',
          data: { edgeRole: 'branch' },
        });
      }
    } else if (stmt.__kind === 'TransitionStatement') {
      const transition = stmt as { clauses: Statement[] };
      for (const clause of transition.clauses) {
        if (clause.__kind === 'ToClause') {
          const toClause = clause as { target: unknown };
          const target = resolveTransitionTarget(toClause.target);
          if (target) {
            const transId = `transition-${counters.getTransIdx()}`;
            nodes.push({
              id: transId,
              type: 'transition',
              position: { x: 0, y: 0 },
              data: {
                nodeType: 'transition',
                label: toDisplayLabel(target),
                subtitle: 'Transition',
                blockType: 'topic',
                transitionTarget: target,
                groupId,
              },
            });
            edges.push({
              id: `e-${sourceId}-${transId}`,
              source: sourceId,
              target: transId,
              type: 'smoothstep',
              data: { edgeRole: 'branch' },
            });
          }
        }
      }
    }
  }
}
