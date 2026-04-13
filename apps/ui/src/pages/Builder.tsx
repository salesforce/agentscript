/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { useAppStore } from '~/store';
import { useAgentStore } from '~/store/agentStore';
import { getDialectSchema } from '~/lib/parser';
import { detectDialectId } from '~/lib/detect-dialect';
import type { AgentScriptAST } from '~/lib/parser';
import type { FieldType } from '@agentscript/language';
import { collectDiagnostics } from '@agentscript/language';
import { PanelHeader } from '~/components/panels/PanelHeader';
import { BuilderCanvas } from '~/components/builder/BuilderCanvas';
import {
  astToTreeData,
  findTreeNodeById,
  type TreeNode,
} from '~/components/explorer/astToTreeData';
import { AddBlockMenu } from '~/components/builder/AddBlockMenu';
import { ErrorBoundary } from '~/components/shared/ErrorBoundary';
import { DiagnosticHoverCard } from '~/components/graph/nodes/DiagnosticHoverCard';
import { formatFieldName } from '~/lib/schema-introspection';

/**
 * Resolve a selectedNodeId to the AST block, its schema, and display info.
 */
function resolveSelection(
  selectedNodeId: string | undefined,
  ast: AgentScriptAST | null,
  treeData: TreeNode[],
  rootSchema: Record<string, FieldType>
): {
  block: unknown;
  blockName: string;
  /** The schema key for the block type (e.g. "system", "topic", "actions") */
  schemaKey: string;
  /** The schema to render fields from */
  schema: Record<string, FieldType>;
  /** Display label */
  label: string;
  /** Instance name for named blocks */
  instanceName?: string;
} | null {
  if (!selectedNodeId || !ast) return null;

  // Find the TreeNode from the explorer tree data
  const treeNode = findTreeNodeById(treeData, selectedNodeId);
  if (!treeNode) return null;

  // Skip group nodes
  if (treeNode.data.blockType === 'group') return null;

  const astBlock = treeNode.data.astBlock;
  if (!astBlock) return null;

  const blockType = treeNode.data.blockType;

  // Resolve the schema for this block type
  const fieldType = rootSchema[blockType];
  if (!fieldType) {
    // Could be an action — actions use the NamedBlock schema from the parent's actions field
    // Action IDs look like "topicName-action-actionName"
    if (selectedNodeId.includes('-action-')) {
      // Try to get the actions FieldType from topic schema
      const topicFieldType = rootSchema['topic'] ?? rootSchema['start_agent'];
      const topicSchema = topicFieldType?.schema as
        | Record<string, FieldType>
        | undefined;
      const actionsFieldType = topicSchema?.['actions'];
      const actionsSchema = actionsFieldType?.schema as
        | Record<string, FieldType>
        | undefined;

      if (actionsSchema) {
        const parts = selectedNodeId.split('-action-');
        return {
          block: astBlock,
          blockName: 'actions',
          schemaKey: 'actions',
          schema: actionsSchema,
          label: treeNode.data.label,
          instanceName: parts[1],
        };
      }
    }
    return null;
  }

  const blockSchema =
    (fieldType.schema as Record<string, FieldType> | undefined) ?? {};

  // Determine if this is a named instance
  const typedBlock = astBlock as { __name?: string };
  const instanceName = typedBlock.__name;

  return {
    block: astBlock,
    blockName: blockType,
    schemaKey: blockType,
    schema: blockSchema,
    label: treeNode.data.label,
    instanceName,
  };
}

export function Builder() {
  const {
    agentId,
    nodeId: urlNodeId,
    blockType,
    blockName,
    topicName,
    actionName,
  } = useParams();

  // Reconstruct the internal nodeId from the URL segments.
  //   /builder/system                        → "system"       (singleton via :nodeId)
  //   /builder/topic/main                    → "topic-main"   (named via :blockType/:blockName)
  //   /builder/escalation/action/Create_Case → "escalation-action-Create_Case"
  const resolvedNodeId = useMemo(() => {
    if (topicName && actionName) return `${topicName}-action-${actionName}`;
    if (blockType && blockName) return `${blockType}-${blockName}`;
    return urlNodeId;
  }, [urlNodeId, blockType, blockName, topicName, actionName]);

  // Store subscriptions
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;
  const cst = useAppStore(state => state.source.cst);
  const diagnostics = useAppStore(state => state.diagnostics.diagnostics);
  const agentscript = useAppStore(state => state.source.agentscript);
  const dialectId = detectDialectId(agentscript);
  const setAgentScript = useAppStore(state => state.setAgentScript);
  const setSelectedNodeId = useAppStore(state => state.setSelectedNodeId);
  const selectedNodeId = useAppStore(state => state.layout.selectedNodeId);
  const scriptEditorExpanded = useAppStore(
    state => state.layout.scriptEditorExpanded
  );
  const toggleScriptEditorExpand = useAppStore(
    state => state.toggleScriptEditorExpand
  );

  const agent = useAgentStore(state =>
    agentId ? state.agents[agentId] : null
  );
  const updateAgentContent = useAgentStore(state => state.updateAgentContent);

  // Sync URL nodeId → store selectedNodeId (URL is source of truth in builder).
  // ExplorerPanel handles the reverse direction by navigating to the builder URL
  // directly when clicking nodes in builder view.
  useEffect(() => {
    if (resolvedNodeId && resolvedNodeId !== selectedNodeId) {
      setSelectedNodeId(resolvedNodeId);
    }
  }, [resolvedNodeId, selectedNodeId, setSelectedNodeId]);

  // Auto-register agent in local registry if not present
  useEffect(() => {
    if (agentId && !agent) {
      const agents = useAgentStore.getState().agents;
      const now = new Date();
      useAgentStore.setState({
        agents: {
          ...agents,
          [agentId]: {
            id: agentId,
            name: 'Shared Agent',
            content: '',
            lastModified: now,
            createdAt: now,
          },
        },
      });
    }
  }, [agentId, agent]);

  const schema = useMemo(
    () => getDialectSchema(dialectId) as Record<string, FieldType>,
    [dialectId]
  );

  // Build tree data from AST (same data the Explorer uses)
  const treeData = useMemo(() => {
    if (!ast) return [];
    return astToTreeData(ast);
  }, [ast]);

  // Use URL nodeId as primary, fall back to store selection
  const effectiveNodeId = resolvedNodeId ?? selectedNodeId;

  // Resolve the selected node to its AST block + schema
  const selection = useMemo(
    () => resolveSelection(effectiveNodeId, ast, treeData, schema),
    [effectiveNodeId, ast, treeData, schema]
  );

  /** Push new text through the parsing pipeline. */
  const handleApplyText = useCallback(
    (newText: string) => {
      setAgentScript(newText);
      if (agentId) {
        updateAgentContent(agentId, newText);
      }
    },
    [setAgentScript, agentId, updateAgentContent]
  );

  /** Add a new top-level block. */
  const handleAddBlock = useCallback(
    (blockKey: string) => {
      const fieldType = schema[blockKey];
      if (!fieldType) return;

      const currentText =
        typeof cst === 'object' && cst && 'text' in cst
          ? ((cst as { text?: string }).text ?? '')
          : '';

      const scaffold = fieldType.isNamed
        ? `${blockKey} new_${blockKey}:\n  description: ""\n`
        : `${blockKey}:\n`;

      const newText = currentText
        ? currentText.trimEnd() + '\n\n' + scaffold
        : scaffold;

      handleApplyText(newText);
    },
    [schema, cst, handleApplyText]
  );

  // Determine which top-level keys already exist
  const existingKeys = useMemo(() => {
    if (!ast) return new Set<string>();
    const keys = new Set<string>();
    const record = ast as unknown as Record<string, unknown>;
    for (const key of Object.keys(schema)) {
      if (record[key] !== undefined) keys.add(key);
    }
    return keys;
  }, [ast, schema]);

  // Collect diagnostics for the selected block
  const blockDiagnostics = useMemo(() => {
    if (!selection?.block) return [];
    return collectDiagnostics(selection.block);
  }, [selection]);

  // Header title shows what's selected
  const headerTitle = selection
    ? selection.instanceName
      ? `${formatFieldName(selection.blockName)}: ${selection.instanceName}`
      : formatFieldName(selection.blockName)
    : 'Builder';

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-[#2b2b2b] dark:bg-[#252526]">
      <PanelHeader
        title={headerTitle}
        canExpand={true}
        isExpanded={scriptEditorExpanded}
        onExpand={toggleScriptEditorExpand}
        actions={
          blockDiagnostics.length > 0 ? (
            <DiagnosticHoverCard diagnostics={blockDiagnostics} />
          ) : undefined
        }
      />
      <div className="flex-1 overflow-auto">
        <ErrorBoundary fallbackMessage="The builder could not render this block.">
          {selection ? (
            <div className="mx-auto max-w-3xl p-4">
              <BuilderCanvas
                block={selection.block}
                blockName={selection.blockName}
                schema={selection.schema}
                instanceName={selection.instanceName}
                diagnostics={diagnostics}
                cst={cst}
                rootSchema={schema}
                ast={ast}
                onApplyText={handleApplyText}
              />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
              <div className="text-center text-muted-foreground">
                <p className="text-sm font-medium">
                  {ast ? 'Select a block in the Explorer' : 'No content yet'}
                </p>
                <p className="mt-1 text-xs">
                  {ast
                    ? 'Click on any block in the left panel to edit it here.'
                    : 'Write some AgentScript in the Script view, or add a block below.'}
                </p>
              </div>
              <AddBlockMenu
                schema={schema}
                existingKeys={existingKeys}
                onAdd={handleAddBlock}
              />
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
