/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Outlet, useParams, useLocation } from 'react-router';
import { useEffect, useRef } from 'react';
import { Header } from '../Header';
import { NavBar } from '../NavBar';
import { IDEFooter } from '../IDEFooter';
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from '~/components/ui/resizable';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { useAppStore } from '~/store';
import { useAgentStore } from '~/store/agentStore';
import { ExplorerPanel } from '~/components/panels/ExplorerPanel';
import { OutputPanel } from '~/components/panels/OutputPanel';
import { parseAgentScript } from '~/lib/parser';
import { MonacoEditorProvider } from '~/contexts/MonacoEditorContext';

/**
 * IDE Layout Content - Inner component with access to DiffContext
 */
function IDELayoutContent() {
  const { agentId } = useParams();
  const showLeftPanel = useAppStore(state => state.layout.showLeftPanel);
  const showBottomPanel = useAppStore(state => state.layout.showBottomPanel);
  const setShowLeftPanel = useAppStore(state => state.setShowLeftPanel);
  const setShowBottomPanel = useAppStore(state => state.setShowBottomPanel);
  const agentscript = useAppStore(state => state.source.agentscript);
  const setAgentScript = useAppStore(state => state.setAgentScript);
  const setParseResult = useAppStore(state => state.setParseResult);
  const setDiagnostics = useAppStore(state => state.setDiagnostics);
  const getAgent = useAgentStore(state => state.getAgent);
  const updateAgent = useAgentStore(state => state.updateAgent);
  // Generation counter to discard stale parse results
  const parseGeneration = useRef(0);

  // Refs to imperatively control panel collapse state
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);

  // Imperatively control panel collapse state based on store
  useEffect(() => {
    if (leftPanelRef.current) {
      if (showLeftPanel) {
        leftPanelRef.current.expand();
      } else {
        leftPanelRef.current.collapse();
      }
    }
  }, [showLeftPanel]);

  useEffect(() => {
    if (bottomPanelRef.current) {
      if (showBottomPanel) {
        bottomPanelRef.current.expand();
      } else {
        bottomPanelRef.current.collapse();
      }
    }
  }, [showBottomPanel]);

  const location = useLocation();

  // Check if we're on the agents list page or standalone component page
  const isAgentsList = !agentId && !location.pathname.includes('/component');
  const isStandaloneComponent =
    !agentId && location.pathname.includes('/component');

  // Load agent content from localStorage when agentId changes
  useEffect(() => {
    if (!agentId) return;

    const agent = getAgent(agentId);
    if (agent) {
      setAgentScript(agent.content || '');
    }
  }, [agentId, getAgent, setAgentScript]);

  // Always parse on the main thread so the explorer has the AST and
  // diagnostics are available immediately. The LSP worker also parses and
  // sends diagnostics, which will overwrite these once the worker is ready.
  // Uses a generation counter to discard stale results from superseded parses.
  useEffect(() => {
    if (agentscript === undefined || agentscript === null) return;

    const gen = ++parseGeneration.current;

    parseAgentScript(agentscript)
      .then(({ tree, ast, store, diagnostics }) => {
        // Discard if a newer parse was triggered while this one was in-flight
        if (gen !== parseGeneration.current) return;

        setParseResult({
          cst: tree,
          ast,
          lintStore: store,
        });
        setDiagnostics(diagnostics);
      })
      .catch(error => {
        if (gen !== parseGeneration.current) return;
        console.error('[IDE] Parse error:', error);
      });
  }, [agentscript, setParseResult, setDiagnostics]);

  // Sync agent_label from config block to localStorage.
  // Uses the raw agentscript text so it updates instantly on every keystroke
  // without waiting for the async parse to complete.
  useEffect(() => {
    if (!agentId || !agentscript) return;

    const match = agentscript.match(/agent_label:\s*"([^"]*?)"/);
    if (match?.[1] !== undefined) {
      const agentLabel = match[1];
      const agent = getAgent(agentId);
      if (agent && agent.name !== agentLabel) {
        updateAgent(agentId, { name: agentLabel });
      }
    }
  }, [agentId, agentscript, getAgent, updateAgent]);

  const content = (
    <>
      <div className="flex h-screen flex-col bg-gray-100 dark:bg-[#121314] overflow-hidden">
        <Header />
        <div className="flex flex-1 overflow-hidden">
          <NavBar />
          {isAgentsList ? (
            // Agents list page - no panels, just render the outlet
            <div className="flex-1">
              <Outlet />
            </div>
          ) : isStandaloneComponent ? (
            // Standalone component page - no explorer, but keep bottom panel
            <ResizablePanelGroup
              direction="vertical"
              className="flex-1"
              autoSaveId="ide-component-vertical-layout"
            >
              <ResizablePanel
                id="component-main-panel"
                order={1}
                defaultSize={80}
                minSize={40}
              >
                <Outlet />
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel
                ref={bottomPanelRef}
                id="component-bottom-panel"
                order={2}
                defaultSize={10}
                minSize={8}
                collapsible={true}
                collapsedSize={0}
                onCollapse={() => setShowBottomPanel(false)}
                onExpand={() => setShowBottomPanel(true)}
              >
                <OutputPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            // Agent editor - with resizable panels
            <ResizablePanelGroup
              direction="horizontal"
              className="flex-1"
              autoSaveId="ide-horizontal-layout"
            >
              {/* Left Panel - Explorer */}
              <ResizablePanel
                ref={leftPanelRef}
                id="explorer-panel"
                order={1}
                defaultSize={15}
                minSize={10}
                maxSize={30}
                collapsible={true}
                collapsedSize={0}
                onCollapse={() => setShowLeftPanel(false)}
                onExpand={() => setShowLeftPanel(true)}
              >
                {showLeftPanel && <ExplorerPanel />}
              </ResizablePanel>

              <ResizableHandle />

              {/* Main Panel */}
              <ResizablePanel id="main-panel" order={2} defaultSize={60}>
                <ResizablePanelGroup
                  direction="vertical"
                  autoSaveId="ide-vertical-layout"
                >
                  {/* Editor Panel */}
                  <ResizablePanel
                    id="editor-panel"
                    order={1}
                    defaultSize={80}
                    minSize={40}
                  >
                    <Outlet />
                  </ResizablePanel>

                  <ResizableHandle />

                  {/* Bottom Panel - Problems/Diagnostics */}
                  <ResizablePanel
                    ref={bottomPanelRef}
                    id="bottom-panel"
                    order={2}
                    defaultSize={10}
                    minSize={8}
                    collapsible={true}
                    collapsedSize={0}
                    onCollapse={() => setShowBottomPanel(false)}
                    onExpand={() => setShowBottomPanel(true)}
                  >
                    <OutputPanel />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
        {/* Only show footer when viewing an agent (not on agents list) */}
        {!isAgentsList && <IDEFooter />}
      </div>
    </>
  );

  return content;
}

/**
 * IDE Layout - Full editor experience with Header, NavBar, Footer, and panels
 * Wraps all /agents/* routes
 */
export function IDELayout() {
  return (
    <MonacoEditorProvider>
      <IDELayoutContent />
    </MonacoEditorProvider>
  );
}
