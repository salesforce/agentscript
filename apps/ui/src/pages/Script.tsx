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
import { TreeInspectorPanel } from '~/components/panels/TreeInspectorPanel';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '~/components/ui/resizable';
import { Button } from '~/components/ui/button';
import { IoBug, IoBugOutline } from 'react-icons/io5';
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
  const showTreeInspector = useAppStore(
    state => state.layout.showTreeInspector
  );
  const toggleTreeInspector = useAppStore(state => state.toggleTreeInspector);
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

  // Use initialSelection ONLY on first mount to restore saved cursor position
  // DO NOT track agent.editorSelection changes after mount - that causes unwanted scrolling
  // when the debounced selection save fires after cursor movements
  const initialSelection = useMemo(() => {
    // Only return the selection if we're mounting for the first time
    // We can't easily detect "first mount" here, so we rely on the MonacoEditor
    // component to only use initialSelection once when it first renders
    return agent?.editorSelection ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps = only run once on mount

  // On mount, scroll to the currently selected explorer node (e.g. when
  // navigating from Builder/Graph back to Script).
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

  // Resolve system theme to actual theme
  const systemTheme =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  const actualTheme = theme === 'system' ? systemTheme : theme;

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-[#2b2b2b] dark:bg-[#121314]">
      <PanelHeader
        title="Agent Definition"
        canExpand={true}
        isExpanded={scriptEditorExpanded}
        onExpand={toggleScriptEditorExpand}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-gray-600 hover:bg-gray-300/50 hover:text-gray-900 dark:text-[#cccccc] dark:hover:bg-[#454646] dark:hover:text-white"
              onClick={toggleTreeInspector}
              title={
                showTreeInspector ? 'Hide Debug Panel' : 'Show Debug Panel'
              }
            >
              {showTreeInspector ? (
                <IoBug className="h-4 w-4" />
              ) : (
                <IoBugOutline className="h-4 w-4" />
              )}
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="script-tree-layout"
        >
          <ResizablePanel
            id="editor-panel"
            order={1}
            defaultSize={70}
            minSize={40}
          >
            <MonacoEditor
              theme={actualTheme}
              agentId={agentId}
              initialSelection={initialSelection}
            />
          </ResizablePanel>
          {showTreeInspector && (
            <>
              <ResizableHandle />
              <ResizablePanel
                id="tree-inspector-panel"
                order={2}
                defaultSize={30}
                minSize={15}
                maxSize={50}
              >
                <TreeInspectorPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
