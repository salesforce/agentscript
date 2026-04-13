/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AgentScriptAST } from '../lib/parser';
import type { PassStore } from '@agentscript/language';
import type { CompileResult } from '@agentscript/compiler';
import type { DiagnosticsState } from './diagnostics';

// Serializable node structure
export interface SerializedNode {
  type: string;
  isNamed: boolean;
  text?: string; // Only for leaf nodes or small nodes
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  children?: SerializedNode[];
  fieldName?: string | null;
  hasError: boolean;
  isMissing: boolean;
}

// Serializable CST info for debugging
export interface CstInfo {
  rootType: string;
  childCount: number;
  language: string | null;
  hasError: boolean;
  nodeCount: number;
  tree: SerializedNode; // Full serialized tree structure
}

// Source state slice
export interface EditorSelection {
  // Monaco selection (1-based for display)
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  // Convenience getters for cursor position (0-based)
  positionRow: number; // endLineNumber - 1
  positionColumn: number; // endColumn - 1
}

export interface SourceState {
  agentscript: string;
  cst: SerializedNode | null; // CST from parsed agentscript
  cstInfo: CstInfo | null; // Serializable info about the CST (for DevTools debugging)
  ast: AgentScriptAST | null; // Typed AST from dialect parser (not persisted)
  lintStore: PassStore | null; // Lint analysis data (symbol table, type map) — reused by Monaco providers
  compileResult: CompileResult | null; // Compiler output (not persisted) — shared between diagnostics and TreeInspectorPanel
  monacoEditor: unknown | null; // Monaco editor instance (not persisted)
  editorSelection: EditorSelection | null; // Monaco selection with cursor position (not persisted)
}

/** Batched result from a parse+lint cycle (AST/EMIT debug panels only). */
export interface ParseResult {
  cst: SerializedNode | null;
  ast: AgentScriptAST | null;
  lintStore: PassStore | null;
}

export interface SourceActions {
  setAgentScript: (script: string) => void;
  setCst: (cst: SerializedNode | null) => void;
  setAst: (ast: AgentScriptAST | null) => void;
  setLintStore: (store: PassStore | null) => void;
  setSerializedCst: (serializedCst: SerializedNode | null) => void;
  setMonacoEditor: (editor: unknown | null) => void;
  setEditorSelection: (selection: EditorSelection | null) => void;
  /** Atomically update all parse results in a single store update. */
  setParseResult: (result: ParseResult) => void;
  /** Update compile output from LSP (does not touch CST, AST, or diagnostics). */
  setLspCompileResult: (compileOutput: unknown) => void;
  updateCstAndSync: (mutatorFn: (cst: SerializedNode) => string) => void;
}

export type SourceSlice = SourceState & SourceActions;

// Initial state for source
export const initialSourceState: SourceState = {
  agentscript: '',
  cst: null,
  cstInfo: null,
  ast: null,
  lintStore: null,
  compileResult: null,
  monacoEditor: null,
  editorSelection: null,
};

interface AppState {
  source: SourceState;
  diagnostics: DiagnosticsState;
}

type SetFunction = (updater: (state: AppState) => Partial<AppState>) => void;

// Create source slice
export const createSourceSlice = (set: SetFunction): SourceSlice => ({
  ...initialSourceState,

  // Actions
  setAgentScript: (script: string) =>
    set((state: AppState) => ({
      source: { ...state.source, agentscript: script },
    })),
  setCst: (cst: SerializedNode | null) =>
    set((state: AppState) => ({
      source: {
        ...state.source,
        cst,
        cstInfo: cst
          ? {
              rootType: cst.type,
              childCount: cst.children?.length || 0,
              language: 'agentscript',
              hasError: cst.hasError,
              nodeCount: 0,
              tree: cst,
            }
          : null,
      },
    })),
  setAst: (ast: AgentScriptAST | null) =>
    set((state: AppState) => ({
      source: {
        ...state.source,
        ast,
        lintStore: ast ? state.source.lintStore : null,
      },
    })),
  setLintStore: (lintStore: PassStore | null) =>
    set((state: AppState) => ({
      source: { ...state.source, lintStore },
    })),
  setSerializedCst: (serializedCst: SerializedNode | null) =>
    set((state: AppState) => ({
      source: {
        ...state.source,
        cst: serializedCst,
        cstInfo: serializedCst
          ? {
              rootType: serializedCst.type,
              childCount: serializedCst.children?.length || 0,
              language: 'agentscript',
              hasError: serializedCst.hasError,
              nodeCount: 0,
              tree: serializedCst,
            }
          : null,
      },
    })),
  setMonacoEditor: (editor: unknown | null) =>
    set((state: AppState) => ({
      source: { ...state.source, monacoEditor: editor },
    })),
  setEditorSelection: (selection: EditorSelection | null) =>
    set((state: AppState) => ({
      source: { ...state.source, editorSelection: selection },
    })),

  setParseResult: (result: ParseResult) =>
    set((state: AppState) => ({
      source: {
        ...state.source,
        cst: result.cst,
        cstInfo: result.cst
          ? {
              rootType: result.cst.type,
              childCount: result.cst.children?.length || 0,
              language: 'agentscript',
              hasError: result.cst.hasError,
              nodeCount: 0,
              tree: result.cst,
            }
          : null,
        ast: result.ast,
        lintStore: result.lintStore,
      },
    })),

  setLspCompileResult: (compileOutput: unknown) =>
    set((state: AppState) => ({
      source: {
        ...state.source,
        compileResult: (compileOutput as CompileResult | null) ?? null,
      },
    })),

  /**
   * Update CST by applying a mutator function that returns new AgentScript text
   * The mutator receives the current CST and returns modified text
   * This triggers the normal parse flow: text update -> Monaco update -> re-parse -> new CST
   */
  updateCstAndSync: (mutatorFn: (cst: SerializedNode) => string) =>
    set((state: AppState) => {
      const currentCst = state.source.cst;
      if (!currentCst) {
        console.warn('[updateCstAndSync] No CST available to mutate');
        return state;
      }

      try {
        // Apply the mutator to get new text
        const newText = mutatorFn(currentCst);

        // Update the agentscript - this will trigger Monaco update and re-parse
        return {
          source: { ...state.source, agentscript: newText },
        };
      } catch (error) {
        console.error('[updateCstAndSync] Error applying mutator:', error);
        return state;
      }
    }),
});
