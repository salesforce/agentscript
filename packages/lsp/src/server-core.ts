/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Server Core - LSP handler setup (shared between Node and browser).
 *
 * Dialect-agnostic: accepts LspConfig with dialects, parser, and optional compile hook.
 */

import type {
  Connection,
  InitializeParams,
  InitializeResult,
} from 'vscode-languageserver';
import {
  TextDocuments,
  TextDocumentSyncKind,
  SemanticTokensBuilder,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentStore } from './document-store.js';
import { processDocument } from './pipeline.js';
import type { LspConfig } from './lsp-config.js';
import { provideHover } from './providers/hover.js';
import { provideCompletion } from './providers/completion.js';
import { provideDefinition } from './providers/definition.js';
import { provideReferences } from './providers/references.js';
import { provideCodeActions } from './providers/code-actions.js';
import {
  provideDocumentSymbols,
  provideWorkspaceSymbols,
} from './providers/symbols.js';
import { provideRename } from './providers/rename.js';
import {
  provideSemanticTokens,
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
} from './providers/semantic-tokens.js';
import type { SemanticTokensConfig } from './providers/semantic-tokens.js';

/**
 * Sets up all LSP handlers on the connection.
 * This is the shared core logic used by both Node.js and browser environments.
 */
export function setupServer(connection: Connection, config: LspConfig): void {
  const documents: TextDocuments<TextDocument> = new TextDocuments(
    TextDocument
  );
  const documentStore = new DocumentStore();

  let hasWorkspaceFolderCapability = false;

  // Build semantic tokens config from LspConfig (mutable so onInitialize can patch it)
  const semanticTokensConfig: SemanticTokensConfig | undefined =
    config.enableSemanticTokens !== false && config.queryExecutor
      ? { queryExecutor: config.queryExecutor }
      : undefined;

  connection.onInitialize(async (params: InitializeParams) => {
    // Run async init hook (e.g., WASM parser init in browser)
    if (config.onBeforeInitialize) {
      await config.onBeforeInitialize();
    }

    const initializationOptions = params.initializationOptions as
      | { dialect?: string }
      | undefined;

    if (initializationOptions?.dialect) {
      config.defaultDialect = initializationOptions.dialect;
    }

    const capabilities = params.capabilities;

    hasWorkspaceFolderCapability = !!(
      capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    connection.console.log('[LSP] Server initialized');

    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: true,
      },
    };

    // Conditionally enable completion provider
    if (config.enableCompletionProvider !== false) {
      result.capabilities.completionProvider = {
        resolveProvider: false,
        triggerCharacters: ['@', '.', ':', '#', '='],
      };
    }

    // Conditionally enable semantic tokens
    if (config.enableSemanticTokens !== false) {
      result.capabilities.semanticTokensProvider = {
        legend: {
          tokenTypes: [...TOKEN_TYPES],
          tokenModifiers: [...TOKEN_MODIFIERS],
        },
        full: true,
      };
    }

    if (hasWorkspaceFolderCapability) {
      result.capabilities.workspace = {
        workspaceFolders: {
          supported: true,
        },
      };
    }

    return result;
  });

  // Document open/change/close handlers
  documents.onDidOpen(event => {
    void validateTextDocument(event.document);
  });

  documents.onDidChangeContent(change => {
    void validateTextDocument(change.document);
  });

  documents.onDidClose(event => {
    const uri = event.document.uri;
    documentStore.delete(uri);
    // Clear diagnostics for closed document
    void connection.sendDiagnostics({
      uri,
      diagnostics: [],
    });
  });

  function validateTextDocument(textDocument: TextDocument): void {
    try {
      const text = textDocument.getText();
      const uri = textDocument.uri;

      // Reuse existing LanguageService if dialect hasn't changed
      const existingService = documentStore.get(uri)?.service;

      // Process document (parse, lint, optionally compile)
      const state = processDocument(uri, text, config, existingService);

      // Store document state
      documentStore.set(state);

      // Publish diagnostics
      void connection.sendDiagnostics({
        uri,
        diagnostics: state.diagnostics,
      });

      // Send compile output via custom notification (only when compile is configured)
      if (state.compileOutput != null) {
        void connection.sendNotification('agentscript/compileResult', {
          uri,
          compileOutput: state.compileOutput,
        });
      }
    } catch (error) {
      connection.console.error(
        `[LSP] Error processing document: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Hover
  connection.onHover(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) return null;

    return provideHover(
      state,
      params.position.line,
      params.position.character,
      config.dialects
    );
  });

  // Completion
  connection.onCompletion(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) return null;

    const triggerChar = params.context?.triggerCharacter;
    return provideCompletion(
      state,
      params.position.line,
      params.position.character,
      triggerChar,
      config.dialects
    );
  });

  // Definition
  connection.onDefinition(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) return null;

    return provideDefinition(
      state,
      params.position.line,
      params.position.character
    );
  });

  // References
  connection.onReferences(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) return [];

    return provideReferences(
      state,
      params.position.line,
      params.position.character,
      params.context.includeDeclaration
    );
  });

  // Code Actions
  connection.onCodeAction(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) return [];

    return provideCodeActions(state, params.range, params.context.diagnostics);
  });

  // Document Symbols
  connection.onDocumentSymbol(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) return [];

    return provideDocumentSymbols(state);
  });

  // Workspace Symbols
  connection.onWorkspaceSymbol(params => {
    const allStates = documentStore.getAllStates();
    return provideWorkspaceSymbols(allStates, params.query);
  });

  // Rename
  connection.onRenameRequest(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) return null;

    return provideRename(
      state,
      params.position.line,
      params.position.character,
      params.newName
    );
  });

  // Semantic Tokens
  connection.languages.semanticTokens.on(params => {
    const state = documentStore.get(params.textDocument.uri);
    if (!state) {
      return { data: [] };
    }

    const builder = new SemanticTokensBuilder();
    provideSemanticTokens(state.source, builder, semanticTokensConfig);
    return builder.build();
  });

  // Make the text document manager listen on the connection
  documents.listen(connection);

  // Listen on the connection
  connection.listen();
}
