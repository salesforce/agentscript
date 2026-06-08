/**
 * Code Actions Provider - provides quick fixes for AgentScript documents.
 */

import type { CodeAction, Diagnostic, Range } from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import type { DocumentState } from '../document-store.js';
import {
  findSuggestion,
  isNamedMap,
  walkAstExpressions,
} from '@agentscript/language';
import type { AstNodeLike, AstRoot } from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';

import type { TextEdit } from 'vscode-languageserver';

/**
 * Decompose an `@namespace.property` text from CST into its parts.
 * Returns null if the expression is not an AtIdentifier→MemberExpression.
 */
function decomposeAtRef(
  expr: AstNodeLike
): { namespace: string; property: string; nameNode: AstNodeLike } | null {
  if (expr.__kind !== 'MemberExpression') return null;
  const object = (expr as Record<string, unknown>).object as
    | AstNodeLike
    | undefined;
  if (!object || object.__kind !== 'AtIdentifier') return null;
  const namespace = (object as unknown as { name: string }).name;
  const property = (expr as unknown as { property: string }).property;
  if (!namespace || !property) return null;
  return { namespace, property, nameNode: object };
}

/**
 * Build text edits to convert a `topic` block to `subagent`:
 * 1. Rename `topic` → `subagent` keyword
 * 2. Rename `@topic.NAME` → `@subagent.NAME` references across the entire document
 *
 * Field names (actions, reasoning.actions) are the same for both block types.
 */
function buildTopicToSubagentEdits(
  _source: string,
  topicKeywordRange: Range,
  ast: AstRoot | null
): TextEdit[] {
  const edits: TextEdit[] = [];

  // 1. Replace 'topic' keyword
  edits.push({ range: topicKeywordRange, newText: 'subagent' });

  // 2. Rename @topic.NAME → @subagent.NAME across the entire document
  if (ast) {
    const result = findTopicBlockAtLine(ast, topicKeywordRange.start.line);
    if (result) {
      collectTopicRefRenameEdits(ast, result.name, edits);
    }
  }

  return edits;
}

/**
 * Find the topic block entry in the AST that starts on the given line.
 * Returns both the block and its name.
 */
function findTopicBlockAtLine(
  ast: AstRoot,
  line: number
): { block: AstNodeLike; name: string } | null {
  const topicMap = (ast as Record<string, unknown>).topic;
  if (!topicMap || !isNamedMap(topicMap)) return null;

  for (const [name, entry] of topicMap) {
    const block = entry as AstNodeLike;
    const cst = block.__cst as CstMeta | undefined;
    if (!cst) continue;
    // The deprecated diagnostic is on the keyword line. The block's CST range
    // starts at the body (after the keyword), so check the parent mapping_element
    // which covers the full `topic Name: ...` including the keyword.
    const node = cst.node;
    const mappingElement = node?.parent;
    if (mappingElement && mappingElement.startRow === line) {
      return { block, name };
    }
    // Fallback: check if the block range itself starts on the line
    if (cst.range.start.line === line) {
      return { block, name };
    }
  }
  return null;
}

/**
 * Walk the entire document AST, finding `@topic.NAME` references
 * and renaming them to `@subagent.NAME`.
 */
function collectTopicRefRenameEdits(
  ast: AstRoot,
  topicName: string,
  edits: TextEdit[]
): void {
  walkAstExpressions(ast, expr => {
    const ref = decomposeAtRef(expr);
    if (!ref) return;
    if (ref.namespace !== 'topic' || ref.property !== topicName) return;

    const cst = ref.nameNode.__cst as CstMeta | undefined;
    if (!cst) return;

    // Replace 'topic' → 'subagent' in the AtIdentifier (after '@')
    const range = cst.range;
    edits.push({
      range: {
        start: { line: range.start.line, character: range.start.character + 1 },
        end: range.end,
      },
      newText: 'subagent',
    });
  });
}

/**
 * Provide code actions for diagnostics in a range.
 */
export function provideCodeActions(
  state: DocumentState,
  _range: Range,
  diagnostics: Diagnostic[]
): CodeAction[] {
  const actions: CodeAction[] = [];

  try {
    const { uri, source } = state;

    for (const diagnostic of diagnostics) {
      // Quick fix for invalid-modifier and unknown-type diagnostics
      if (
        diagnostic.code === 'invalid-modifier' ||
        diagnostic.code === 'unknown-type'
      ) {
        const found = diagnostic.data?.found as string | undefined;
        const expected = diagnostic.data?.expected as string[] | undefined;
        if (!found || !expected) continue;

        const suggestion = findSuggestion(found, expected);
        if (!suggestion) continue;

        // Find the exact position of the typo text
        const lines = source.split('\n');
        const line = lines[diagnostic.range.start.line];
        if (!line) continue;

        const foundIndex = line.indexOf(found);
        if (foundIndex === -1) continue;

        actions.push({
          title: `Change to '${suggestion}'`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [uri]: [
                {
                  range: {
                    start: {
                      line: diagnostic.range.start.line,
                      character: foundIndex,
                    },
                    end: {
                      line: diagnostic.range.start.line,
                      character: foundIndex + found.length,
                    },
                  },
                  newText: suggestion,
                },
              ],
            },
          },
        });
      }

      // Quick fix for unknown dialect — offer each available dialect
      if (diagnostic.code === 'unknown-dialect') {
        const availableNames = diagnostic.data?.availableNames as
          | string[]
          | undefined;
        if (!availableNames) continue;

        for (const name of availableNames) {
          actions.push({
            title: `Change to '${name}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: availableNames.length === 1,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: diagnostic.range,
                    newText: name,
                  },
                ],
              },
            },
          });
        }
      }

      // Quick fix for deprecated fields — offer replacement
      if (diagnostic.code === 'deprecated-field') {
        const replacement = diagnostic.data?.replacement as string | undefined;
        if (!replacement) continue;

        // For topic→subagent conversion, rename keyword and @topic references
        if (replacement === 'subagent') {
          const edits = buildTopicToSubagentEdits(
            source,
            diagnostic.range,
            state.ast
          );
          if (edits.length > 0) {
            actions.push({
              title: 'Convert to subagent',
              kind: CodeActionKind.QuickFix,
              diagnostics: [diagnostic],
              isPreferred: true,
              edit: { changes: { [uri]: edits } },
            });
          }
        } else {
          actions.push({
            title: `Replace with '${replacement}'`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: diagnostic.range,
                    newText: replacement,
                  },
                ],
              },
            },
          });
        }
      }

      // Quick fix for unused variable — remove the declaration
      if (diagnostic.code === 'unused-variable') {
        const removalRange = diagnostic.data?.removalRange as Range | undefined;
        if (!removalRange) continue;

        // Delete the full line(s) of the variable declaration
        const lines = source.split('\n');
        const startLine = removalRange.start.line;
        const endLine = removalRange.end.line;

        // Include the trailing newline so we don't leave a blank line
        const deleteRange =
          endLine + 1 < lines.length
            ? {
                start: { line: startLine, character: 0 },
                end: { line: endLine + 1, character: 0 },
              }
            : ({
                start: { line: startLine, character: 0 },
                end: {
                  line: endLine,
                  character: lines[endLine]?.length ?? 0,
                },
              } satisfies Range);

        actions.push({
          title: `Remove unused variable`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [uri]: [{ range: deleteRange, newText: '' }],
            },
          },
        });
      }

      // Quick fix for version mismatch — offer each suggested version
      if (diagnostic.code === 'invalid-version') {
        const suggestedVersions = diagnostic.data?.suggestedVersions as
          | string[]
          | undefined;
        if (!suggestedVersions || suggestedVersions.length === 0) continue;

        for (let i = 0; i < suggestedVersions.length; i++) {
          const version = suggestedVersions[i];
          const detail = version.includes('.')
            ? `min v${version}`
            : `latest v${version}`;
          actions.push({
            title: `Set version to '${version}' (${detail})`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: i === 0,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: diagnostic.range,
                    newText: version,
                  },
                ],
              },
            },
          });
        }
      }
    }
  } catch (error) {
    console.error('[CodeActions] Error providing code actions:', error);
  }

  return actions;
}
