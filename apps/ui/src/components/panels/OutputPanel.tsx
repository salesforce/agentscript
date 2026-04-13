/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { type Diagnostic, DiagnosticSeverity } from '~/store/diagnostics';
import {
  VscError,
  VscWarning,
  VscInfo,
  VscClose,
  VscWand,
  VscCopy,
} from 'react-icons/vsc';
import { Badge } from '~/components/ui/badge';
import { useMonacoEditor } from '~/contexts/MonacoEditorContext';
import { useAppStore } from '~/store';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';
import { cn, copyToClipboard } from '~/lib/utils';
import { useCallback, useState } from 'react';
import { featureFlags } from '~/lib/feature-flags';
import type { CodeAction } from 'vscode-languageserver-protocol';

/** Diagnostic codes known to have quick-fix code actions. */
const FIXABLE_CODES = new Set([
  'invalid-modifier',
  'unknown-type',
  'unknown-dialect',
  'deprecated-field',
  'invalid-version',
]);

export const OutputPanel = () => {
  const setShowBottomPanel = useAppStore(state => state.setShowBottomPanel);
  const diagnostics = useAppStore(state => state.diagnostics.diagnostics);
  const bottomPanelTab = useAppStore(state => state.layout.bottomPanelTab);
  const setBottomPanelTab = useAppStore(state => state.setBottomPanelTab);

  // Count errors and warnings for badge
  const problemCount = diagnostics.filter(
    diag =>
      diag.severity === DiagnosticSeverity.Error ||
      diag.severity === DiagnosticSeverity.Warning
  ).length;

  const { editor, lspClient } = useMonacoEditor();
  const [isFixing, setIsFixing] = useState(false);

  // Check if any diagnostics have fixable codes
  const hasFixableDiagnostics = diagnostics.some(
    diag => diag.code && FIXABLE_CODES.has(String(diag.code))
  );

  // Copy diagnostics to clipboard as JSON
  const handleCopyDiagnostics = useCallback(() => {
    if (diagnostics.length === 0) return;
    const json = JSON.stringify(diagnostics, null, 2);
    copyToClipboard(json, 'Diagnostics copied to clipboard');
  }, [diagnostics]);

  // Fix all diagnostics that have quick fixes
  const handleFixAll = useCallback(async () => {
    if (!editor || !lspClient) return;
    const model = editor.getModel();
    if (!model) return;

    setIsFixing(true);
    try {
      const uri = model.uri.toString();
      const fixableDiags = diagnostics.filter(
        diag => diag.code && FIXABLE_CODES.has(String(diag.code))
      );
      if (fixableDiags.length === 0) return;

      // Request code actions for all fixable diagnostics
      const fullRange = {
        start: { line: 0, character: 0 },
        end: {
          line: model.getLineCount() - 1,
          character: model.getLineMaxColumn(model.getLineCount()) - 1,
        },
      };

      const actions = (await lspClient.codeActions({
        textDocument: { uri },
        range: fullRange,
        context: { diagnostics: fixableDiags },
      })) as CodeAction[];

      // Keep only preferred actions (one per diagnostic), falling back to first
      const preferredActions = actions.filter(
        a => a.isPreferred && a.edit?.changes
      );
      const actionsToApply =
        preferredActions.length > 0
          ? preferredActions
          : actions.filter(a => a.edit?.changes);

      if (actionsToApply.length === 0) return;

      // Collect all text edits, sorted by position (bottom-up to avoid offset shifts)
      const allEdits: {
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }[] = [];
      for (const action of actionsToApply) {
        const changes = action.edit?.changes ?? {};
        for (const [, textEdits] of Object.entries(changes)) {
          for (const edit of textEdits) {
            allEdits.push(edit);
          }
        }
      }

      // Sort edits bottom-up so applying them doesn't shift positions
      allEdits.sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });

      // Deduplicate edits that touch the same range
      const seen = new Set<string>();
      const uniqueEdits = allEdits.filter(edit => {
        const key = `${edit.range.start.line}:${edit.range.start.character}-${edit.range.end.line}:${edit.range.end.character}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Apply all edits as a single undo-able operation
      const monacoEdits = uniqueEdits.map(edit => ({
        range: {
          startLineNumber: edit.range.start.line + 1,
          startColumn: edit.range.start.character + 1,
          endLineNumber: edit.range.end.line + 1,
          endColumn: edit.range.end.character + 1,
        },
        text: edit.newText,
      }));

      model.pushEditOperations([], monacoEdits, () => null);
    } finally {
      setIsFixing(false);
    }
  }, [editor, lspClient, diagnostics]);

  // Panel content - shared between expanded and normal views
  const panelContent = (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#fafafd] dark:bg-[#191a1b] gap-y-1">
      <div className="flex shrink-0 items-center justify-between pl-3 pr-1 pt-1 text-[11px] uppercase tracking-wide text-gray-400 dark:text-[#909090]">
        <div className="flex gap-3">
          <button
            onClick={() => setBottomPanelTab('problems')}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 border-b py-1 font-medium uppercase tracking-wide transition-colors',
              bottomPanelTab === 'problems'
                ? 'border-gray-400 text-gray-500 dark:border-[#3a94bd] dark:text-[#bdbdbd]'
                : 'border-transparent text-gray-400 hover:text-gray-500 dark:text-[#909090] dark:hover:text-[#bdbdbd]'
            )}
          >
            Problems
            {problemCount > 0 && (
              <Badge
                className="h-4 min-w-4 rounded-full border-0! bg-[#027acc] px-1! py-0! gap-0! font-mono text-[10px]! leading-none! tabular-nums text-white hover:bg-[#027acc] dark:bg-[#3a94bd] dark:hover:bg-[#3a94bd]"
                variant="secondary"
              >
                <span className="-mb-0.5">{problemCount}</span>
              </Badge>
            )}
          </button>
          {featureFlags.suggestionsTab && (
            <button
              onClick={() => setBottomPanelTab('suggestions')}
              className={cn(
                'cursor-pointer border-b py-1 font-medium uppercase tracking-wide transition-colors',
                bottomPanelTab === 'suggestions'
                  ? 'border-gray-400 text-gray-500 dark:border-[#3a94bd] dark:text-[#bdbdbd]'
                  : 'border-transparent text-gray-400 hover:text-gray-500 dark:text-[#909090] dark:hover:text-[#bdbdbd]'
              )}
            >
              Suggestions
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {bottomPanelTab === 'problems' && hasFixableDiagnostics && (
            <button
              type="button"
              onClick={() => void handleFixAll()}
              disabled={isFixing}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#2a2a2a] disabled:opacity-50"
              title="Fix All"
              aria-label="Fix All"
            >
              <VscWand className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}
          {bottomPanelTab === 'problems' && diagnostics.length > 0 && (
            <button
              type="button"
              onClick={handleCopyDiagnostics}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#2a2a2a]"
              title="Copy Diagnostics as JSON"
              aria-label="Copy Diagnostics as JSON"
            >
              <VscCopy className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowBottomPanel(false)}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-[#2a2a2a]"
            title="Close Panel"
            aria-label="Close Panel"
          >
            <VscClose className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto pl-1 pr-1 pb-2 pt-1">
        {/* Problems Tab */}
        {bottomPanelTab === 'problems' && (
          <>
            {/* No problems message */}
            {diagnostics.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-[#cccccc]">
                No problems have been detected in the agent.
              </p>
            )}

            {/* Problems list - ungrouped */}
            {diagnostics.length > 0 && (
              <div className="space-y-1">
                {[...diagnostics]
                  .sort((a, b) => {
                    const sevDiff = (a.severity ?? 0) - (b.severity ?? 0);
                    if (sevDiff !== 0) return sevDiff;
                    const aLine =
                      (a as unknown as { range?: { start?: { line: number } } })
                        .range?.start?.line ?? 0;
                    const bLine =
                      (b as unknown as { range?: { start?: { line: number } } })
                        .range?.start?.line ?? 0;
                    return aLine - bLine;
                  })
                  .map((diag, idx) => (
                    <DiagnosticItem key={idx} diagnostic={diag} />
                  ))}
              </div>
            )}
          </>
        )}

        {/* Suggestions Tab */}
        {featureFlags.suggestionsTab && bottomPanelTab === 'suggestions' && (
          <div className="flex h-full items-center justify-center py-8">
            <Empty orientation="horizontal" size="tight">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <VscWand />
                </EmptyMedia>
                <div className="flex flex-col">
                  <EmptyTitle>AI Suggestions Coming Soon</EmptyTitle>
                  <EmptyDescription>
                    Smart suggestions will help you improve your agent code and
                    catch potential issues.
                  </EmptyDescription>
                </div>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>
    </div>
  );

  return panelContent;
};

/**
 * Individual diagnostic item
 */
function DiagnosticItem({ diagnostic }: { diagnostic: Diagnostic }) {
  // Use type assertion to handle updated LSP-compliant Diagnostic interface
  // (range instead of span, data instead of context, numeric severity)
  const diag = diagnostic as unknown as {
    range?: { start?: { line: number; character: number } };
    message: string;
    code?: string | number;
    source?: string;
    severity?: number;
    data?: {
      expected?: string[];
      suggestion?: string;
      path?: string;
    };
  };
  const { range, message, code, source, severity } = diag;
  const { editor } = useMonacoEditor();

  // Convert 0-based to 1-based for display
  // range might be undefined, so provide defaults
  const line = (range?.start?.line ?? 0) + 1;
  const col = (range?.start?.character ?? 0) + 1;

  const sourceLabel = source;

  // Determine icon and color based on severity
  const getSeverityIcon = () => {
    switch (severity) {
      case DiagnosticSeverity.Error:
        return <VscError className="h-4 w-4 text-red-600 dark:text-red-400" />;
      case DiagnosticSeverity.Warning:
        return (
          <VscWarning className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        );
      case DiagnosticSeverity.Information:
      case DiagnosticSeverity.Hint:
        return <VscInfo className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
      default:
        return <VscInfo className="h-4 w-4 text-gray-600 dark:text-gray-400" />;
    }
  };

  const handleClick = () => {
    if (!editor) return;

    // Navigate to the diagnostic position
    // Monaco uses 1-based line/column, diagnostic range is 0-based
    const position = {
      lineNumber: line,
      column: col,
    };

    // Set cursor position
    editor.setPosition(position);

    // Reveal position in center of editor
    editor.revealPositionInCenter(position);

    // Focus the editor
    editor.focus();
  };

  // Format source label with code, e.g. "agentscript-lint(duplicate-key)"
  const formattedSource = sourceLabel
    ? code
      ? `${sourceLabel} (${code})`
      : sourceLabel
    : code
      ? String(code)
      : undefined;

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-[#252627]"
      onClick={handleClick}
    >
      <div className="shrink-0">{getSeverityIcon()}</div>
      <span className="truncate text-gray-900 dark:text-[#cccccc]">
        {message}
      </span>
      {formattedSource && (
        <span className="shrink-0 text-gray-400 dark:text-[#707171]">
          {formattedSource}
        </span>
      )}
      <span className="ml-auto shrink-0 text-gray-400 dark:text-[#707171]">
        [Ln {line}, Col {col}]
      </span>
    </div>
  );
}
