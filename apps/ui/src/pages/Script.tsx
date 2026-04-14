/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useParams } from 'react-router';
import { useAgentStore } from '~/store/agentStore';
import { MonacoEditor } from '~/components/MonacoEditor';
import { useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '~/store';
import { PanelHeader } from '~/components/panels/PanelHeader';
import {
  astToTreeData,
  findTreeNodeById,
} from '~/components/explorer/astToTreeData';
import type { AgentScriptAST } from '~/lib/parser';

export function Script() {
  const { agentId } = useParams();
  const theme = useAppStore(state => state.theme.theme);
  const scriptEditorExpanded = useAppStore(
    state => state.layout.scriptEditorExpanded
  );
  const toggleScriptEditorExpand = useAppStore(
    state => state.toggleScriptEditorExpand
  );
  const agent = useAgentStore(state =>
    agentId ? state.agents[agentId] : null
  );

  // Auto-register agent in local registry if not present
  // This is for the agents list, NOT for content (Loro handles content)
  useEffect(() => {
    if (agentId && !agent) {
      console.warn(
        '[Script] Auto-registering agent in local registry:',
        agentId
      );
      const agents = useAgentStore.getState().agents;
      const now = new Date();
      useAgentStore.setState({
        agents: {
          ...agents,
          [agentId]: {
            id: agentId,
            name: 'Shared Agent', // Will be updated from Loro metadata
            content: '', // Will be loaded from storage
            lastModified: now,
            createdAt: now,
          },
        },
      });
    }
  }, [agentId, agent]);

  const initialSelection = useMemo(() => {
    return agent?.editorSelection ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monacoEditor = useAppStore(state => state.source.monacoEditor);
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;
  const selectedNodeId = useAppStore(state => state.layout.selectedNodeId);
  const hasScrolledToSelection = useRef(false);

  useEffect(() => {
    if (hasScrolledToSelection.current) return;
    if (!selectedNodeId || !monacoEditor || !ast) return;

    hasScrolledToSelection.current = true;

    const treeData = astToTreeData(ast);
    const node = findTreeNodeById(treeData, selectedNodeId);
    if (node?.data.startPosition) {
      const { row, column } = node.data.startPosition;
      const lineNumber = row + 1;
      const col = column + 1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = monacoEditor as any;
      editor.revealPositionInCenter({ lineNumber, column: col });
      editor.setPosition({ lineNumber, column: col });
    }
  }, [selectedNodeId, monacoEditor, ast]);

  const systemTheme =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  const actualTheme = theme === 'system' ? systemTheme : theme;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        title="Agent Definition"
        canExpand={true}
        isExpanded={scriptEditorExpanded}
        onExpand={toggleScriptEditorExpand}
      />
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          theme={actualTheme}
          agentId={agentId}
          initialSelection={initialSelection}
        />
      </div>
    </div>
  );
}
