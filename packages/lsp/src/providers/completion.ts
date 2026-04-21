/**
 * Completion Provider - provides completion items for AgentScript documents.
 */

import type { CompletionItem, CompletionList } from 'vscode-languageserver';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import type { DocumentState } from '../document-store.js';
import {
  findEnclosingScope,
  getAvailableNamespaces,
  getCompletionCandidates,
  getFieldCompletions,
  getValueCompletions,
  getWithCompletions,
  positionIndexKey,
  SymbolKind,
  symbolTableKey,
} from '@agentscript/language';
import type { DialectConfig } from '@agentscript/language';

/**
 * Map dialect SymbolKind to LSP CompletionItemKind.
 */
function toCompletionItemKind(symbolKind: SymbolKind): CompletionItemKind {
  switch (symbolKind) {
    case SymbolKind.Variable:
      return CompletionItemKind.Variable;
    case SymbolKind.Field:
      return CompletionItemKind.Field;
    case SymbolKind.Method:
      return CompletionItemKind.Method;
    case SymbolKind.Class:
      return CompletionItemKind.Class;
    case SymbolKind.Interface:
      return CompletionItemKind.Interface;
    case SymbolKind.Namespace:
      return CompletionItemKind.Module;
    case SymbolKind.Property:
      return CompletionItemKind.Property;
    case SymbolKind.Object:
      return CompletionItemKind.Struct;
    case SymbolKind.TypeParameter:
      return CompletionItemKind.TypeParameter;
    case SymbolKind.Constant:
      return CompletionItemKind.Keyword;
    default:
      return CompletionItemKind.Text;
  }
}

/**
 * Provide completion items at a position.
 */
export function provideCompletion(
  state: DocumentState,
  line: number,
  character: number,
  _triggerCharacter?: string,
  dialects?: readonly DialectConfig[]
): CompletionList | null {
  try {
    const lineContent = state.source.split('\n')[line] ?? '';
    const textBeforeCursor = lineContent.substring(0, character);

    // Dialect annotation completions in the first 10 lines
    if (line < 10 && dialects && dialects.length > 0) {
      const dialectItems = provideDialectAnnotationCompletion(
        textBeforeCursor,
        line,
        character,
        dialects
      );
      if (dialectItems) return dialectItems;
    }

    const { ast, store, service } = state;
    if (!ast || !store) {
      return { isIncomplete: false, items: [] };
    }

    const index = store.get(positionIndexKey);
    const schemaContext = service.schemaContext;
    const scope = findEnclosingScope(
      ast,
      line,
      character,
      index,
      state.source,
      schemaContext
    );
    const symbols = store.get(symbolTableKey);

    let items: CompletionItem[] = [];

    // Handle @expression completions (same flow as master Monaco provider)
    const exprMatch = textBeforeCursor.match(/@(\w*)\.?(\w*)$/);
    if (exprMatch) {
      const [fullMatch, namespacePart] = exprMatch;
      const hasDot = fullMatch.includes('.');
      const matchStart = character - fullMatch.length;

      const candidates = hasDot
        ? getCompletionCandidates(
            ast,
            namespacePart,
            schemaContext,
            scope,
            symbols,
            line,
            character
          )
        : getAvailableNamespaces(schemaContext, scope);

      const replaceStartChar = hasDot
        ? matchStart + fullMatch.indexOf('.') + 1
        : matchStart + 1; // after '@'

      items = candidates.map((candidate, idx) => ({
        label: candidate.name,
        kind: toCompletionItemKind(candidate.kind),
        detail: candidate.detail,
        documentation: candidate.documentation,
        insertText: candidate.name,
        textEdit: {
          range: {
            start: { line, character: replaceStartChar },
            end: { line, character },
          },
          newText: candidate.name,
        },
        sortText: String(idx).padStart(4, '0'),
      }));
    } else if (textBeforeCursor.includes(':')) {
      // Value-position completions (e.g., type keywords after `name: ` in a TypedMap)
      if (textBeforeCursor.includes('@')) {
        return { isIncomplete: false, items: [] };
      }

      const valueCandidates = getValueCompletions(
        line,
        character,
        schemaContext,
        state.source
      );

      if (valueCandidates.length > 0) {
        const colonIdx = textBeforeCursor.lastIndexOf(':');
        const afterColon = textBeforeCursor.substring(colonIdx + 1).trim();
        const valueStart = character - afterColon.length;

        items = valueCandidates.map((candidate, idx) => ({
          label: candidate.name,
          kind: toCompletionItemKind(candidate.kind),
          detail: candidate.detail,
          documentation: candidate.documentation,
          insertText: candidate.name,
          textEdit: {
            range: {
              start: { line, character: valueStart },
              end: { line, character },
            },
            newText: candidate.name,
          },
          sortText: String(idx).padStart(4, '0'),
        }));
      }
    } else {
      // ── `with` parameter name completions ──────────────────────────
      //
      // When the cursor is on a `with` keyword line inside a reasoning
      // action binding or a `run` statement, suggest the input parameter
      // names defined on the referenced action.
      //
      // Example — the user is editing inside a reasoning actions block:
      //
      //   actions:
      //     escalate_ticket: @actions.escalate_ticket
      //       with |          <-- cursor here, suggest input params
      //
      // `getWithCompletions` (from @agentscript/language) resolves the
      // enclosing `@actions.escalate_ticket` reference, finds its action
      // definition (which declares `inputs:`), and returns the input
      // parameter names as CompletionCandidate[].
      //
      // If the cursor is NOT on a `with` line, or if the referenced
      // action has no inputs, `getWithCompletions` returns an empty array
      // and we fall through to the normal field/block keyword completions.
      const withCandidates = getWithCompletions(
        ast,
        line,
        character,
        schemaContext,
        state.source
      );

      if (withCandidates.length > 0) {
        // Extract the partial parameter name the user has already typed
        // after `with `, so the text edit replaces only that partial.
        //
        // For `"        with ord"`, partial = "with ord", inputPartial = "ord".
        // The text edit range starts at (character - "ord".length) so that
        // the editor replaces "ord" with the full parameter name like
        // "order_number".
        const partial = textBeforeCursor.trim();
        const withMatch = partial.match(/^with\s+(\w*)$/);
        const inputPartial = withMatch?.[1] ?? '';
        const inputStart = character - inputPartial.length;

        // Convert each CompletionCandidate into an LSP CompletionItem
        // with a textEdit that replaces the partial input name.
        items = withCandidates.map((candidate, idx) => ({
          label: candidate.name,
          kind: toCompletionItemKind(candidate.kind),
          detail: candidate.detail,
          documentation: candidate.documentation,
          insertText: candidate.name,
          textEdit: {
            range: {
              start: { line, character: inputStart },
              end: { line, character },
            },
            newText: candidate.name,
          },
          sortText: String(idx).padStart(4, '0'),
        }));
      } else {
        // Field/block keyword completions
        const partial = textBeforeCursor.trim();
        const indentLength = textBeforeCursor.length - partial.length;
        const candidates = getFieldCompletions(
          ast,
          line,
          character,
          schemaContext,
          state.source
        );
        items = candidates.map((candidate, idx) => {
          const hasSnippet = !!candidate.snippet;
          const newText = hasSnippet
            ? adjustSnippetIndentation(candidate.snippet!, indentLength)
            : candidate.name + ': ';
          return {
            label: candidate.name,
            kind: toCompletionItemKind(candidate.kind),
            detail: candidate.detail,
            documentation: candidate.documentation,
            insertText: newText,
            insertTextFormat: hasSnippet
              ? InsertTextFormat.Snippet
              : InsertTextFormat.PlainText,
            textEdit: {
              range: {
                start: { line, character: indentLength },
                end: { line, character },
              },
              newText,
            },
            sortText: String(idx).padStart(4, '0'),
          };
        });
      }
    }

    return {
      isIncomplete: false,
      items,
    };
  } catch (error) {
    console.error('[Completion] Error providing completions:', error);
    return { isIncomplete: false, items: [] };
  }
}

/**
 * Adjust a snippet's indentation to match the cursor's current column.
 * Line 1 stays as-is (replaces the current line content from indentLength).
 * Lines 2+ get the base indentation prepended.
 */
function adjustSnippetIndentation(snippet: string, baseIndent: number): string {
  const lines = snippet.split('\n');
  if (lines.length <= 1) return snippet;

  const indentStr = ' '.repeat(baseIndent);
  return lines.map((ln, i) => (i === 0 ? ln : indentStr + ln)).join('\n');
}

/**
 * Provide `# @dialect: NAME=VERSION` completions when the user is typing a
 * comment in the first 10 lines of the document.
 *
 * Triggers on:
 *   - `#`                    → full `# @dialect: ${1:NAME}=${2:VERSION}` snippet
 *   - `# @dialect: `         → `NAME=VERSION` per dialect
 *   - `# @dialect: NAME=`    → version completions for the matched dialect
 */
function provideDialectAnnotationCompletion(
  textBeforeCursor: string,
  line: number,
  character: number,
  dialects: readonly DialectConfig[]
): CompletionList | null {
  const trimmed = textBeforeCursor.trimStart();

  // Case 3: `# @dialect: NAME=` — complete the version
  const versionMatch = trimmed.match(/^#\s*@dialect:\s*(\w+)=(\d*)$/i);
  if (versionMatch) {
    const name = versionMatch[1].toLowerCase();
    const partialVersion = versionMatch[2];
    const versionStart = character - partialVersion.length;
    const dialect = dialects.find(d => d.name.toLowerCase() === name);
    if (!dialect) return null;

    // Offer major-only and major.minor versions.
    // major = any version in that major; major.minor = minimum minor version.
    const parts = dialect.version.split('.');
    const major = parts[0];
    const majorMinor = `${parts[0]}.${parts[1] ?? 0}`;
    const versions = [
      { label: major, detail: `any v${major}.x` },
      { label: majorMinor, detail: `minimum v${majorMinor}` },
    ];

    // Deduplicate if major.minor equals major (e.g., version "2")
    const unique = versions.filter(
      (v, i, arr) => arr.findIndex(x => x.label === v.label) === i
    );

    const items: CompletionItem[] = unique
      .filter(v => v.label.startsWith(partialVersion))
      .map((v, idx) => ({
        label: v.label,
        kind: CompletionItemKind.Constant,
        detail: v.detail,
        textEdit: {
          range: {
            start: { line, character: versionStart },
            end: { line, character },
          },
          newText: v.label,
        },
        sortText: String(idx).padStart(4, '0'),
      }));
    return { isIncomplete: false, items };
  }

  // Case 2: `# @dialect: ` (or partial name) — complete with NAME=VERSION
  const nameMatch = trimmed.match(/^#\s*@dialect:\s*(\w*)$/i);
  if (nameMatch) {
    const partial = nameMatch[1].toLowerCase();
    const nameStart = character - partial.length;
    const items: CompletionItem[] = dialects
      .filter(d => d.name.toLowerCase().startsWith(partial))
      .map((d, idx) => {
        const parts = d.version.split('.');
        const majorMinor = `${parts[0]}.${parts[1] ?? 0}`;
        return {
          label: `${d.name}=${majorMinor}`,
          kind: CompletionItemKind.EnumMember,
          detail: `${d.name} dialect (v${d.version})`,
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: {
            range: {
              start: { line, character: nameStart },
              end: { line, character },
            },
            newText: `${d.name}=\${1:${majorMinor}}`,
          },
          sortText: String(idx).padStart(4, '0'),
        };
      });
    return { isIncomplete: false, items };
  }

  // Case 1: `#` (possibly with `@` or `@d...`) — offer full annotation snippet
  if (/^#\s*@?\w*$/.test(trimmed)) {
    const lineStart = character - trimmed.length;
    const items: CompletionItem[] = dialects.map((d, idx) => {
      const parts = d.version.split('.');
      const majorMinor = `${parts[0]}.${parts[1] ?? 0}`;
      return {
        label: `# @dialect: ${d.name}`,
        kind: CompletionItemKind.Snippet,
        detail: `Set dialect to ${d.name} (v${d.version})`,
        filterText: trimmed,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
          range: {
            start: { line, character: lineStart },
            end: { line, character },
          },
          newText: `# @dialect: \${1:${d.name}}=\${2:${majorMinor}}`,
        },
        sortText: String(idx).padStart(4, '0'),
      };
    });
    return { isIncomplete: false, items };
  }

  return null;
}
