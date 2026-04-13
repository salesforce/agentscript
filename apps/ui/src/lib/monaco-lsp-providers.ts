/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import * as monaco from 'monaco-editor';
import type {
  CodeAction,
  CompletionItem,
  CompletionList,
  Diagnostic,
  Hover,
  Location,
  SemanticTokens as LspSemanticTokens,
} from 'vscode-languageserver-protocol';
import { TOKEN_TYPES, TOKEN_MODIFIERS } from '@agentscript/lsp';
import { AgentScriptLspClient } from './lsp-client';
import { useAppStore } from '~/store';
import type { Diagnostic as StoreDiagnostic } from '~/store/diagnostics';

function toMonacoRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function toMonacoCompletionKind(
  kind?: number
): monaco.languages.CompletionItemKind {
  if (!kind) return monaco.languages.CompletionItemKind.Text;
  return kind as monaco.languages.CompletionItemKind;
}

function toMonacoCompletionItem(
  item: CompletionItem
): monaco.languages.CompletionItem {
  const isSnippet = item.insertTextFormat === 2; // InsertTextFormat.Snippet

  // Extract text and range from textEdit when present (LSP spec: textEdit
  // takes precedence over insertText).
  const textEdit = item.textEdit as
    | {
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }
    | undefined;

  const insertText = textEdit?.newText ?? item.insertText ?? '';
  const range = textEdit?.range ? toMonacoRange(textEdit.range) : undefined;

  return {
    label:
      typeof item.label === 'string' ? item.label : (item.label.label ?? ''),
    kind: toMonacoCompletionKind(item.kind),
    detail: item.detail,
    documentation:
      typeof item.documentation === 'string'
        ? item.documentation
        : item.documentation?.value,
    insertText,
    insertTextRules: isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    range,
    sortText: item.sortText,
    filterText: item.filterText,
  };
}

function markerSeverity(severity?: number): monaco.MarkerSeverity {
  switch (severity) {
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    case 1:
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function toMonacoSemanticTokens(
  tokens: LspSemanticTokens | null
): monaco.languages.SemanticTokens {
  const data = tokens?.data ?? [];
  return {
    resultId: tokens?.resultId,
    data: Uint32Array.from(data),
  };
}

export interface MonacoLspRegistration {
  dispose: () => void;
  sync: (model: monaco.editor.ITextModel, isPrimary?: boolean) => Promise<void>;
  /** Signal Monaco to re-fetch semantic tokens (e.g. after LSP init). */
  refreshSemanticTokens: () => void;
}

export function registerMonacoLspProviders(
  client: AgentScriptLspClient
): MonacoLspRegistration {
  const disposables: monaco.IDisposable[] = [];

  // Track the primary document URI so we only update the diagnostics store
  // and CST/compile output for the main editor, not for secondary editors
  // (e.g. the EMIT or COMPILED debug panels which also sync with the LSP).
  let primaryDocumentUri: string | null = null;

  client.onDiagnostics(params => {
    const model = monaco.editor.getModel(monaco.Uri.parse(params.uri));
    if (!model) return;

    const markers = (params.diagnostics as Diagnostic[]).map(diag => ({
      severity: markerSeverity(diag.severity),
      message: diag.message,
      startLineNumber: diag.range.start.line + 1,
      startColumn: diag.range.start.character + 1,
      endLineNumber: diag.range.end.line + 1,
      endColumn: diag.range.end.character + 1,
      code: diag.code ? String(diag.code) : undefined,
      source: diag.source,
      // DiagnosticTag values (1=Unnecessary, 2=Deprecated) match monaco.MarkerTag
      ...(diag.tags
        ? {
            tags: diag.tags.filter(
              (t): t is monaco.MarkerTag => t === 1 || t === 2
            ),
          }
        : {}),
    }));

    monaco.editor.setModelMarkers(model, 'agentscript-lsp', markers);

    // Only update the diagnostics store for the primary document.
    // Secondary documents (emit/compiled debug panels) should not overwrite
    // the main document's diagnostics.
    if (params.uri === primaryDocumentUri) {
      useAppStore
        .getState()
        .setDiagnostics(params.diagnostics as unknown as StoreDiagnostic[]);
    }
  });

  // Receive compile output from LSP and update the store.
  // Only accept results from the primary document.
  client.onCompileResult(params => {
    if (primaryDocumentUri && params.uri !== primaryDocumentUri) return;

    useAppStore.getState().setLspCompileResult(params.compileOutput);
  });

  disposables.push(
    monaco.languages.registerHoverProvider('agentscript', {
      async provideHover(
        model,
        position
      ): Promise<monaco.languages.Hover | null> {
        const result = (await client.hover({
          textDocument: { uri: model.uri.toString() },
          position: {
            line: position.lineNumber - 1,
            character: position.column - 1,
          },
        })) as Hover | null;
        if (!result) return null;

        const contents = Array.isArray(result.contents)
          ? result.contents.map(c =>
              typeof c === 'string' ? { value: c } : { value: c.value }
            )
          : typeof result.contents === 'string'
            ? [{ value: result.contents }]
            : 'value' in result.contents
              ? [{ value: result.contents.value }]
              : [
                  {
                    value:
                      result.contents.language + '\n' + result.contents.value,
                  },
                ];

        return {
          range: result.range ? toMonacoRange(result.range) : undefined,
          contents,
        };
      },
    })
  );

  disposables.push(
    monaco.languages.registerCompletionItemProvider('agentscript', {
      triggerCharacters: ['@', '.', ':', '#', '='],
      async provideCompletionItems(model, position, context) {
        const triggerKind =
          context.triggerKind ===
          monaco.languages.CompletionTriggerKind.TriggerCharacter
            ? 2
            : 1;
        const result = (await client.completion({
          textDocument: { uri: model.uri.toString() },
          position: {
            line: position.lineNumber - 1,
            character: position.column - 1,
          },
          context: {
            triggerKind,
            triggerCharacter: context.triggerCharacter,
          },
        })) as CompletionList | null;

        if (!result) return { suggestions: [] };
        const items = Array.isArray(result) ? result : result.items;
        return {
          suggestions: items.map(toMonacoCompletionItem),
        };
      },
    })
  );

  disposables.push(
    monaco.languages.registerDefinitionProvider('agentscript', {
      async provideDefinition(model, position) {
        const result = await client.definition({
          textDocument: { uri: model.uri.toString() },
          position: {
            line: position.lineNumber - 1,
            character: position.column - 1,
          },
        });
        if (!result) return [];

        const list = Array.isArray(result) ? result : [result];
        return list.map(def => ({
          uri: monaco.Uri.parse(def.uri),
          range: toMonacoRange(def.range),
        }));
      },
    })
  );

  disposables.push(
    monaco.languages.registerReferenceProvider('agentscript', {
      async provideReferences(model, position, context) {
        const refs = (await client.references({
          textDocument: { uri: model.uri.toString() },
          position: {
            line: position.lineNumber - 1,
            character: position.column - 1,
          },
          context: { includeDeclaration: context.includeDeclaration },
        })) as Location[];

        return refs.map(r => ({
          uri: monaco.Uri.parse(r.uri),
          range: toMonacoRange(r.range),
        }));
      },
    })
  );

  disposables.push(
    monaco.languages.registerRenameProvider('agentscript', {
      async provideRenameEdits(model, position, newName) {
        const result = (await client.rename({
          textDocument: { uri: model.uri.toString() },
          position: {
            line: position.lineNumber - 1,
            character: position.column - 1,
          },
          newName,
        })) as {
          changes?: Record<
            string,
            Array<{
              range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
              newText: string;
            }>
          >;
        } | null;

        if (!result?.changes) return { edits: [] };
        const edits: monaco.languages.IWorkspaceTextEdit[] = [];
        for (const [uri, changes] of Object.entries(result.changes)) {
          for (const change of changes) {
            edits.push({
              resource: monaco.Uri.parse(uri),
              textEdit: {
                range: toMonacoRange(change.range),
                text: change.newText,
              },
              versionId: undefined,
            });
          }
        }
        return { edits };
      },
    })
  );

  disposables.push(
    monaco.languages.registerCodeActionProvider('agentscript', {
      async provideCodeActions(model, range, context) {
        const uri = model.uri.toString();
        const markerCodes = new Set(
          context.markers
            .map(marker => marker.code)
            .filter((code): code is string => typeof code === 'string')
        );
        const diagnostics = client
          .getDiagnosticsForUri(uri)
          .filter(diagnostic => {
            if (markerCodes.size > 0 && diagnostic.code) {
              const codeString = String(diagnostic.code);
              if (!markerCodes.has(codeString)) return false;
            }
            const start = diagnostic.range.start;
            const end = diagnostic.range.end;
            const afterRangeStart =
              start.line > range.endLineNumber - 1 ||
              (start.line === range.endLineNumber - 1 &&
                start.character > range.endColumn - 1);
            const beforeRangeEnd =
              end.line < range.startLineNumber - 1 ||
              (end.line === range.startLineNumber - 1 &&
                end.character < range.startColumn - 1);
            return !(afterRangeStart || beforeRangeEnd);
          });

        const actions = (await client.codeActions({
          textDocument: { uri },
          range: {
            start: {
              line: range.startLineNumber - 1,
              character: range.startColumn - 1,
            },
            end: {
              line: range.endLineNumber - 1,
              character: range.endColumn - 1,
            },
          },
          context: { diagnostics },
        })) as CodeAction[];

        const mapped = actions
          .filter(a => a.edit?.changes)
          .map(action => {
            const edits: monaco.languages.IWorkspaceTextEdit[] = [];
            const changes = action.edit?.changes ?? {};
            for (const [uri, textEdits] of Object.entries(changes)) {
              for (const edit of textEdits) {
                edits.push({
                  resource: monaco.Uri.parse(uri),
                  textEdit: {
                    range: toMonacoRange(edit.range),
                    text: edit.newText,
                  },
                  versionId: undefined,
                });
              }
            }

            return {
              title: action.title,
              kind: action.kind,
              edit: { edits },
            } as monaco.languages.CodeAction;
          });

        return {
          actions: mapped,
          dispose() {},
        };
      },
    })
  );

  // Emitter lets us signal Monaco to re-fetch semantic tokens on demand
  // (e.g. after LSP initialization completes and the first request timed out).
  const semanticTokensEmitter = new monaco.Emitter<void>();

  disposables.push(semanticTokensEmitter);
  disposables.push(
    monaco.languages.registerDocumentSemanticTokensProvider('agentscript', {
      onDidChange: semanticTokensEmitter.event,
      getLegend() {
        return {
          tokenTypes: [...TOKEN_TYPES],
          tokenModifiers: [...TOKEN_MODIFIERS],
        };
      },
      async provideDocumentSemanticTokens(
        model,
        _lastResultId,
        _token
      ): Promise<monaco.languages.SemanticTokens> {
        // LSP-only semantic tokens (no local fallback).
        try {
          const lspRequest = client.semanticTokens(
            model.uri.toString()
          ) as Promise<LspSemanticTokens | null>;
          const result = (await Promise.race([
            lspRequest,
            new Promise<null>(resolve => setTimeout(() => resolve(null), 400)),
          ])) as LspSemanticTokens | null;
          if (result && result.data.length > 0) {
            return toMonacoSemanticTokens(result);
          }
        } catch {
          // Return empty tokens on LSP errors/timeouts.
        }

        return {
          data: new Uint32Array(),
          resultId: undefined,
        };
      },
      releaseDocumentSemanticTokens() {},
    })
  );

  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
    sync: async (model, isPrimary = false) => {
      const uri = model.uri.toString();
      if (isPrimary || primaryDocumentUri === null) {
        primaryDocumentUri = uri;
      }
      await client.syncDocument(uri, model.getValue());
    },
    refreshSemanticTokens: () => {
      semanticTokensEmitter.fire();
    },
  };
}
