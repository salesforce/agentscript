/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js';
import { IConfigurationService } from 'monaco-editor/esm/vs/platform/configuration/common/configuration.js';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { registerAgentScriptLanguage } from '~/lib/monaco-language';
import { cn } from '~/lib/utils';
import { useAppStore } from '~/store';
import { useAgentStore } from '~/store/agentStore';
import { useDebounceCallback } from 'usehooks-ts';
import type { EditorSelection } from '~/store/source';
import { useMonacoEditor } from '~/contexts/MonacoEditorContext';
import { createDiffHandler } from '~/lib/monaco-diff-handler';
import { registerMonacoLspProviders } from '~/lib/monaco-lsp-providers';
import { AgentScriptLspClient } from '~/lib/lsp-client';
import lspWorkerUrl from '~/workers/agentscript-lsp.worker?worker&url';
import { useParams } from 'react-router';

// Setup Monaco workers
// Note: Monaco types already define MonacoEnvironment on Window via monaco.Environment

if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      return new editorWorker();
    },
  };
}

interface MonacoEditorProps {
  theme?: 'light' | 'dark';
  className?: string;
  agentId?: string;
  initialSelection?: EditorSelection;
}

export function MonacoEditor({
  theme = 'light',
  className,
  agentId,
  initialSelection,
}: MonacoEditorProps) {
  const [editor, setEditorState] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { setEditor, setLspClient, setSyncLspModel, setCloseLspDocument } =
    useMonacoEditor();
  const setMonacoEditor = useAppStore(state => state.setMonacoEditor);
  const setEditorSelection = useAppStore(state => state.setEditorSelection);
  const updateAgentSelection = useAgentStore(
    state => state.updateAgentSelection
  );
  const isNavigatingFromExplorer = useRef(false);
  const agentIdRef = useRef(agentId);
  const setAgentScript = useAppStore(state => state.setAgentScript);
  const agentscript = useAppStore(state => state.source.agentscript);
  const updateAgentContent = useAgentStore(state => state.updateAgentContent);
  const { agentId: routeAgentId } = useParams();
  const currentAgentId = agentId || routeAgentId;
  const lspClientRef = useRef<AgentScriptLspClient | null>(null);
  const lspRegistrationRef = useRef<ReturnType<
    typeof registerMonacoLspProviders
  > | null>(null);

  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  // Debounced save to localStorage
  const debouncedSaveContent = useDebounceCallback((content: string) => {
    if (currentAgentId) {
      updateAgentContent(currentAgentId, content);
    }
  }, 1000);

  // Debounced save selection to agentStore
  const debouncedSaveSelection = useDebounceCallback(
    (selection: EditorSelection) => {
      if (agentIdRef.current) {
        updateAgentSelection(agentIdRef.current, selection);
      }
    },
    500
  );

  // Track whether language initialization has been attempted
  const [languageInitialized, setLanguageInitialized] = useState(false);

  // Initialize language (semantic tokens come from LSP)
  useEffect(() => {
    try {
      registerAgentScriptLanguage();
      setLanguageInitialized(true);
    } catch (error) {
      console.error(
        '[MonacoEditor] Failed to initialize AgentScript language:',
        error
      );
      // Mark as initialized even if it fails so editor can still load
      setLanguageInitialized(true);
    }
  }, []);

  // Create editor
  // Editor is created after language initialization is attempted, even if parser failed
  // This ensures the editor shows content even when the parser fails to initialize
  useEffect(() => {
    if (!containerRef.current || !languageInitialized) return;

    const themeName =
      theme === 'dark' ? 'agentscript-dark' : 'agentscript-light';

    // Sort marker navigation by position so "View Problem" navigates to the
    // marker under the cursor instead of jumping to a higher-severity marker.
    try {
      const configService = StandaloneServices.get(IConfigurationService);
      configService.updateValue('problems.sortOrder', 'position');
    } catch {
      // ignore — fails gracefully in non-standalone environments
    }

    const editorInstance = monaco.editor.create(containerRef.current, {
      value: agentscript || '', // Initialize with current content
      language: 'agentscript',
      theme: themeName,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      'semanticHighlighting.enabled': true,
      cursorSurroundingLines: 0,
      cursorSurroundingLinesStyle: 'default',
      fixedOverflowWidgets: true,
      wordBasedSuggestions: 'off',
      quickSuggestions: true,
    });

    const lspWorker = new Worker(lspWorkerUrl, { type: 'module' });
    const lspClient = new AgentScriptLspClient(lspWorker);
    const lspRegistration = registerMonacoLspProviders(lspClient);
    lspClientRef.current = lspClient;
    lspRegistrationRef.current = lspRegistration;
    setLspClient(lspClient);
    setSyncLspModel(() => lspRegistration.sync);
    setCloseLspDocument(() => (uri: string) => lspClient.closeDocument(uri));

    void lspClient.initialize().then(async () => {
      const model = editorInstance.getModel();
      if (!model) return;
      await lspRegistration.sync(model, true);
      // After LSP is ready and document is synced, tell Monaco to re-fetch
      // semantic tokens. The initial request may have timed out during init.
      lspRegistration.refreshSemanticTokens();
    });

    // Listen to content changes for parsing and saving
    editorInstance.onDidChangeModelContent(() => {
      const newValue = editorInstance.getValue();
      // Update Zustand for parsing/AST generation
      setAgentScript(newValue);
      // Debounced save to localStorage
      debouncedSaveContent(newValue);
      const model = editorInstance.getModel();
      if (model && lspRegistrationRef.current) {
        void lspRegistrationRef.current.sync(model);
      }
    });

    // Listen to selection changes (includes cursor position)
    editorInstance.onDidChangeCursorSelection(e => {
      // Skip if navigation was triggered by explorer click
      if (isNavigatingFromExplorer.current) {
        isNavigatingFromExplorer.current = false;
        return;
      }
      // Emit selection to Zustand (Monaco uses 1-based)
      const selection: EditorSelection = {
        startLineNumber: e.selection.startLineNumber,
        startColumn: e.selection.startColumn,
        endLineNumber: e.selection.endLineNumber,
        endColumn: e.selection.endColumn,
        // Pre-computed 0-based position for CST lookups
        positionRow: e.selection.endLineNumber - 1,
        positionColumn: e.selection.endColumn - 1,
      };
      setEditorSelection(selection);
      // Debounce-save to agentStore
      debouncedSaveSelection(selection);
    });

    setEditorState(editorInstance);
    setEditor(editorInstance); // Register with context for diagnostics panel

    // Add custom property to signal navigation from explorer
    (
      editorInstance as monaco.editor.IStandaloneCodeEditor & {
        __setNavigatingFromExplorer?: () => void;
      }
    ).__setNavigatingFromExplorer = () => {
      isNavigatingFromExplorer.current = true;
    };

    setMonacoEditor(editorInstance); // Store in global state for navigation

    // Create diff handler for inline decorations
    const diffHandler = createDiffHandler(
      editorInstance,
      containerRef.current,
      () => {},
      () => {}
    );

    // Cleanup
    return () => {
      const model = editorInstance.getModel();
      if (model && lspClientRef.current) {
        lspClientRef.current.closeDocument(model.uri.toString());
      }
      lspRegistration.dispose();
      lspClient.dispose();
      lspClientRef.current = null;
      lspRegistrationRef.current = null;
      setLspClient(null);
      diffHandler.dispose();
      editorInstance.dispose();
      setEditor(null);
      setSyncLspModel(() => async () => {});
      setCloseLspDocument(() => () => {});
      setMonacoEditor(null);
      setEditorSelection(null);
    };
    // Only recreate editor when language is initialized or container changes
    // Note: we use languageInitialized instead of parser so editor works even when parser fails
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    languageInitialized,
    setMonacoEditor,
    setEditorSelection,
    setAgentScript,
    setSyncLspModel,
    setCloseLspDocument,
  ]);

  // Update theme
  useEffect(() => {
    if (editor) {
      const themeName =
        theme === 'dark' ? 'agentscript-dark' : 'agentscript-light';
      monaco.editor.setTheme(themeName);
    }
  }, [theme, editor]);

  // Sync agentscript changes from store to editor
  useEffect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const currentValue = model.getValue();
    if (currentValue !== agentscript) {
      model.setValue(agentscript || '');
    }
  }, [editor, agentscript]);

  // Restore selection when editor is ready or initialSelection changes
  useEffect(() => {
    if (!editor || !initialSelection) return;

    // Set the flag to prevent feedback loop
    isNavigatingFromExplorer.current = true;

    // Restore the selection
    const selection = new monaco.Selection(
      initialSelection.startLineNumber,
      initialSelection.startColumn,
      initialSelection.endLineNumber,
      initialSelection.endColumn
    );
    editor.setSelection(selection);
    editor.revealPositionInCenter({
      lineNumber: initialSelection.endLineNumber,
      column: initialSelection.endColumn,
    });

    // Also update Zustand for immediate display in footer
    setEditorSelection(initialSelection);
  }, [editor, initialSelection, setEditorSelection]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className={cn('h-full w-full', className)} />
    </div>
  );
}
