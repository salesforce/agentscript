/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  type DiagnosticsState,
  type DiagnosticsActions,
  createDiagnosticsSlice,
} from './diagnostics';
import {
  type LayoutState,
  type LayoutActions,
  createLayoutSlice,
} from './layout';
import {
  type SourceState,
  type SourceActions,
  createSourceSlice,
} from './source';
import {
  type ThemeState,
  type ThemeActions,
  createThemeSlice,
} from './themeStore';
import {
  type ComponentState,
  type ComponentActions,
  createComponentSlice,
} from './component';

// Define the store state interface
interface AppState {
  // Nested state
  layout: LayoutState;
  diagnostics: DiagnosticsState;
  source: SourceState;
  theme: ThemeState;
  component: ComponentState;
  // Hydration state - tracks when localStorage has been loaded
  _hasHydrated: boolean;
}

// Combine all slices - only include actions, not state (state is nested)
export type StoreState = AppState &
  LayoutActions &
  DiagnosticsActions &
  SourceActions &
  ThemeActions &
  ComponentActions;

// Create the store
export const useAppStore = create<StoreState>()(
  // NOTE: DevTools is commented out by default to avoid performance overhead.
  // Uncomment the devtools() wrapper below to enable Redux DevTools for debugging.
  // The sanitizer will prevent the "excessive memory usage" warning by excluding large objects.
  // devtools(
  persist(
    set => {
      const { state: layoutState, actions: layoutActions } =
        createLayoutSlice(set);
      const { state: diagnosticsState, actions: diagnosticsActions } =
        createDiagnosticsSlice(set);
      const sourceSlice = createSourceSlice(set);
      const themeSlice = createThemeSlice(set);
      const componentSlice = createComponentSlice(set);

      return {
        // Layout state nested under 'layout'
        layout: layoutState,
        // Layout actions at top level
        ...layoutActions,

        // Diagnostics state nested under 'diagnostics'
        diagnostics: diagnosticsState,
        // Diagnostics actions at top level
        ...diagnosticsActions,

        // Source slice (state nested, actions at top level)
        source: {
          agentscript: sourceSlice.agentscript,
          cst: sourceSlice.cst,
          cstInfo: sourceSlice.cstInfo,
          ast: sourceSlice.ast,
          lintStore: sourceSlice.lintStore,
          compileResult: sourceSlice.compileResult,
          monacoEditor: sourceSlice.monacoEditor,
          editorSelection: sourceSlice.editorSelection,
        },
        setAgentScript: sourceSlice.setAgentScript,
        setCst: sourceSlice.setCst,
        setAst: sourceSlice.setAst,
        setLintStore: sourceSlice.setLintStore,
        setSerializedCst: sourceSlice.setSerializedCst,
        setMonacoEditor: sourceSlice.setMonacoEditor,
        setEditorSelection: sourceSlice.setEditorSelection,
        setParseResult: sourceSlice.setParseResult,
        setLspCompileResult: sourceSlice.setLspCompileResult,
        updateCstAndSync: sourceSlice.updateCstAndSync,

        // Theme slice (state nested, actions at top level)
        theme: themeSlice.state,
        setTheme: themeSlice.actions.setTheme,
        setUiTheme: themeSlice.actions.setUiTheme,

        // Component slice (state nested, actions at top level)
        component: componentSlice.state,
        setComponentSource: componentSlice.actions.setComponentSource,
        resetComponentSource: componentSlice.actions.resetComponentSource,

        // Hydration tracking
        _hasHydrated: false,
      };
    },
    {
      name: 'agent-script-store', // localStorage key
      storage: createJSONStorage(() => localStorage),
      // Exclude source and diagnostics from persistence (computed from document)
      partialize: (state: StoreState) => {
        return {
          ...state,
          // Don't persist source state - document content is in agentStore
          source: undefined,
          // Don't persist diagnostics (they're computed from document)
          diagnostics: undefined,
          // Exclude bottomPanelExpanded from layout (session-specific UI state)
          layout: state.layout
            ? {
                ...state.layout,
                bottomPanelExpanded: undefined,
                graphDrawerData: undefined,
                highlightedEdgeIds: undefined,
              }
            : state.layout,
          // Don't persist hydration flag
          _hasHydrated: undefined,
        };
      },
      version: 4, // Bump: removed assistant slice
      migrate: (persistedState: unknown) => {
        const typedState = persistedState as Record<string, unknown>;
        // Clean up any persisted assistant state from prior versions
        if (typedState) {
          delete typedState.assistant;
          delete (typedState as Record<string, unknown> & { dialect?: unknown })
            .dialect;
        }
        return typedState;
      },
      // Track when hydration is complete
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('[Zustand] Rehydration error:', error);
          } else if (state) {
            state._hasHydrated = true;
          }
        };
      },
    }
  )
  // 	{
  // 		name: 'AgentScriptStore',
  // 		enabled: import.meta.env.DEV,
  // 		stateSanitizer: devtoolsSanitizer,
  // 		actionSanitizer: (action) => action,
  // 	},
  // ),
);

// Selector hook to check if store has hydrated from localStorage
export const useHasHydrated = () => useAppStore(state => state._hasHydrated);
