/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  CodeAction,
  CompletionList,
  Definition,
  Diagnostic,
  Hover,
  Location,
  PublishDiagnosticsParams,
  ReferenceParams,
  RenameParams,
  SemanticTokens,
  TextDocumentIdentifier,
  TextDocumentPositionParams,
} from 'vscode-languageserver-protocol';
import { LanguageClient } from 'vscode-languageclient/browser.js';
import { initialize as initializeVscodeServices } from '@codingame/monaco-vscode-api/services';
import 'vscode/localExtensionHost';
import { defaultApi } from 'vscode/localExtensionHost';

export interface LspDocumentState {
  version: number;
  opened: boolean;
}

/** Custom notification payload from the LSP server with compile output. */
export interface CompileResultParams {
  uri: string;
  compileOutput: unknown;
}

let vscodeServicesInitPromise: Promise<void> | null = null;

async function ensureVscodeServicesInitialized(): Promise<void> {
  if (vscodeServicesInitPromise === null) {
    vscodeServicesInitPromise = initializeVscodeServices({}).catch(error => {
      vscodeServicesInitPromise = null;
      throw error;
    });
  }
  await vscodeServicesInitPromise;
}

export class AgentScriptLspClient {
  private readonly worker: Worker;
  private client: LanguageClient | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private readonly documents = new Map<string, LspDocumentState>();
  private readonly diagnosticsByUri = new Map<string, Diagnostic[]>();
  private diagnosticsListener:
    | ((params: PublishDiagnosticsParams) => void)
    | null = null;
  private compileResultListener:
    | ((params: CompileResultParams) => void)
    | null = null;

  constructor(worker: Worker) {
    this.worker = worker;
  }

  onDiagnostics(listener: (params: PublishDiagnosticsParams) => void): void {
    this.diagnosticsListener = listener;
    if (this.client) {
      this.client.onNotification(
        'textDocument/publishDiagnostics',
        (params: PublishDiagnosticsParams) => {
          this.diagnosticsByUri.set(
            params.uri,
            (params.diagnostics as Diagnostic[]) ?? []
          );
          if (this.diagnosticsListener) {
            this.diagnosticsListener(params);
          }
        }
      );
    }
  }

  /** Subscribe to custom agentscript/compileResult notifications. */
  onCompileResult(listener: (params: CompileResultParams) => void): void {
    this.compileResultListener = listener;
    if (this.client) {
      this.client.onNotification(
        'agentscript/compileResult',
        (params: CompileResultParams) => {
          this.compileResultListener?.(params);
        }
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise !== null) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.startClient().catch(error => {
      this.initPromise = null;
      throw error;
    });
    await this.initPromise;
  }

  dispose(): void {
    const client = this.client;
    // Null out immediately so any in-flight notify() calls are guarded out
    // before the client finishes stopping.
    this.client = null;
    this.initialized = false;
    void (client ? client.stop() : Promise.resolve()).finally(() => {
      this.worker.terminate();
    });
  }

  async syncDocument(uri: string, text: string, languageId = 'agentscript') {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = this.documents.get(uri);
    if (!existing) {
      this.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text,
        },
      });
      this.documents.set(uri, { version: 1, opened: true });
      return;
    }

    const nextVersion = existing.version + 1;
    this.notify('textDocument/didChange', {
      textDocument: {
        uri,
        version: nextVersion,
      },
      contentChanges: [{ text }],
    });
    this.documents.set(uri, { version: nextVersion, opened: true });
  }

  closeDocument(uri: string): void {
    if (!this.documents.has(uri)) return;
    this.diagnosticsByUri.delete(uri);
    this.documents.delete(uri);
    // Use the guarded notify helper — avoids triggering $start on
    // a LanguageClient that hasn't fully initialized yet.
    this.notify('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  async hover(params: TextDocumentPositionParams): Promise<Hover | null> {
    const client = await this.getClient();
    return client.sendRequest(
      'textDocument/hover',
      params
    ) as Promise<Hover | null>;
  }

  async completion(
    params: TextDocumentPositionParams & {
      context?: { triggerKind: number; triggerCharacter?: string };
    }
  ): Promise<CompletionList | null> {
    const client = await this.getClient();
    return client.sendRequest(
      'textDocument/completion',
      params
    ) as Promise<CompletionList | null>;
  }

  async definition(
    params: TextDocumentPositionParams
  ): Promise<Definition | null> {
    const client = await this.getClient();
    return client.sendRequest(
      'textDocument/definition',
      params
    ) as Promise<Definition | null>;
  }

  async references(params: ReferenceParams): Promise<Location[]> {
    const client = await this.getClient();
    return client.sendRequest('textDocument/references', params) as Promise<
      Location[]
    >;
  }

  async rename(params: RenameParams): Promise<unknown> {
    const client = await this.getClient();
    return client.sendRequest('textDocument/rename', params);
  }

  async codeActions(params: {
    textDocument: TextDocumentIdentifier;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    context: { diagnostics: unknown[] };
  }): Promise<CodeAction[]> {
    const client = await this.getClient();
    return client.sendRequest('textDocument/codeAction', params) as Promise<
      CodeAction[]
    >;
  }

  async semanticTokens(uri: string): Promise<SemanticTokens | null> {
    const client = await this.getClient();
    return client.sendRequest('textDocument/semanticTokens/full', {
      textDocument: { uri },
    }) as Promise<SemanticTokens | null>;
  }

  getDiagnosticsForUri(uri: string): Diagnostic[] {
    return this.diagnosticsByUri.get(uri) ?? [];
  }

  private notify(method: string, params?: unknown): void {
    if (!this.client || !this.initialized) return;
    // Swallow errors — the client may be stopped between this check and the
    // async internals of sendNotification (which tries $start on a stopped
    // client). This is expected during teardown.
    void this.client.sendNotification(method, params).catch(() => {});
  }

  private async getClient(): Promise<LanguageClient> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (!this.client) {
      throw new Error('LSP client not initialized');
    }
    return this.client;
  }

  private async startClient(): Promise<void> {
    await ensureVscodeServicesInitialized();
    await this.waitForVscodeApiReady();

    this.client = await this.createClientWithRetry();

    if (this.diagnosticsListener) {
      this.client.onNotification(
        'textDocument/publishDiagnostics',
        (params: PublishDiagnosticsParams) => {
          this.diagnosticsByUri.set(
            params.uri,
            (params.diagnostics as Diagnostic[]) ?? []
          );
          if (this.diagnosticsListener) {
            this.diagnosticsListener(params);
          }
        }
      );
    }

    if (this.compileResultListener) {
      this.client.onNotification(
        'agentscript/compileResult',
        (params: CompileResultParams) => {
          this.compileResultListener?.(params);
        }
      );
    }

    await this.client.start();
    this.initialized = true;
  }

  private async waitForVscodeApiReady(): Promise<void> {
    if (defaultApi) return;

    const intervalMs = 25;
    const timeoutMs = 10000;
    const deadline = Date.now() + timeoutMs;
    while (!defaultApi && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  private async createClientWithRetry(): Promise<LanguageClient> {
    let attempt = 0;
    while (attempt < 40) {
      attempt += 1;
      try {
        return new LanguageClient(
          'agentscript-ui-lsp',
          'AgentScript UI LSP Client',
          {
            documentSelector: [{ language: 'agentscript' }],
            initializationOptions: {},
          },
          this.worker
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Default api is not ready yet')) {
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      'LanguageClient construction failed: VS Code API never became ready'
    );
  }
}
