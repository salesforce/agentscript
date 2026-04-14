/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useCallback } from 'react';
import { CheckIcon } from 'lucide-react';
import { useLocation } from 'react-router';
import { useAppStore } from '~/store';
import { Button } from '~/components/ui/button';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '~/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import NumberFlow from '@number-flow/react';
import { dialects } from '~/lib/dialects';
import {
  detectDialectId,
  getDialectInfo,
  setDialectAnnotation,
} from '~/lib/detect-dialect';

export function IDEFooter() {
  const location = useLocation();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [pendingDialect, setPendingDialect] = useState<string | null>(null);
  const errorCount = useAppStore(state => state.diagnostics.errorCount);
  const warningCount = useAppStore(state => state.diagnostics.warningCount);
  const editorSelection = useAppStore(state => state.source.editorSelection);
  const monacoEditor = useAppStore(state => state.source.monacoEditor);
  const toggleBottomPanel = useAppStore(state => state.toggleBottomPanel);
  const setBottomPanelTab = useAppStore(state => state.setBottomPanelTab);
  const agentscript = useAppStore(state => state.source.agentscript);
  const setAgentScript = useAppStore(state => state.setAgentScript);

  const dialectId = detectDialectId(agentscript);
  const currentDialect = getDialectInfo(dialectId);

  // Show cursor position only in script view
  const isScriptView = location.pathname.includes('/script');

  // Calculate selected character count
  const selectedCount =
    editorSelection && monacoEditor
      ? (() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const model = (monacoEditor as any).getModel();
          if (!model) return 0;

          const { startLineNumber, startColumn, endLineNumber, endColumn } =
            editorSelection;

          if (startLineNumber === endLineNumber && startColumn === endColumn) {
            return 0;
          }

          const range = {
            startLineNumber,
            startColumn,
            endLineNumber,
            endColumn,
          };
          const selectedText = model.getValueInRange(range);
          return selectedText.length;
        })()
      : 0;

  const handleSelectDialect = useCallback(
    (newId: string) => {
      setSelectorOpen(false);
      if (newId === dialectId) return;
      setPendingDialect(newId);
    },
    [dialectId]
  );

  const confirmUpdate = useCallback(() => {
    if (!pendingDialect) return;
    const updated = setDialectAnnotation(agentscript ?? '', pendingDialect);
    setAgentScript(updated);
    setPendingDialect(null);
  }, [pendingDialect, agentscript, setAgentScript]);

  const cancelSwitch = useCallback(() => {
    setPendingDialect(null);
  }, []);

  return (
    <>
      <footer
        className="flex h-6 items-stretch justify-between border-t pl-4 pr-5 text-[11px]"
        style={{
          background: 'var(--ide-surface-elevated)',
          borderColor: 'var(--ide-border-subtle)',
          color: 'var(--ide-text-muted)',
        }}
      >
        {/* Left section - Diagnostics as colored dots + neutral counts */}
        <button
          onClick={() => {
            setBottomPanelTab('problems');
            toggleBottomPanel();
          }}
          className="flex h-full items-center gap-2.5 px-1.5 pb-1 transition-colors duration-150 cursor-pointer"
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--ide-surface-hover)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
          }}
          style={{ color: 'var(--ide-text-muted)' }}
        >
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--ide-danger)' }}
            />
            <NumberFlow
              value={errorCount}
              className="font-medium tabular-nums"
              animated
            />
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--ide-warning)' }}
            />
            <NumberFlow
              value={warningCount}
              className="font-medium tabular-nums"
              animated
            />
          </span>
        </button>

        {/* Right section - Dialect + Cursor position */}
        <div
          className="flex items-center gap-4 pb-0.5"
          style={{ color: 'var(--ide-text-muted)' }}
        >
          <button
            className="flex h-full items-center gap-1 px-1.5 transition-colors duration-150 cursor-pointer"
            onClick={() => setSelectorOpen(true)}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--ide-surface-hover)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span>
              {currentDialect
                ? `${currentDialect.displayName} v${currentDialect.version}`
                : 'Select Dialect'}
            </span>
          </button>

          {/* Cursor position */}
          {isScriptView && editorSelection && (
            <span className="tabular-nums">
              Ln {editorSelection.endLineNumber}, Col{' '}
              {editorSelection.endColumn}
              {selectedCount > 0 && ` · ${selectedCount} sel`}
            </span>
          )}
        </div>
      </footer>

      {/* Dialect selector command palette */}
      <CommandDialog
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        title="Select Dialect Mode"
        description="Select a dialect for parsing and validation"
        showCloseButton={false}
      >
        <CommandInput placeholder="Select dialect mode..." />
        <CommandList>
          <CommandEmpty>No dialect found.</CommandEmpty>
          <CommandGroup heading="Dialects">
            {dialects.map(d => (
              <CommandItem
                key={d.name}
                value={d.name}
                onSelect={() => handleSelectDialect(d.name)}
                className="flex items-center justify-between"
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span>{d.displayName}</span>
                    <span className="text-muted-foreground text-xs">
                      v{d.version}
                    </span>
                  </div>
                  {d.description && (
                    <span className="text-muted-foreground text-xs">
                      {d.description}
                    </span>
                  )}
                </div>
                {d.name === dialectId && (
                  <CheckIcon className="h-4 w-4 text-blue-500" />
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Confirmation dialog */}
      <Dialog
        open={pendingDialect !== null}
        onOpenChange={open => {
          if (!open) setPendingDialect(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Dialect</DialogTitle>
            <DialogDescription>
              Switch to{' '}
              <strong>
                {getDialectInfo(pendingDialect ?? '')?.displayName}
              </strong>
              . Would you like to update the{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">
                # @dialect:
              </code>{' '}
              annotation in your script?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelSwitch}>
              Cancel
            </Button>
            <Button onClick={confirmUpdate}>Yes, update script</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
