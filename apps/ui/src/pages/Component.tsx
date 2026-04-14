/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Component page — parseComponent() playground.
 *
 * Renders only the Monaco editor + kind selector. CST / AST / Emit output is
 * surfaced through the shared right-side TreeInspectorPanel (see IDELayout +
 * the header's right-panel toggle). We push the component's parse result into
 * the source store so the inspector has something to render, and we
 * save/restore the previous source-store contents on unmount so returning to
 * an agent view does not lose its data.
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
import { PanelHeader } from '~/components/panels/PanelHeader';
import { useAppStore } from '~/store';
import { Undo2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import type { AgentScriptAST } from '~/lib/parser';
import type { SerializedNode } from '~/store/source';

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

type DebugTab = 'cst' | 'ast' | 'emit';

export function Component() {
  const { kind: kindParam, agentId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const validKinds = KIND_OPTIONS.map(o => o.value);
  const selectedKind =
    kindParam && validKinds.includes(kindParam) ? kindParam : 'actions';

  // Sync ?debug= <-> treeInspectorMode store
  const treeInspectorMode = useAppStore(
    state => state.layout.treeInspectorMode
  );
  const setTreeInspectorMode = useAppStore(state => state.setTreeInspectorMode);

  useEffect(() => {
    const debugParam = searchParams.get('debug');
    const next: DebugTab | undefined =
      debugParam === 'cst' || debugParam === 'ast' || debugParam === 'emit'
        ? (debugParam as DebugTab)
        : undefined;
    if (next && next !== treeInspectorMode) {
      setTreeInspectorMode(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const current = searchParams.get('debug');
    const desired = treeInspectorMode === 'cst' ? null : treeInspectorMode;
    if (desired === current) return;
    if (treeInspectorMode === 'compiled') return; // not applicable here
    const basePath = agentId
      ? `/agents/${agentId}/component`
      : '/agents/component';
    const qs = desired ? `?debug=${desired}` : '';
    void navigate(`${basePath}/${selectedKind}${qs}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeInspectorMode]);

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

  const componentSources = useAppStore(
    state => state.component.componentSources
  );
  const resetComponentSource = useAppStore(state => state.resetComponentSource);

  const source =
    componentSources[selectedKind] ?? DEFAULT_SOURCES[selectedKind] ?? '';

  const [parseError, setParseError] = useState<string | null>(null);

  const setDiagnostics = useAppStore(state => state.setDiagnostics);
  const setParseResult = useAppStore(state => state.setParseResult);
  const setAgentScript = useAppStore(state => state.setAgentScript);

  // Save/restore source-store + diagnostics on mount/unmount so returning to
  // an agent view does not lose its parsed state.
  const savedRef = useRef({
    diagnostics: useAppStore.getState().diagnostics.diagnostics,
    agentscript: useAppStore.getState().source.agentscript,
    cst: useAppStore.getState().source.cst,
    ast: useAppStore.getState().source.ast,
    lintStore: useAppStore.getState().source.lintStore,
  });
  useEffect(() => {
    const s = useAppStore.getState();
    savedRef.current = {
      diagnostics: s.diagnostics.diagnostics,
      agentscript: s.source.agentscript,
      cst: s.source.cst,
      ast: s.source.ast,
      lintStore: s.source.lintStore,
    };
    return () => {
      setDiagnostics(savedRef.current.diagnostics);
      setAgentScript(savedRef.current.agentscript);
      setParseResult({
        cst: savedRef.current.cst,
        ast: savedRef.current.ast,
        lintStore: savedRef.current.lintStore,
      });
    };
  }, [setDiagnostics, setAgentScript, setParseResult]);

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

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const selectedKindRef = useRef(selectedKind);
  selectedKindRef.current = selectedKind;
  const [languageInitialized, setLanguageInitialized] = useState(false);

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
    useAppStore.getState().setMonacoEditor(editor);

    editor.onDidChangeModelContent(() => {
      const value = editor.getValue();
      useAppStore.getState().setComponentSource(selectedKindRef.current, value);
    });

    editor.onDidChangeCursorSelection(e => {
      useAppStore.getState().setEditorSelection({
        startLineNumber: e.selection.startLineNumber,
        startColumn: e.selection.startColumn,
        endLineNumber: e.selection.endLineNumber,
        endColumn: e.selection.endColumn,
        positionRow: e.selection.endLineNumber - 1,
        positionColumn: e.selection.endColumn - 1,
      });
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
      useAppStore.getState().setMonacoEditor(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageInitialized]);

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

  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const handleReset = useCallback(() => {
    resetComponentSource(selectedKind);
    setResetDialogOpen(false);
  }, [resetComponentSource, selectedKind]);

  const isModified = selectedKind in componentSources;

  useEffect(() => {
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== source) {
        model.setValue(source);
      }
    }
  }, [source]);

  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const doParse = useCallback(() => {
    if (!languageInitialized) return;

    setParseError(null);

    try {
      const result = parseComponentDebug(
        source,
        selectedKind as Parameters<typeof parseComponentDebug>[1]
      );
      setParseResult({
        cst: result.cst as unknown as SerializedNode | null,
        ast: (result.component ?? null) as unknown as AgentScriptAST | null,
        lintStore: null,
      });
      setAgentScript(source);
      setDiagnostics(result.diagnostics);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      setParseResult({ cst: null, ast: null, lintStore: null });
      setAgentScript(source);
      setDiagnostics([]);
    }
  }, [
    source,
    selectedKind,
    languageInitialized,
    setDiagnostics,
    setParseResult,
    setAgentScript,
  ]);

  useEffect(() => {
    clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      void doParse();
    }, 250);
    return () => clearTimeout(parseTimerRef.current);
  }, [doParse]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PanelHeader title="Parse Component" />
      <div className="flex h-full flex-col overflow-hidden">
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
                  <Undo2 className="text-gray-600 dark:text-[#cbcbcb] h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div ref={editorContainerRef} className="min-h-0 flex-1" />
      </div>

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
