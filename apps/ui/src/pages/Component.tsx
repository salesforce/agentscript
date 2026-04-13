/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Component page — parseComponent() playground.
 *
 * Left: Monaco editor (agentscript language, agentforce dialect) + kind selector.
 * Right: CST / AST / Emit debug tabs showing the parsed component output.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import * as monaco from 'monaco-editor';
import { registerAgentScriptLanguage } from '@agentscript/monaco';
import { AgentScriptSchema } from '@agentscript/agentscript-dialect';
import {
  parseComponentDebug,
  getComponentKindOptions,
} from '@agentscript/agentforce';
import type { SerializedCSTNode } from '@agentscript/agentforce';
import {
  cstToDebugTree,
  convertCstToTreeViewNode,
} from '~/components/cst-debug/cstToDebugTree';
import { useCursorSync } from '~/hooks/useCursorSync';
import { cstToSExpr } from '~/lib/cst-to-sexpr';
import { TreeView } from '~/components/explorer/TreeView';
import { ObjectInspector } from '~/components/inspector/ObjectInspector';
import { PanelHeader } from '~/components/panels/PanelHeader';
import { cn, copyToClipboard } from '~/lib/utils';
import { useAppStore } from '~/store';
import { VscCopy, VscDiscard } from 'react-icons/vsc';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '~/components/ui/resizable';

// ---------------------------------------------------------------------------
// Component kind options (from @agentscript/agentforce package)
// ---------------------------------------------------------------------------

const KIND_OPTIONS = getComponentKindOptions();

const DEFAULT_SOURCES: Record<string, string> = {
  actions: `Lookup_Order:\n    description: "Retrieve order details"\n    target: "flow://Lookup_Order"\nCheck_Hours:\n    description: "Check business hours"\n    target: "flow://Check_Hours"`,
  reasoning_actions: `lookup_order: @actions.Lookup_Order\n    with order_number=...\n    set @variables.status = @outputs.status`,
  topic: `topic Example:\n    description: "An example topic"\n    reasoning:\n        instructions: ->\n            | Help the user.`,
  start_agent: `start_agent Selector:\n    description: "Entry point"\n    reasoning:\n        instructions: ->\n            | Welcome the user.`,
  connection: `connection messaging:\n    adaptive_response_allowed: True`,
  related_agent: `related_agent helper:\n    description: "A helper agent"`,
  config: `description: "My agent"\nagent_type: "AgentforceServiceAgent"`,
  system: `instructions: "Be helpful."`,
  variables: `customer_name: mutable string = ""\n    description: "Customer name"`,
  knowledge: `citations_enabled: True`,
  language: `default_locale: "en_US"`,
  security: `sharing_policy:\n    use_default_sharing_entities: True`,
  modality: `modality voice:\n    config:\n        voice_id: "EQx6HGDYjkDpcli6vorJ"\n        outbound_speed: 1.0\n        outbound_stability: 0.5\n        outbound_similarity: 0.75\n        outbound_filler_sentences:\n            - "Let me look into it..."\n            - "Give me a moment..."`,
};

// ---------------------------------------------------------------------------
// Debug tab types
// ---------------------------------------------------------------------------

type DebugTab = 'cst' | 'ast' | 'emit' | 'code';

// ---------------------------------------------------------------------------
// Component page
// ---------------------------------------------------------------------------

function CopyButton({
  visible,
  onClick,
  title,
}: {
  visible: boolean;
  onClick: () => void;
  title: string;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#454646]"
      title={title}
      aria-label={title}
    >
      <VscCopy className="h-3.5 w-3.5 text-gray-600 dark:text-[#cbcbcb]" />
    </button>
  );
}

export function Component() {
  const { kind: kindParam, agentId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Derive kind from URL param, default to 'actions'
  const validKinds = KIND_OPTIONS.map(o => o.value);
  const selectedKind =
    kindParam && validKinds.includes(kindParam) ? kindParam : 'actions';

  // Derive debug tab from ?debug= query param (default: cst = no param)
  const debugParam = searchParams.get('debug');
  const debugTab: DebugTab =
    debugParam === 'cst' ||
    debugParam === 'ast' ||
    debugParam === 'emit' ||
    debugParam === 'code'
      ? debugParam
      : 'cst';

  // Navigate to set debug tab via URL (cst = default, omit param)
  const setDebugTab = useCallback(
    (tab: DebugTab) => {
      const basePath = agentId
        ? `/agents/${agentId}/component`
        : '/agents/component';
      const qs = tab !== 'cst' ? `?debug=${tab}` : '';
      void navigate(`${basePath}/${selectedKind}${qs}`);
    },
    [agentId, navigate, selectedKind]
  );

  // Redirect to canonical URL if kind param is missing/invalid
  useEffect(() => {
    const basePath = agentId
      ? `/agents/${agentId}/component`
      : '/agents/component';
    if (!kindParam || !validKinds.includes(kindParam)) {
      void navigate(
        `${basePath}/${selectedKind}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`,
        { replace: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindParam]);

  // Persisted sources per kind from Zustand store
  const componentSources = useAppStore(
    state => state.component.componentSources
  );
  const resetComponentSource = useAppStore(state => state.resetComponentSource);

  // Current source: persisted value or default
  const source =
    componentSources[selectedKind] ?? DEFAULT_SOURCES[selectedKind] ?? '';

  const [parsedComponent, setParsedComponent] = useState<unknown>(undefined);
  const [cstRoot, setCstRoot] = useState<SerializedCSTNode | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const setDiagnostics = useAppStore(state => state.setDiagnostics);

  // Save/restore main script diagnostics when entering/leaving Component page
  const savedDiagnosticsRef = useRef(
    useAppStore.getState().diagnostics.diagnostics
  );
  useEffect(() => {
    savedDiagnosticsRef.current =
      useAppStore.getState().diagnostics.diagnostics;
    return () => {
      // Restore the main script's diagnostics on unmount
      setDiagnostics(savedDiagnosticsRef.current);
    };
  }, [setDiagnostics]);

  const theme = useAppStore(state => state.theme.theme);
  const actualTheme = useMemo(() => {
    if (theme === 'system') {
      return typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return theme;
  }, [theme]);

  // -- Cursor position tracking (0-based, in editor coordinates) --
  const [cursorPosition, setCursorPosition] = useState<{
    line: number;
    column: number;
  } | null>(null);
  const [selectedCstNodeId, setSelectedCstNodeId] = useState<
    string | undefined
  >();
  const isNavigatingFromInspector = useRef(false);

  // -- Left side: Monaco editor --
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const selectedKindRef = useRef(selectedKind);
  selectedKindRef.current = selectedKind;
  const [languageInitialized, setLanguageInitialized] = useState(false);

  // Initialize language (themes, tokenization) + agentforce parser
  useEffect(() => {
    const setup = async () => {
      try {
        await registerAgentScriptLanguage({
          schema: AgentScriptSchema as Record<string, unknown>,
        });
      } catch (error) {
        console.error('[Component] Failed to initialize:', error);
      }
      setLanguageInitialized(true);
    };
    void setup();
  }, []);

  // Create Monaco editor after language is ready
  useEffect(() => {
    if (!editorContainerRef.current || !languageInitialized) return;

    const themeName =
      actualTheme === 'dark' ? 'agentscript-dark' : 'agentscript-light';

    const editor = monaco.editor.create(editorContainerRef.current, {
      value: source,
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

    editorRef.current = editor;

    // Sync editor changes to persisted store
    editor.onDidChangeModelContent(() => {
      const value = editor.getValue();
      useAppStore.getState().setComponentSource(selectedKindRef.current, value);
    });

    // Track cursor position for CST/AST sync
    editor.onDidChangeCursorSelection(e => {
      if (isNavigatingFromInspector.current) {
        isNavigatingFromInspector.current = false;
        return;
      }
      setCursorPosition({
        line: e.selection.endLineNumber - 1,
        column: e.selection.endColumn - 1,
      });
    });

    // Track cursor position for CST/AST sync
    editor.onDidChangeCursorSelection(e => {
      if (isNavigatingFromInspector.current) {
        isNavigatingFromInspector.current = false;
        return;
      }
      setCursorPosition({
        line: e.selection.endLineNumber - 1,
        column: e.selection.endColumn - 1,
      });
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageInitialized]);

  // Update editor theme when it changes
  useEffect(() => {
    if (editorRef.current) {
      const themeName =
        actualTheme === 'dark' ? 'agentscript-dark' : 'agentscript-light';
      editorRef.current.updateOptions({
        theme: themeName,
      } as monaco.editor.IEditorOptions);
      monaco.editor.setTheme(themeName);
    }
  }, [actualTheme]);

  // When kind changes, navigate to new URL and update editor
  const handleKindChange = useCallback(
    (kind: string) => {
      const basePath = agentId
        ? `/agents/${agentId}/component`
        : '/agents/component';
      const debugStr = searchParams.get('debug');
      const qs = debugStr && debugStr !== 'cst' ? `?debug=${debugStr}` : '';
      void navigate(`${basePath}/${kind}${qs}`);
    },
    [agentId, navigate, searchParams]
  );

  // Reset confirmation dialog
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const handleReset = useCallback(() => {
    resetComponentSource(selectedKind);
    setResetDialogOpen(false);
  }, [resetComponentSource, selectedKind]);

  // Whether the source has been modified from default
  const isModified = selectedKind in componentSources;

  // Sync editor content when source changes (e.g. kind change via URL, reset)
  useEffect(() => {
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== source) {
        model.setValue(source);
      }
    }
  }, [source]);

  // -- Parsing logic --
  const parseTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const doParse = useCallback(() => {
    if (!languageInitialized) return;

    setParseError(null);

    try {
      const result = parseComponentDebug(source, selectedKind);
      setCstRoot(result.cst);
      setParsedComponent(result.component ?? undefined);
      setDiagnostics(result.diagnostics);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      setCstRoot(null);
      setParsedComponent(undefined);
      setDiagnostics([]);
    }
  }, [source, selectedKind, languageInitialized, setDiagnostics]);

  // Auto-parse with debounce
  useEffect(() => {
    clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      void doParse();
    }, 250);
    return () => clearTimeout(parseTimerRef.current);
  }, [doParse]);

  // -- Right side: CST tree data --
  const cstTreeData = useMemo(() => {
    if (!cstRoot) return [];
    return cstToDebugTree(cstRoot);
  }, [cstRoot]);

  const cstTreeViewData = useMemo(() => {
    return cstTreeData.map(node => convertCstToTreeViewNode(node));
  }, [cstTreeData]);

  // -- Cursor ↔ CST/AST sync (shared hook) --
  const navigateEditor = useCallback(
    (pos: { line: number; character: number }) => {
      const editor = editorRef.current;
      if (!editor) return;

      isNavigatingFromInspector.current = true;

      const lineNumber = pos.line + 1;
      const column = pos.character + 1;

      editor.setPosition({ lineNumber, column });
      editor.revealPositionInCenter({ lineNumber, column });
      editor.focus();
    },
    []
  );

  const {
    selectedCstNodeAtCursor,
    astHighlightPath,
    expandedKeys,
    navigateToCstNode,
    navigateToRange,
  } = useCursorSync({
    cursorPosition,
    mode: debugTab,
    cstTreeData,
    ast: parsedComponent,
    astRootName: 'Component',
    navigateEditor,
  });

  // Cursor-derived CST node takes priority; fall back to last-clicked node
  const effectiveCstNodeId =
    debugTab === 'cst' && selectedCstNodeAtCursor
      ? selectedCstNodeAtCursor
      : selectedCstNodeId;

  // CST node click → navigate editor cursor
  const handleCstNodeSelect = useCallback(
    (_kind: string, id: string) => {
      setSelectedCstNodeId(id);
      navigateToCstNode(id);
    },
    [navigateToCstNode]
  );

  // AST node click → navigate editor cursor
  const handleInspectorNavigate = useCallback(
    (range: { start: { line: number; character: number } }) => {
      navigateToRange(range);
    },
    [navigateToRange]
  );

  // -- Right side: Emit text --
  const emittedText = useMemo(() => {
    if (parsedComponent == null) return '';
    try {
      const obj = parsedComponent as Record<string, unknown>;
      if (typeof obj.__emit === 'function') {
        return (
          obj.__emit as (ctx: { indent: number; tabSize: number }) => string
        )({ indent: 0, tabSize: 4 });
      }
      return JSON.stringify(
        parsedComponent,
        (k, v) =>
          k === '__cst' || k === 'parent' ? undefined : (v as unknown),
        2
      );
    } catch {
      return '// Could not emit';
    }
  }, [parsedComponent]);

  // -- Right side: Code example text --
  const codeExampleText = useMemo(() => {
    // Escape backticks and backslashes for template literal
    const escaped = source
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
    return `import { parseComponent } from '@agentscript/agentforce';

const result = parseComponent(\`${escaped}\`, '${selectedKind}');`;
  }, [source, selectedKind]);

  // -- Copy handlers --
  const handleCopyCst = useCallback(() => {
    if (!cstRoot) return;
    const sexpr = cstToSExpr(cstRoot);
    copyToClipboard(sexpr, 'CST copied to clipboard');
  }, [cstRoot]);

  const handleCopyAst = useCallback(() => {
    if (parsedComponent == null) return;
    const json = JSON.stringify(
      parsedComponent,
      (key, value: unknown) =>
        key === '__cst' || key === 'parent' ? undefined : value,
      2
    );
    copyToClipboard(json, 'AST copied to clipboard');
  }, [parsedComponent]);

  const handleCopyEmit = useCallback(() => {
    if (!emittedText) return;
    copyToClipboard(emittedText, 'Emitted text copied to clipboard');
  }, [emittedText]);

  const handleCopyCode = useCallback(() => {
    if (!codeExampleText) return;
    copyToClipboard(codeExampleText, 'Code copied to clipboard');
  }, [codeExampleText]);

  // -- Right side: Emit Monaco editor --
  const emitEditorContainerRef = useRef<HTMLDivElement>(null);
  const emitEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );

  useEffect(() => {
    if (debugTab !== 'emit' || !emitEditorContainerRef.current) {
      if (emitEditorRef.current) {
        emitEditorRef.current.dispose();
        emitEditorRef.current = null;
      }
      return;
    }

    const themeName =
      actualTheme === 'dark' ? 'agentscript-dark' : 'agentscript-light';

    const editor = monaco.editor.create(emitEditorContainerRef.current, {
      value: emittedText,
      language: 'agentscript',
      theme: themeName,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      'semanticHighlighting.enabled': true,
      renderLineHighlight: 'none',
      cursorStyle: 'line-thin',
    });

    emitEditorRef.current = editor;
    requestAnimationFrame(() => editor.layout());

    return () => {
      editor.dispose();
      emitEditorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugTab, actualTheme]);

  // Update emit editor content
  useEffect(() => {
    if (emitEditorRef.current && debugTab === 'emit') {
      const model = emitEditorRef.current.getModel();
      if (model && model.getValue() !== emittedText) {
        model.setValue(emittedText);
      }
    }
  }, [emittedText, debugTab]);

  // -- Right side: Code example Monaco editor --
  const codeEditorContainerRef = useRef<HTMLDivElement>(null);
  const codeEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );

  useEffect(() => {
    if (debugTab !== 'code' || !codeEditorContainerRef.current) {
      if (codeEditorRef.current) {
        codeEditorRef.current.dispose();
        codeEditorRef.current = null;
      }
      return;
    }

    const themeName = actualTheme === 'dark' ? 'vs-dark' : 'vs';

    const editor = monaco.editor.create(codeEditorContainerRef.current, {
      value: codeExampleText,
      language: 'typescript',
      theme: themeName,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: 'none',
      cursorStyle: 'line-thin',
    });

    codeEditorRef.current = editor;
    requestAnimationFrame(() => editor.layout());

    return () => {
      editor.dispose();
      codeEditorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugTab, actualTheme]);

  // Update code editor content
  useEffect(() => {
    if (codeEditorRef.current && debugTab === 'code') {
      const model = codeEditorRef.current.getModel();
      if (model && model.getValue() !== codeExampleText) {
        model.setValue(codeExampleText);
      }
    }
  }, [codeExampleText, debugTab]);

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-[#2b2b2b] dark:bg-[#121314]">
      <PanelHeader title="Parse Component" />
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="component-playground-layout"
        >
          {/* Left: Editor + kind selector */}
          <ResizablePanel
            id="component-editor"
            order={1}
            defaultSize={50}
            minSize={30}
          >
            <div className="flex h-full flex-col">
              {/* Kind selector bar */}
              <div className="flex justify-between border-b border-gray-200 px-3 dark:border-[#2b2b2b]">
                <div className="flex flex-1 items-center gap-2 py-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[#606060] dark:text-[#848484]">
                    Kind:
                  </label>
                  <select
                    value={selectedKind}
                    onChange={e => handleKindChange(e.target.value)}
                    className="h-6 rounded border border-gray-300 bg-white px-1.5 text-xs text-gray-700 outline-none dark:border-[#2f3031] dark:bg-[#272728] dark:text-[#ccc]"
                  >
                    {KIND_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-none items-center gap-2">
                  {parseError && (
                    <span
                      className="truncate text-[10px] text-red-500"
                      title={parseError}
                    >
                      {parseError.slice(0, 50)}
                    </span>
                  )}
                  {isModified && (
                    <div className="flex flex-none">
                      <button
                        type="button"
                        onClick={() => setResetDialogOpen(true)}
                        className="inline-block items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#454646] p-0.5"
                        title="Reset to default"
                        aria-label="Reset to default"
                      >
                        <VscDiscard className="text-gray-600 dark:text-[#cbcbcb] h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {/* Monaco editor */}
              <div ref={editorContainerRef} className="min-h-0 flex-1" />
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right: Debug output */}
          <ResizablePanel
            id="component-output"
            order={2}
            defaultSize={50}
            minSize={20}
          >
            <div className="flex h-full flex-col overflow-hidden">
              {/* Debug tab header */}
              <div className="flex h-9 flex-none items-center gap-3 border-b border-[#f1f1f2] bg-[#fafafd] px-3 dark:border-[#2b2b2b] dark:bg-[#191a1b]">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#606060] dark:font-normal dark:text-[#bebebe]">
                  Output:
                </span>
                {(['cst', 'ast', 'emit', 'code'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setDebugTab(tab)}
                    className={cn(
                      'text-xs font-semibold uppercase tracking-wider transition-colors dark:font-normal',
                      debugTab === tab
                        ? 'text-blue-600 dark:text-[#3a94bd]'
                        : 'text-[#606060] hover:text-[#606060] dark:text-[#bebebe] dark:hover:text-[#bebebe]'
                    )}
                  >
                    {tab}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1">
                  <CopyButton
                    visible={debugTab === 'cst' && !!cstRoot}
                    onClick={handleCopyCst}
                    title="Copy CST as S-expression"
                  />
                  <CopyButton
                    visible={debugTab === 'ast' && parsedComponent != null}
                    onClick={handleCopyAst}
                    title="Copy AST as JSON"
                  />
                  <CopyButton
                    visible={debugTab === 'emit' && !!emittedText}
                    onClick={handleCopyEmit}
                    title="Copy emitted source"
                  />
                  <CopyButton
                    visible={debugTab === 'code' && !!codeExampleText}
                    onClick={handleCopyCode}
                    title="Copy code example"
                  />
                </div>
              </div>

              {/* Debug content */}
              <div
                className={cn(
                  'min-h-0 flex-1',
                  debugTab === 'emit' || debugTab === 'code'
                    ? 'overflow-hidden'
                    : 'overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                )}
              >
                {debugTab === 'cst' ? (
                  cstTreeViewData.length > 0 ? (
                    <TreeView
                      data={cstTreeViewData}
                      selectedNodeId={effectiveCstNodeId}
                      onNodeSelect={handleCstNodeSelect}
                      expandedKeys={expandedKeys}
                    />
                  ) : (
                    <EmptyState text="No CST available" />
                  )
                ) : debugTab === 'ast' ? (
                  parsedComponent != null ? (
                    <ObjectInspector
                      data={parsedComponent}
                      name="Component"
                      expandLevel={2}
                      highlightPath={astHighlightPath}
                      onNavigate={handleInspectorNavigate}
                    />
                  ) : (
                    <EmptyState
                      text={parseError ? 'Parse failed' : 'No result'}
                    />
                  )
                ) : debugTab === 'emit' ? (
                  <div ref={emitEditorContainerRef} className="h-full w-full" />
                ) : debugTab === 'code' ? (
                  <div ref={codeEditorContainerRef} className="h-full w-full" />
                ) : null}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset to default</DialogTitle>
            <DialogDescription>
              This will discard your changes and restore the default script for{' '}
              <strong>{selectedKind}</strong>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setResetDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleReset}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-[#848484]">
      {text}
    </div>
  );
}
