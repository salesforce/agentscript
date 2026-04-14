/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { type Diagnostic, DiagnosticSeverity } from '~/store/diagnostics';
import { X, Wand2, Copy, Sparkles } from 'lucide-react';
import { useMonacoEditor } from '~/contexts/MonacoEditorContext';
import { useAppStore } from '~/store';
import { copyToClipboard } from '~/lib/utils';
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

  // Count errors and warnings separately
  const errorCount = diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  ).length;
  const warningCount = diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Warning
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

  const sortedDiagnostics = [...diagnostics].sort((a, b) => {
    const sevDiff = (a.severity ?? 0) - (b.severity ?? 0);
    if (sevDiff !== 0) return sevDiff;
    const aLine =
      (a as unknown as { range?: { start?: { line: number } } }).range?.start
        ?.line ?? 0;
    const bLine =
      (b as unknown as { range?: { start?: { line: number } } }).range?.start
        ?.line ?? 0;
    return aLine - bLine;
  });

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border"
      style={{
        background: 'var(--ide-surface-elevated)',
        borderColor: 'var(--ide-border-subtle)',
      }}
    >
      {/* Header — title + counts on the left, actions on the right */}
      <div
        className="flex shrink-0 items-center justify-between px-4 py-2"
        style={{ color: 'var(--ide-text-primary)' }}
      >
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            {bottomPanelTab === 'suggestions' ? 'Suggestions' : 'Issues'}
          </h2>
          {bottomPanelTab === 'problems' && (
            <div
              className="flex items-center gap-2.5 text-xs"
              style={{ color: 'var(--ide-text-muted)' }}
            >
              <CountChip
                color="var(--ide-danger)"
                count={errorCount}
                label="errors"
              />
              <CountChip
                color="var(--ide-warning)"
                count={warningCount}
                label="warnings"
              />
            </div>
          )}
          {featureFlags.suggestionsTab && (
            <button
              onClick={() =>
                setBottomPanelTab(
                  bottomPanelTab === 'problems' ? 'suggestions' : 'problems'
                )
              }
              className="text-xs underline-offset-2 hover:underline"
              style={{ color: 'var(--ide-text-subtle)' }}
            >
              {bottomPanelTab === 'problems'
                ? 'View suggestions'
                : 'View issues'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {bottomPanelTab === 'problems' && hasFixableDiagnostics && (
            <PanelActionButton
              onClick={() => void handleFixAll()}
              disabled={isFixing}
              title="Fix all auto-fixable issues"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>Fix all</span>
            </PanelActionButton>
          )}
          {bottomPanelTab === 'problems' && diagnostics.length > 0 && (
            <IconButton
              onClick={handleCopyDiagnostics}
              title="Copy diagnostics as JSON"
            >
              <Copy className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <IconButton
            onClick={() => setShowBottomPanel(false)}
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-2 pb-3">
        {bottomPanelTab === 'problems' && (
          <>
            {diagnostics.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-[#848484]">
                No issues detected in this agent.
              </div>
            ) : (
              <ul className="flex flex-col gap-px">
                {sortedDiagnostics.map((diag, idx) => (
                  <DiagnosticItem key={idx} diagnostic={diag} />
                ))}
              </ul>
            )}
          </>
        )}

        {featureFlags.suggestionsTab && bottomPanelTab === 'suggestions' && (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title="AI suggestions coming soon"
            description="Smart suggestions will surface improvements and likely bugs as you work."
          />
        )}
      </div>
    </div>
  );
};

/** Small severity-dot count, e.g. "● 2" for errors. */
function CountChip({
  color,
  count,
  label,
}: {
  color: string;
  count: number;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 tabular-nums"
      style={{ color: count > 0 ? 'var(--ide-text-primary)' : undefined }}
      aria-label={`${count} ${label}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: count > 0 ? color : 'var(--ide-border-strong)' }}
      />
      {count}
    </span>
  );
}

function PanelActionButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 disabled:opacity-50"
      style={{
        background: 'var(--ide-surface)',
        borderColor: 'var(--ide-border-subtle)',
        color: 'var(--ide-text-primary)',
      }}
      onMouseEnter={e => {
        if (!disabled)
          e.currentTarget.style.background = 'var(--ide-surface-hover)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--ide-surface)';
      }}
    >
      {children}
    </button>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150"
      style={{ color: 'var(--ide-text-muted)' }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--ide-surface-hover)';
        e.currentTarget.style.color = 'var(--ide-text-primary)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ide-text-muted)';
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{
          background: 'var(--ide-surface-sunken)',
          color: 'var(--ide-text-muted)',
        }}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <p
          className="text-sm font-medium"
          style={{ color: 'var(--ide-text-primary)' }}
        >
          {title}
        </p>
        <p
          className="text-xs max-w-xs"
          style={{ color: 'var(--ide-text-muted)' }}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

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

  const severityColor = (() => {
    switch (severity) {
      case DiagnosticSeverity.Error:
        return 'var(--ide-danger)';
      case DiagnosticSeverity.Warning:
        return 'var(--ide-warning)';
      default:
        return 'var(--ide-text-subtle)';
    }
  })();

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
    <li>
      <button
        type="button"
        onClick={handleClick}
        className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-100"
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--ide-surface-hover)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: severityColor }}
          aria-hidden
        />
        <span className="truncate" style={{ color: 'var(--ide-text-primary)' }}>
          {message}
        </span>
        {formattedSource && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
            style={{
              background: 'var(--ide-surface-sunken)',
              color: 'var(--ide-text-subtle)',
            }}
          >
            {formattedSource}
          </span>
        )}
        <span
          className="ml-auto shrink-0 tabular-nums"
          style={{ color: 'var(--ide-text-subtle)' }}
        >
          {line}:{col}
        </span>
      </button>
    </li>
  );
}
