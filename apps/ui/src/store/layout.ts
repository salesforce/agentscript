/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ActionDrawerData, GraphDrawerPayload } from '~/lib/ast-to-graph';

// Layout state slice
export interface LayoutState {
  showLeftPanel: boolean;
  showRightPanel: boolean;
  showBottomPanel: boolean;
  bottomPanelExpanded: boolean;
  // Selected node in explorer for navigation/highlighting
  selectedNodeId?: string;
  // Selected CST node in debug panel for highlighting
  selectedCstNodeId?: string;
  // CST debug expanded state in explorer
  cstDebugExpanded: boolean;
  // Active tab in bottom panel
  bottomPanelTab: 'problems' | 'suggestions';
  // Active tab in right panel (thread ID for assistant)
  rightPanelTab: string;
  // Script editor expanded state
  scriptEditorExpanded: boolean;
  // Panel visibility before script editor expansion
  panelsBeforeExpand: { left: boolean; right: boolean; bottom: boolean };
  // Tree inspector panel (split view next to editor)
  showTreeInspector: boolean;
  treeInspectorMode: 'cst' | 'ast' | 'emit' | 'compiled';
  // Emit tab indentation size (spaces per level)
  emitTabSize: number;
  // Selected node in tree inspector
  selectedTreeInspectorNodeId?: string;
  // Graph drawer data — discriminated union (null = closed)
  graphDrawerData: GraphDrawerPayload | null;
  // Highlighted edge IDs for path highlighting (null = no highlighting)
  highlightedEdgeIds: Set<string> | null;
}

export interface LayoutActions {
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
  toggleBottomPanelExpanded: () => void;
  setShowLeftPanel: (show: boolean) => void;
  setShowRightPanel: (show: boolean) => void;
  setShowBottomPanel: (show: boolean) => void;
  setSelectedNodeId: (nodeId: string | undefined) => void;
  setSelectedCstNodeId: (nodeId: string | undefined) => void;
  toggleCstDebugExpanded: () => void;
  setCstDebugExpanded: (expanded: boolean) => void;
  setBottomPanelTab: (tab: 'problems' | 'suggestions') => void;
  setRightPanelTab: (tab: string) => void;
  toggleScriptEditorExpand: () => void;
  // Tree inspector actions
  toggleTreeInspector: () => void;
  setShowTreeInspector: (show: boolean) => void;
  setTreeInspectorMode: (mode: 'cst' | 'ast' | 'emit' | 'compiled') => void;
  setEmitTabSize: (size: number) => void;
  setSelectedTreeInspectorNodeId: (nodeId: string | undefined) => void;
  openGraphDrawer: (payload: GraphDrawerPayload) => void;
  openActionDrawer: (data: ActionDrawerData) => void;
  closeGraphDrawer: () => void;
  setHighlightedEdgeIds: (ids: Set<string> | null) => void;
}

export type LayoutSlice = LayoutState & LayoutActions;

// Initial state for layout
export const initialLayoutState: LayoutState = {
  showLeftPanel: true,
  showRightPanel: false, // Hide right panel by default (no comments/assistant yet)
  showBottomPanel: true,
  bottomPanelExpanded: false,
  selectedNodeId: undefined,
  selectedCstNodeId: undefined,
  cstDebugExpanded: false,
  bottomPanelTab: 'problems',
  rightPanelTab: 'assistant', // Default to assistant tab
  scriptEditorExpanded: false,
  panelsBeforeExpand: { left: true, right: false, bottom: true },
  // Tree inspector defaults
  showTreeInspector: false,
  treeInspectorMode: 'cst',
  emitTabSize: 4,
  selectedTreeInspectorNodeId: undefined,
  graphDrawerData: null,
  highlightedEdgeIds: null,
};

interface AppState {
  layout: LayoutState;
}

type SetFunction = (updater: (state: AppState) => Partial<AppState>) => void;

// Create layout slice - returns state and actions separately
export const createLayoutSlice = (set: SetFunction) => {
  const state: LayoutState = { ...initialLayoutState };

  const actions: LayoutActions = {
    toggleLeftPanel: () =>
      set((state: AppState) => ({
        layout: { ...state.layout, showLeftPanel: !state.layout.showLeftPanel },
      })),
    toggleRightPanel: () =>
      set((state: AppState) => ({
        layout: {
          ...state.layout,
          showRightPanel: !state.layout.showRightPanel,
        },
      })),
    toggleBottomPanel: () =>
      set((state: AppState) => ({
        layout: {
          ...state.layout,
          showBottomPanel: !state.layout.showBottomPanel,
        },
      })),
    toggleBottomPanelExpanded: () =>
      set((state: AppState) => ({
        layout: {
          ...state.layout,
          bottomPanelExpanded: !state.layout.bottomPanelExpanded,
        },
      })),
    setShowLeftPanel: show =>
      set((state: AppState) => ({
        layout: { ...state.layout, showLeftPanel: show },
      })),
    setShowRightPanel: show =>
      set((state: AppState) => ({
        layout: { ...state.layout, showRightPanel: show },
      })),
    setShowBottomPanel: show =>
      set((state: AppState) => ({
        layout: { ...state.layout, showBottomPanel: show },
      })),
    setSelectedNodeId: nodeId =>
      set((state: AppState) => ({
        layout: { ...state.layout, selectedNodeId: nodeId },
      })),
    setSelectedCstNodeId: nodeId =>
      set((state: AppState) => ({
        layout: { ...state.layout, selectedCstNodeId: nodeId },
      })),
    toggleCstDebugExpanded: () =>
      set((state: AppState) => ({
        layout: {
          ...state.layout,
          cstDebugExpanded: !state.layout.cstDebugExpanded,
        },
      })),
    setCstDebugExpanded: expanded =>
      set((state: AppState) => ({
        layout: { ...state.layout, cstDebugExpanded: expanded },
      })),
    setBottomPanelTab: tab =>
      set((state: AppState) => ({
        layout: { ...state.layout, bottomPanelTab: tab },
      })),
    setRightPanelTab: tab =>
      set((state: AppState) => ({
        layout: { ...state.layout, rightPanelTab: tab },
      })),
    toggleScriptEditorExpand: () =>
      set((state: AppState) => {
        const isCurrentlyExpanded = state.layout.scriptEditorExpanded;

        if (isCurrentlyExpanded) {
          // Collapsing: restore previous panel visibility
          return {
            layout: {
              ...state.layout,
              scriptEditorExpanded: false,
              showLeftPanel: state.layout.panelsBeforeExpand.left,
              showRightPanel: state.layout.panelsBeforeExpand.right,
              showBottomPanel: state.layout.panelsBeforeExpand.bottom,
            },
          };
        } else {
          // Expanding: save current panel states and hide all panels
          return {
            layout: {
              ...state.layout,
              scriptEditorExpanded: true,
              panelsBeforeExpand: {
                left: state.layout.showLeftPanel,
                right: state.layout.showRightPanel,
                bottom: state.layout.showBottomPanel,
              },
              showLeftPanel: false,
              showRightPanel: false,
              showBottomPanel: false,
            },
          };
        }
      }),
    // Tree inspector actions
    toggleTreeInspector: () =>
      set((state: AppState) => ({
        layout: {
          ...state.layout,
          showTreeInspector: !state.layout.showTreeInspector,
        },
      })),
    setShowTreeInspector: show =>
      set((state: AppState) => ({
        layout: { ...state.layout, showTreeInspector: show },
      })),
    setTreeInspectorMode: mode =>
      set((state: AppState) => ({
        layout: { ...state.layout, treeInspectorMode: mode },
      })),
    setEmitTabSize: size =>
      set((state: AppState) => ({
        layout: { ...state.layout, emitTabSize: size },
      })),
    setSelectedTreeInspectorNodeId: nodeId =>
      set((state: AppState) => ({
        layout: { ...state.layout, selectedTreeInspectorNodeId: nodeId },
      })),
    openGraphDrawer: payload =>
      set((state: AppState) => ({
        layout: { ...state.layout, graphDrawerData: payload },
      })),
    openActionDrawer: data =>
      set((state: AppState) => ({
        layout: { ...state.layout, graphDrawerData: { type: 'action', data } },
      })),
    closeGraphDrawer: () =>
      set((state: AppState) => ({
        layout: { ...state.layout, graphDrawerData: null },
      })),
    setHighlightedEdgeIds: ids =>
      set((state: AppState) => ({
        layout: { ...state.layout, highlightedEdgeIds: ids },
      })),
  };

  return { state, actions };
};
