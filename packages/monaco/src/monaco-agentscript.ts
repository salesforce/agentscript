/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import * as monaco from 'monaco-editor';
import {
  initializeParser,
  getHighlightCaptures,
  isParserDisabled,
} from './parser-api';
import { createHoverProvider } from './hover-provider';
import type { SchemaFieldInfo } from './schema-resolver';
import { lightThemeColors, darkThemeColors, buildMonacoRules } from './theme';
import {
  increaseIndentPattern,
  decreaseIndentPattern,
  onEnterRules as sharedOnEnterRules,
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  generateSemanticTokens,
} from '@agentscript/language';

// Language configuration for AgentScript
export const languageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '#',
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  indentationRules: {
    increaseIndentPattern: new RegExp(increaseIndentPattern),
    decreaseIndentPattern: new RegExp(decreaseIndentPattern),
  },
  onEnterRules: sharedOnEnterRules.map(rule => ({
    beforeText: new RegExp(rule.beforeText),
    ...(rule.afterText ? { afterText: new RegExp(rule.afterText) } : {}),
    ...(rule.previousLineText
      ? { previousLineText: new RegExp(rule.previousLineText) }
      : {}),
    action: {
      indentAction:
        rule.action === 'indent'
          ? monaco.languages.IndentAction.Indent
          : rule.action === 'outdent'
            ? monaco.languages.IndentAction.Outdent
            : monaco.languages.IndentAction.None,
      ...(rule.appendText ? { appendText: rule.appendText } : {}),
    },
  })),
};

// State class for Monaco tokenizer
class AgentScriptState implements monaco.languages.IState {
  constructor() {}

  clone(): monaco.languages.IState {
    return new AgentScriptState();
  }

  equals(_other: monaco.languages.IState): boolean {
    return true;
  }
}

// Build fallback rules for the basic tokenizer (comment/string only).
// These use `.agentscript` suffix to match the basic tokenizer scopes.
function buildFallbackRules(
  colors: typeof lightThemeColors
): monaco.editor.ITokenThemeRule[] {
  const c = colors;
  return [
    {
      token: 'comment.agentscript',
      foreground: c.comment.foreground,
      fontStyle: 'italic',
    },
    {
      token: 'keyword.agentscript',
      foreground: c.keyword.foreground,
      fontStyle: 'bold',
    },
    { token: 'string.agentscript', foreground: c.string.foreground },
    { token: 'number.agentscript', foreground: c.number.foreground },
    { token: 'operator.agentscript', foreground: c.operator.foreground },
    { token: 'variable.agentscript', foreground: c.variable.foreground },
    {
      token: 'function.agentscript',
      foreground: c.function.foreground,
      fontStyle: 'bold',
    },
  ];
}

// Monaco theme for AgentScript (Light) -- colors from theme.ts
export const lightTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    ...buildFallbackRules(lightThemeColors),
    ...buildMonacoRules(lightThemeColors),
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#000000',
    'editorLineNumber.foreground': '#237893',
    'editorCursor.foreground': '#000000',
    'diffEditor.insertedTextBackground': '#9be9a855',
    'diffEditor.removedTextBackground': '#ff000033',
    'diffEditor.insertedLineBackground': '#9be9a833',
    'diffEditor.removedLineBackground': '#ff000020',
    // Disable bracket highlighting -- make colors fully transparent
    'editorBracketMatch.background': '#00000000',
    'editorBracketMatch.border': '#00000000',
    'editorBracketHighlight.foreground1': '#00000000',
    'editorBracketHighlight.foreground2': '#00000000',
    'editorBracketHighlight.foreground3': '#00000000',
    'editorBracketHighlight.foreground4': '#00000000',
    'editorBracketHighlight.foreground5': '#00000000',
    'editorBracketHighlight.foreground6': '#00000000',
    'editorBracketPairGuide.activeBackground1': '#00000000',
    'editorBracketPairGuide.activeBackground2': '#00000000',
    'editorBracketPairGuide.activeBackground3': '#00000000',
    'editorBracketPairGuide.activeBackground4': '#00000000',
    'editorBracketPairGuide.activeBackground5': '#00000000',
    'editorBracketPairGuide.activeBackground6': '#00000000',
    'editorBracketPairGuide.background1': '#00000000',
    'editorBracketPairGuide.background2': '#00000000',
    'editorBracketPairGuide.background3': '#00000000',
    'editorBracketPairGuide.background4': '#00000000',
    'editorBracketPairGuide.background5': '#00000000',
    'editorBracketPairGuide.background6': '#00000000',
  },
};

// Monaco theme for AgentScript (Dark) -- colors from theme.ts
export const darkTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    ...buildFallbackRules(darkThemeColors),
    ...buildMonacoRules(darkThemeColors),
  ],
  colors: {
    'editor.background': '#121314',
    'editor.foreground': '#d4d4d4',
    'editorLineNumber.foreground': '#858585',
    'editorCursor.foreground': '#aeafad',
    'diffEditor.insertedTextBackground': '#40c46355',
    'diffEditor.removedTextBackground': '#ff000033',
    'diffEditor.insertedLineBackground': '#40c46333',
    'diffEditor.removedLineBackground': '#ff000020',
    // Disable bracket highlighting -- make colors fully transparent
    'editorBracketMatch.background': '#00000000',
    'editorBracketMatch.border': '#00000000',
    'editorBracketHighlight.foreground1': '#00000000',
    'editorBracketHighlight.foreground2': '#00000000',
    'editorBracketHighlight.foreground3': '#00000000',
    'editorBracketHighlight.foreground4': '#00000000',
    'editorBracketHighlight.foreground5': '#00000000',
    'editorBracketHighlight.foreground6': '#00000000',
    'editorBracketPairGuide.activeBackground1': '#00000000',
    'editorBracketPairGuide.activeBackground2': '#00000000',
    'editorBracketPairGuide.activeBackground3': '#00000000',
    'editorBracketPairGuide.activeBackground4': '#00000000',
    'editorBracketPairGuide.activeBackground5': '#00000000',
    'editorBracketPairGuide.activeBackground6': '#00000000',
    'editorBracketPairGuide.background1': '#00000000',
    'editorBracketPairGuide.background2': '#00000000',
    'editorBracketPairGuide.background3': '#00000000',
    'editorBracketPairGuide.background4': '#00000000',
    'editorBracketPairGuide.background5': '#00000000',
    'editorBracketPairGuide.background6': '#00000000',
  },
};

// Keep backward compatibility
export const theme = lightTheme;

// Encode semantic tokens in Monaco's required format
// Monaco expects a Uint32Array where each token is represented by 5 numbers:
// [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
// The deltas are relative to the previous token
function encodeSemanticTokens(
  tokens: {
    line: number;
    startChar: number;
    length: number;
    tokenType: number;
    tokenModifiers: number;
  }[]
): Uint32Array {
  // Sort tokens by line, then by startChar, then by length (longest first)
  tokens.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.startChar !== b.startChar) return a.startChar - b.startChar;
    return b.length - a.length; // Longer tokens first (more specific)
  });

  // Deduplicate overlapping tokens at the same position.
  // Later patterns have higher priority, so when two tokens cover the same
  // range, we keep the later one (last wins). For tokens of different lengths
  // at the same start position, the longer (more specific) token wins since
  // it was sorted first.
  const deduped: typeof tokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    if (!current) continue;

    if (deduped.length === 0) {
      deduped.push(current);
      continue;
    }

    const prev = deduped[deduped.length - 1];
    if (!prev) {
      deduped.push(current);
      continue;
    }
    const prevEnd = prev.startChar + prev.length;

    if (current.line === prev.line && current.startChar < prevEnd) {
      // Same position and length: later pattern wins (replace previous)
      if (current.length === prev.length) {
        deduped[deduped.length - 1] = current;
      }
      // Different length: longer token already sorted first, skip shorter
      continue;
    }

    deduped.push(current);
  }

  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of deduped) {
    const deltaLine = token.line - prevLine;
    const deltaStartChar =
      deltaLine === 0 ? token.startChar - prevChar : token.startChar;

    data.push(
      deltaLine,
      deltaStartChar,
      token.length,
      token.tokenType,
      token.tokenModifiers
    );

    prevLine = token.line;
    prevChar = token.startChar;
  }

  return new Uint32Array(data);
}

// Create semantic tokens provider using worker-based parsing
function createSemanticTokensProvider(): monaco.languages.DocumentSemanticTokensProvider {
  return {
    getLegend: () => ({
      tokenTypes: [...TOKEN_TYPES],
      tokenModifiers: [...TOKEN_MODIFIERS],
    }),

    // This method can return a Promise (ProviderResult<SemanticTokens>)
    provideDocumentSemanticTokens: async (model, _lastResultId, _token) => {
      // Check if parsing is disabled
      if (isParserDisabled()) {
        return {
          data: new Uint32Array(),
          resultId: undefined,
        };
      }

      const code = model.getValue();

      // Get highlight captures from the worker
      const captures = await getHighlightCaptures(code);

      if (captures.length === 0) {
        return {
          data: new Uint32Array(),
          resultId: undefined,
        };
      }

      // Convert captures to semantic tokens
      const tokens = generateSemanticTokens(code, captures);

      // Encode tokens in Monaco's format
      const encodedTokens = encodeSemanticTokens(tokens);

      return {
        data: encodedTokens,
        resultId: undefined,
      };
    },

    releaseDocumentSemanticTokens: _resultId => {
      // Cleanup if needed
    },
  };
}

// Initialize parser (via worker)
export async function initializeTreeSitter(): Promise<void> {
  await initializeParser();
}

// Register the AgentScript language with Monaco
// This is resilient to parser failures - the language will still work
// with basic functionality even if syntax highlighting fails
export async function registerAgentScriptLanguage(options?: {
  schema?: Record<string, SchemaFieldInfo>;
}) {
  // Register the language - this always works
  monaco.languages.register({
    id: 'agentscript',
    extensions: ['.agent', '.agentscript'],
    aliases: ['AgentScript', 'agentscript'],
    mimetypes: ['text/x-agentscript'],
  });

  // Set language configuration - this always works
  monaco.languages.setLanguageConfiguration(
    'agentscript',
    languageConfiguration
  );

  // Register a minimal tokens provider for auto-closing pair support
  // This works even without the parser
  monaco.languages.setTokensProvider('agentscript', {
    getInitialState: () => new AgentScriptState(),
    tokenize: (line: string, state: monaco.languages.IState) => {
      const tokens: monaco.languages.IToken[] = [];

      // Match strings and comments in one pass.
      // Strings are matched first so we can skip # inside them.
      const stringOrComment = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|#.*/g;
      let match;
      while ((match = stringOrComment.exec(line)) !== null) {
        if (match[0].startsWith('#')) {
          tokens.push({
            startIndex: match.index,
            scopes: 'comment.agentscript',
          });
          break; // comment runs to end of line
        }
        tokens.push({ startIndex: match.index, scopes: 'string.agentscript' });
      }

      // Sort tokens by start index
      tokens.sort((a, b) => a.startIndex - b.startIndex);

      return {
        tokens,
        endState: state,
      };
    },
  });

  // Define themes with semantic highlighting enabled - this always works
  monaco.editor.defineTheme('agentscript-light', lightTheme);
  monaco.editor.defineTheme('agentscript-dark', darkTheme);

  // Disable all bracket highlighting for AgentScript editors
  monaco.editor.onDidCreateEditor(editor => {
    const codeEditor = editor as monaco.editor.IStandaloneCodeEditor;
    if (typeof codeEditor.getModel !== 'function') return;
    const applyIfAgentScript = () => {
      const model = codeEditor.getModel();
      if (model?.getLanguageId() === 'agentscript') {
        codeEditor.updateOptions({
          matchBrackets: 'never',
          bracketPairColorization: { enabled: false },
          guides: {
            bracketPairs: false,
            bracketPairsHorizontal: false,
            highlightActiveBracketPair: false,
            indentation: false,
          },
        });
      }
    };
    applyIfAgentScript();
    codeEditor.onDidChangeModel?.(() => applyIfAgentScript());
  });

  // Try to initialize the parser for syntax highlighting
  // If this fails, the editor still works - just without syntax highlighting
  try {
    await initializeTreeSitter();

    // Register semantic tokens provider (async, worker-based)
    monaco.languages.registerDocumentSemanticTokensProvider(
      'agentscript',
      createSemanticTokensProvider()
    );
  } catch (_error) {
    // Parser initialization failed - editor will work without syntax highlighting
  }

  // Register hover provider if schema provided
  if (options?.schema) {
    monaco.languages.registerHoverProvider(
      'agentscript',
      createHoverProvider(options.schema)
    );
  }
}

// Create diagnostic markers for Monaco editor
// Accepts LSP-style diagnostics with range (line/character are 0-based)
export function createDiagnosticMarkers(
  errors: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    message: string;
    severity?: number;
    code?: string;
    source?: string;
    tags?: number[];
  }[]
): monaco.editor.IMarkerData[] {
  return errors.map(error => ({
    severity:
      error.severity === 2
        ? monaco.MarkerSeverity.Warning
        : error.severity === 3
          ? monaco.MarkerSeverity.Info
          : error.severity === 4
            ? monaco.MarkerSeverity.Hint
            : monaco.MarkerSeverity.Error,
    // Monaco uses 1-based line/column, LSP range is 0-based
    startLineNumber: error.range.start.line + 1,
    startColumn: error.range.start.character + 1,
    endLineNumber: error.range.end.line + 1,
    endColumn: error.range.end.character + 1,
    message: error.message,
    code: error.code,
    source: error.source,
    // DiagnosticTag values (1=Unnecessary, 2=Deprecated) match monaco.MarkerTag
    ...(error.tags
      ? {
          tags: error.tags.filter(
            (t): t is monaco.MarkerTag => t === 1 || t === 2
          ),
        }
      : {}),
  }));
}
