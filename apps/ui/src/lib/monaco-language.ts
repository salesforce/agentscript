/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Monaco language configuration for AgentScript
 * Themes are imported from @agentscript/monaco (single source of truth).
 * This file handles language registration for the UI app, which uses
 * LSP-based semantic tokens instead of parser worker-based ones.
 */

import * as monaco from 'monaco-editor';
import {
  lightTheme,
  darkTheme,
  languageConfiguration,
} from '@agentscript/monaco';

// Re-export themes for consumers
export { lightTheme, darkTheme, languageConfiguration };

// State class for Monaco tokenizer (minimal fallback)
class AgentScriptState implements monaco.languages.IState {
  clone(): monaco.languages.IState {
    return new AgentScriptState();
  }

  equals(_other: monaco.languages.IState): boolean {
    return true;
  }
}

/**
 * Register AgentScript language with Monaco.
 */
export function registerAgentScriptLanguage() {
  // Register the language
  monaco.languages.register({
    id: 'agentscript',
    extensions: ['.agent', '.agentscript'],
    aliases: ['AgentScript', 'agentscript'],
    mimetypes: ['text/x-agentscript'],
  });

  // Set language configuration
  monaco.languages.setLanguageConfiguration(
    'agentscript',
    languageConfiguration
  );

  // Register minimal tokens provider for auto-closing pairs
  monaco.languages.setTokensProvider('agentscript', {
    getInitialState: () => new AgentScriptState(),
    tokenize: (line: string, state: monaco.languages.IState) => {
      const tokens: monaco.languages.IToken[] = [];

      // Match strings and comments
      const stringOrComment = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|#.*/g;
      let match;
      while ((match = stringOrComment.exec(line)) !== null) {
        if (match[0].startsWith('#')) {
          tokens.push({
            startIndex: match.index,
            scopes: 'comment',
          });
          break;
        }
        tokens.push({ startIndex: match.index, scopes: 'string' });
      }

      tokens.sort((a, b) => a.startIndex - b.startIndex);

      return {
        tokens,
        endState: state,
      };
    },
  });

  // Define themes
  monaco.editor.defineTheme('agentscript-light', lightTheme);
  monaco.editor.defineTheme('agentscript-dark', darkTheme);

  // Bracket highlighting is disabled via transparent theme colors in
  // lightTheme/darkTheme (editorBracketMatch, editorBracketHighlight, etc.)
}
