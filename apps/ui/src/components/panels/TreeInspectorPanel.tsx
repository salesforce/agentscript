/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useMemo, useEffect, useCallback, useRef } from 'react';
import * as monaco from 'monaco-editor';
import {
  cstToDebugTree,
  convertCstToTreeViewNode,
} from '~/components/cst-debug/cstToDebugTree';
import { useCursorSync } from '~/hooks/useCursorSync';
import { TreeView } from '~/components/explorer/TreeView';
import { ObjectInspector } from '~/components/inspector/ObjectInspector';
import { cstToSExpr } from '~/lib/cst-to-sexpr';
import { getDialectSchema } from '~/lib/parser';
import { detectDialectId } from '~/lib/detect-dialect';
import { cn, copyToClipboard } from '~/lib/utils';
import { useAppStore } from '~/store';
import { useMonacoEditor } from '~/contexts/MonacoEditorContext';
import { X, Copy } from 'lucide-react';
import { emitDocument } from '@agentscript/language';
import { findGeneratedPosition, buildCursorMap } from '@agentscript/compiler';
import type { SourceMapping, CursorMap } from '@agentscript/compiler';

// ---------------------------------------------------------------------------
// Source→emit cursor sync: match non-blank trimmed lines between source
// and emit texts. Both contain the same content in the same order, just
// with different blank-line spacing. No AST or __cst dependency.
// ---------------------------------------------------------------------------

function buildEmitMappings(
  sourceText: string,
  emittedText: string
): SourceMapping[] {
  const mappings: SourceMapping[] = [];
  const sourceLines = sourceText.split('\n');
  const emitLines = emittedText.split('\n');

  // Build list of non-blank lines in emit with their trimmed content
  const emitEntries: { trimmed: string; line: number }[] = [];
  for (let i = 0; i < emitLines.length; i++) {
    const t = emitLines[i].trim();
    if (t) emitEntries.push({ trimmed: t, line: i });
  }

  // Walk source lines, match each non-blank line to the next emit entry
  let emitIdx = 0;
  for (let srcLine = 0; srcLine < sourceLines.length; srcLine++) {
    const trimmed = sourceLines[srcLine].trim();
    if (!trimmed || emitIdx >= emitEntries.length) continue;

    if (emitEntries[emitIdx].trimmed === trimmed) {
      mappings.push({
        originalLine: srcLine,
        originalColumn: 0,
        generatedLine: emitEntries[emitIdx].line + 1, // 1-based for Monaco
        generatedColumn: 0,
      });
      emitIdx++;
    }
  }

  return mappings;
}

export function TreeInspectorPanel() {
  const monacoEditor = useAppStore(state => state.source.monacoEditor);
  const cst = useAppStore(state => state.source.cst);
  const ast = useAppStore(state => state.source.ast);
  const compileResult = useAppStore(state => state.source.compileResult);

  // Tree inspector state from store
  const treeInspectorMode = useAppStore(
    state => state.layout.treeInspectorMode
  );
  const setTreeInspectorMode = useAppStore(state => state.setTreeInspectorMode);
  const selectedNodeId = useAppStore(
    state => state.layout.selectedTreeInspectorNodeId
  );
  const setSelectedNodeId = useAppStore(
    state => state.setSelectedTreeInspectorNodeId
  );
  const setShowTreeInspector = useAppStore(state => state.setShowTreeInspector);
  const agentscript = useAppStore(state => state.source.agentscript);
  const dialectId = detectDialectId(agentscript);
  const theme = useAppStore(state => state.theme.theme);
  const emitTabSize = useAppStore(state => state.layout.emitTabSize);
  const setEmitTabSize = useAppStore(state => state.setEmitTabSize);
  const { syncLspModel, closeLspDocument } = useMonacoEditor();

  // Fall back from compiled tab when dialect changes away from agentforce
  useEffect(() => {
    if (treeInspectorMode === 'compiled' && dialectId !== 'agentforce') {
      setTreeInspectorMode('ast');
    }
  }, [treeInspectorMode, dialectId, setTreeInspectorMode]);

  // Resolve system theme to actual light/dark
  const actualTheme = useMemo(() => {
    if (theme === 'system') {
      return typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return theme;
  }, [theme]);

  // Compute emitted text from AST
  const emittedText = useMemo(() => {
    if (!ast) return '';
    try {
      const schema = getDialectSchema(dialectId);
      return emitDocument(ast as Record<string, unknown>, schema, {
        tabSize: emitTabSize,
      });
    } catch (e) {
      return `// Emit error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [ast, dialectId, emitTabSize]);

  // Build source→emit line mappings
  const emitMappings = useMemo(() => {
    if (!agentscript || !emittedText) return [];
    return buildEmitMappings(agentscript, emittedText);
  }, [agentscript, emittedText]);

  // Compile result from LSP — serialized in the worker (SourceAnnotations uses
  // WeakMap which can't cross postMessage, so json + rangeMappings are pre-built).
  const compiledData = useMemo<{
    text: string;
    cursorMap: CursorMap | null;
  }>(() => {
    if (!compileResult) return { text: '', cursorMap: null };
    try {
      const result = compileResult as unknown as {
        json?: string;
        sourceMap?: Parameters<typeof buildCursorMap>[0];
      };
      if (result.json) {
        const sourceLineCount = agentscript
          ? agentscript.split('\n').length
          : 0;
        const genLineCount = result.json.split('\n').length;
        const cursorMap = result.sourceMap
          ? buildCursorMap(result.sourceMap, sourceLineCount, genLineCount)
          : null;
        return {
          text: result.json,
          cursorMap,
        };
      }
      return {
        text: JSON.stringify(compileResult, null, 2),
        cursorMap: null,
      };
    } catch (e) {
      return {
        text: `// Compile error: ${e instanceof Error ? e.message : String(e)}`,
        cursorMap: null,
      };
    }
  }, [compileResult, agentscript]);

  // Emit editor refs
  const emitEditorRef = useRef<HTMLDivElement>(null);
  const emitEditorInstance = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );

  // Create/destroy Monaco editor when emit tab is shown/hidden
  useEffect(() => {
    if (treeInspectorMode !== 'emit' || !emitEditorRef.current) {
      if (emitEditorInstance.current) {
        emitEditorInstance.current.dispose();
        emitEditorInstance.current = null;
      }
      return;
    }

    const themeName =
      actualTheme === 'dark' ? 'agentscript-dark' : 'agentscript-light';

    const editor = monaco.editor.create(emitEditorRef.current, {
      value: emittedText,
      language: 'agentscript',
      theme: themeName,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: 'none',
      cursorStyle: 'line-thin',
      'semanticHighlighting.enabled': true,
    });

    emitEditorInstance.current = editor;
    const emitModel = editor.getModel();
    if (emitModel) {
      void syncLspModel(emitModel);
    }

    // Force layout after next paint to ensure container dimensions are computed
    requestAnimationFrame(() => editor.layout());

    return () => {
      const model = editor.getModel();
      if (model) {
        closeLspDocument(model.uri.toString());
      }
      editor.dispose();
      emitEditorInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeInspectorMode, actualTheme]);

  // Update emit editor content when emittedText changes
  useEffect(() => {
    if (emitEditorInstance.current && treeInspectorMode === 'emit') {
      const model = emitEditorInstance.current.getModel();
      if (model && model.getValue() !== emittedText) {
        model.setValue(emittedText);
        void syncLspModel(model);
      }
    }
  }, [emittedText, treeInspectorMode, syncLspModel]);

  // Compiled editor refs
  const compiledEditorRef = useRef<HTMLDivElement>(null);
  const compiledEditorInstance =
    useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Create/destroy Monaco editor when compiled tab is shown/hidden
  useEffect(() => {
    if (treeInspectorMode !== 'compiled' || !compiledEditorRef.current) {
      if (compiledEditorInstance.current) {
        compiledEditorInstance.current.dispose();
        compiledEditorInstance.current = null;
      }
      return;
    }

    const themeName =
      actualTheme === 'dark' ? 'agentscript-dark' : 'agentscript-light';

    const editor = monaco.editor.create(compiledEditorRef.current, {
      value: compiledData.text,
      language: 'json',
      theme: themeName,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: 'none',
      cursorStyle: 'line-thin',
    });

    compiledEditorInstance.current = editor;

    // Listen for cursor changes in compiled editor → sync to source editor (O(1) lookup)
    const cursorDisposable = editor.onDidChangeCursorPosition(e => {
      if (!monacoEditor) return;
      if (e.reason === monaco.editor.CursorChangeReason.NotSet) return;

      const { cursorMap } = compiledData;
      if (!cursorMap) return;

      const genLine = e.position.lineNumber - 1; // Monaco 1-based → 0-based
      const genLineIdx = genLine * 2;
      if (genLine >= 0 && genLineIdx + 1 < cursorMap.genToSource.length) {
        const srcLine = cursorMap.genToSource[genLineIdx];
        const srcCol = cursorMap.genToSource[genLineIdx + 1];
        if (srcLine >= 0) {
          const lineNumber = srcLine + 1; // 0-based → Monaco 1-based
          const column = Math.max(srcCol + 1, 1); // 0-based → Monaco 1-based
          monacoEditor.setPosition({ lineNumber, column });
          monacoEditor.revealPositionInCenter({ lineNumber, column });
        }
      }
    });

    requestAnimationFrame(() => editor.layout());

    return () => {
      cursorDisposable.dispose();
      editor.dispose();
      compiledEditorInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeInspectorMode, actualTheme]);

  // Update compiled editor content when compiled data changes
  useEffect(() => {
    if (compiledEditorInstance.current && treeInspectorMode === 'compiled') {
      const model = compiledEditorInstance.current.getModel();
      if (model && model.getValue() !== compiledData.text) {
        model.setValue(compiledData.text);
      }
    }
  }, [compiledData.text, treeInspectorMode]);

  // Copy CST as S-expression to clipboard
  const handleCopyCst = useCallback(() => {
    if (!cst) return;
    const sexpr = cstToSExpr(cst);
    copyToClipboard(sexpr, 'CST copied to clipboard');
  }, [cst]);

  // Copy AST as JSON to clipboard (strip internal __cst metadata)
  const handleCopyAst = useCallback(() => {
    if (!ast) return;
    const json = JSON.stringify(
      ast,
      (key, value: unknown) =>
        key === '__cst' || key === 'parent' ? undefined : value,
      2
    );
    copyToClipboard(json, 'AST copied to clipboard');
  }, [ast]);

  // Copy emitted text to clipboard
  const handleCopyEmit = useCallback(() => {
    if (!emittedText) return;
    copyToClipboard(emittedText, 'Emitted text copied to clipboard');
  }, [emittedText]);

  // Copy compiled JSON to clipboard
  const handleCopyCompiled = useCallback(() => {
    if (!compiledData.text) return;
    copyToClipboard(compiledData.text, 'Compiled JSON copied to clipboard');
  }, [compiledData.text]);

  // Read editor selection for cursor-based highlighting
  const editorSelection = useAppStore(state => state.source.editorSelection);

  // Convert CST to debug tree data
  const cstTreeData = useMemo(() => {
    if (!cst) return [];
    return cstToDebugTree(cst);
  }, [cst]);

  // -- Cursor ↔ CST/AST sync (shared hook) --
  const navigateEditor = useCallback(
    (position: { line: number; character: number }) => {
      if (!monacoEditor) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = monacoEditor as any;

      // Signal that this navigation is from tree inspector (prevents feedback loop)
      if (editor.__setNavigatingFromExplorer) {
        editor.__setNavigatingFromExplorer();
      }

      // Monaco uses 1-based line/column, CST positions are 0-based
      const lineNumber = position.line + 1;
      const column = position.character + 1;

      editor.setPosition({ lineNumber, column });
      editor.revealPositionInCenter({ lineNumber, column });
      editor.focus();
    },
    [monacoEditor]
  );

  const cursorPosition = useMemo(
    () =>
      editorSelection
        ? {
            line: editorSelection.positionRow,
            column: editorSelection.positionColumn,
          }
        : null,
    [editorSelection]
  );

  const {
    selectedCstNodeAtCursor,
    astHighlightPath,
    expandedKeys,
    navigateToCstNode,
    navigateToRange,
  } = useCursorSync({
    cursorPosition,
    mode: treeInspectorMode,
    cstTreeData,
    ast,
    astRootName: 'AST',
    navigateEditor,
  });

  // Update selection when cursor moves (CST mode only)
  useEffect(() => {
    if (treeInspectorMode === 'cst' && selectedCstNodeAtCursor) {
      setSelectedNodeId(selectedCstNodeAtCursor);
    }
  }, [treeInspectorMode, selectedCstNodeAtCursor, setSelectedNodeId]);

  // Sync cursor position: source editor → compiled JSON editor (O(1) lookup)
  useEffect(() => {
    if (treeInspectorMode !== 'compiled') return;
    if (!editorSelection || !compiledEditorInstance.current) return;

    const { cursorMap } = compiledData;
    if (cursorMap) {
      const srcLine = editorSelection.positionRow;
      const srcLineIdx = srcLine * 2;
      if (srcLine >= 0 && srcLineIdx + 1 < cursorMap.sourceToGen.length) {
        const genLine = cursorMap.sourceToGen[srcLineIdx];
        const genCol = cursorMap.sourceToGen[srcLineIdx + 1];
        if (genLine >= 0) {
          const lineNumber = genLine + 1; // 0-based → Monaco 1-based
          const column = Math.max(genCol + 1, 1); // 0-based → Monaco 1-based
          compiledEditorInstance.current.revealLineInCenter(lineNumber);
          compiledEditorInstance.current.setPosition({ lineNumber, column });
          return;
        }
      }
    }

    // CursorMap handles all compiled tab cursor sync — no V3 fallback needed
  }, [treeInspectorMode, editorSelection, compiledData]);

  // Sync cursor position: source editor → emit editor
  useEffect(() => {
    if (treeInspectorMode !== 'emit') return;
    if (!editorSelection || !emitEditorInstance.current) return;
    if (emitMappings.length === 0) return;

    const genPos = findGeneratedPosition(
      emitMappings,
      editorSelection.positionRow,
      editorSelection.positionColumn
    );

    if (genPos) {
      emitEditorInstance.current.revealLineInCenter(genPos.line);
      emitEditorInstance.current.setPosition({
        lineNumber: genPos.line,
        column: genPos.column + 1,
      });
    }
  }, [treeInspectorMode, editorSelection, emitMappings]);

  // Handle CST node selection - navigate to position in editor
  const handleNodeSelect = useCallback(
    (_kind: string, id: string) => {
      setSelectedNodeId(id);
      navigateToCstNode(id);
    },
    [setSelectedNodeId, navigateToCstNode]
  );

  // Handle navigation from ObjectInspector
  const handleInspectorNavigate = useCallback(
    (range: { start: { line: number; character: number } }) => {
      navigateToRange(range);
    },
    [navigateToRange]
  );

  // Convert CST tree nodes to TreeView format
  const cstTreeViewData = useMemo(() => {
    return cstTreeData.map(node => convertCstToTreeViewNode(node));
  }, [cstTreeData]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-l-xl border border-r-0 shadow-sm"
      style={{
        background: 'var(--ide-surface-elevated)',
        borderColor: 'var(--ide-border-subtle)',
        color: 'var(--ide-text-primary)',
      }}
    >
      {/* Header with CST/AST toggle */}
      <div
        className="flex h-9 flex-none items-center justify-between border-b px-3"
        style={{
          borderColor: 'var(--ide-border-subtle)',
          background: 'var(--ide-surface-elevated)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#606060] dark:font-normal dark:text-[#bebebe]">
            Debug:
          </span>
          <button
            onClick={() => setTreeInspectorMode('cst')}
            className={cn(
              'text-xs font-semibold uppercase tracking-wider transition-colors',
              treeInspectorMode === 'cst'
                ? 'text-blue-600 dark:text-[#3a94bd]'
                : 'text-[#606060] hover:text-[#606060] dark:text-[#848484] dark:hover:text-[#bebebe]'
            )}
          >
            CST
          </button>
          <button
            onClick={() => setTreeInspectorMode('ast')}
            className={cn(
              'text-xs font-semibold uppercase tracking-wider transition-colors',
              treeInspectorMode === 'ast'
                ? 'text-blue-600 dark:text-[#3a94bd]'
                : 'text-[#606060] hover:text-[#606060] dark:text-[#848484] dark:hover:text-[#bebebe]'
            )}
          >
            AST
          </button>
          <button
            onClick={() => setTreeInspectorMode('emit')}
            className={cn(
              'text-xs font-semibold uppercase tracking-wider transition-colors',
              treeInspectorMode === 'emit'
                ? 'text-blue-600 dark:text-[#3a94bd]'
                : 'text-[#606060] hover:text-[#606060] dark:text-[#848484] dark:hover:text-[#bebebe]'
            )}
          >
            Emit
          </button>
          {dialectId === 'agentforce' && (
            <button
              onClick={() => setTreeInspectorMode('compiled')}
              className={cn(
                'text-xs font-semibold uppercase tracking-wider transition-colors',
                treeInspectorMode === 'compiled'
                  ? 'text-blue-600 dark:text-[#3a94bd]'
                  : 'text-[#606060] hover:text-[#606060] dark:text-[#848484] dark:hover:text-[#bebebe]'
              )}
            >
              Compiled
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {treeInspectorMode === 'cst' && cst && (
            <button
              type="button"
              onClick={handleCopyCst}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#454646]"
              title="Copy CST as S-expression"
              aria-label="Copy CST as S-expression"
            >
              <Copy className="h-3.5 w-3.5 text-gray-600 dark:text-[#cbcbcb]" />
            </button>
          )}
          {treeInspectorMode === 'ast' && ast && (
            <button
              type="button"
              onClick={handleCopyAst}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#454646]"
              title="Copy AST as JSON"
              aria-label="Copy AST as JSON"
            >
              <Copy className="h-3.5 w-3.5 text-gray-600 dark:text-[#cbcbcb]" />
            </button>
          )}
          {treeInspectorMode === 'emit' && (
            <select
              value={emitTabSize}
              onChange={e => setEmitTabSize(Number(e.target.value))}
              className="h-5 rounded border border-gray-300 bg-transparent px-1 text-[10px] text-gray-600 outline-none dark:border-[#555] dark:text-[#cbcbcb]"
              title="Indent size (spaces)"
              aria-label="Indent size"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <option key={n} value={n}>
                  {n}sp
                </option>
              ))}
            </select>
          )}
          {treeInspectorMode === 'emit' && emittedText && (
            <button
              type="button"
              onClick={handleCopyEmit}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#454646]"
              title="Copy emitted source"
              aria-label="Copy emitted source"
            >
              <Copy className="h-3.5 w-3.5 text-gray-600 dark:text-[#cbcbcb]" />
            </button>
          )}
          {treeInspectorMode === 'compiled' && compiledData.text && (
            <button
              type="button"
              onClick={handleCopyCompiled}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#454646]"
              title="Copy compiled JSON"
              aria-label="Copy compiled JSON"
            >
              <Copy className="h-3.5 w-3.5 text-gray-600 dark:text-[#cbcbcb]" />
            </button>
          )}
          <button
            onClick={() => setShowTreeInspector(false)}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#454646]"
            title="Close panel"
          >
            <X className="h-4 w-4 text-gray-600 dark:text-[#cbcbcb]" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          'min-h-0 flex-1',
          treeInspectorMode === 'emit' || treeInspectorMode === 'compiled'
            ? 'overflow-hidden'
            : 'overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {treeInspectorMode === 'cst' ? (
          // CST mode: use TreeView
          cstTreeViewData.length > 0 ? (
            <TreeView
              data={cstTreeViewData}
              selectedNodeId={selectedNodeId}
              onNodeSelect={handleNodeSelect}
              expandedKeys={expandedKeys}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-[#848484]">
              No CST available
            </div>
          )
        ) : treeInspectorMode === 'ast' ? (
          // AST mode: use ObjectInspector (Chrome DevTools style)
          ast ? (
            <ObjectInspector
              data={ast}
              name="AST"
              expandLevel={1}
              highlightPath={astHighlightPath}
              onNavigate={handleInspectorNavigate}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-[#848484]">
              No AST available
            </div>
          )
        ) : treeInspectorMode === 'emit' ? (
          // Emit mode: read-only Monaco editor with roundtrip output
          <div ref={emitEditorRef} className="h-full w-full" />
        ) : treeInspectorMode === 'compiled' ? (
          // Compiled mode: read-only Monaco editor with JSON output
          <div ref={compiledEditorRef} className="h-full w-full" />
        ) : null}
      </div>
    </div>
  );
}
