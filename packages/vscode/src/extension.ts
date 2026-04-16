/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * VS Code Extension Entry Point for AgentScript.
 *
 * Starts the LSP server bundled as dist/server.mjs and connects to it via IPC.
 * Supports dialect switching via the agentscript.dialect setting.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';
import type {
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node.js';
import { getCoreExtension } from './coreExtensionUtils';
import { setTelemetryService, getTelemetryService } from './telemetry';

const DIALECT_PATTERN = /^#\s*@dialect:/;
const EXCLUDED_PATH_PATTERN = /[/\\]genAiPlannerBundles[/\\]/;

function isExcludedPath(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file') return false;
  return EXCLUDED_PATH_PATTERN.test(doc.uri.fsPath);
}

/**
 * Auto-detect untitled documents that look like AgentScript (first line
 * matches `# @dialect: ...`) and set their language mode automatically.
 * VSCode's `firstLine` contribution only works for files on disk.
 */
function autoDetectLanguage(doc: vscode.TextDocument): void {
  if (doc.languageId !== 'plaintext') return;
  if (doc.lineCount === 0) return;
  const firstLine = doc.lineAt(0).text;
  if (DIALECT_PATTERN.test(firstLine)) {
    void vscode.languages.setTextDocumentLanguage(doc, 'agentscript');
  }
}

interface TelemetryEvent {
  eventName?: string;
  properties?: Record<string, string>;
  measures?: Record<string, number>;
}

const reportedFiles = new Set<string>();

/** Send a one-per-session telemetry event when an AgentScript file is identified. */
function trackAgentScriptFile(doc: vscode.TextDocument): void {
  if (doc.languageId !== 'agentscript') return;
  if (isExcludedPath(doc)) return;
  const key = doc.uri.toString();
  if (reportedFiles.has(key)) return;
  reportedFiles.add(key);

  getTelemetryService()?.sendCommandEvent('agentScriptFile_opened', undefined, {
    scheme: doc.uri.scheme,
    fileName: path.basename(doc.uri.fsPath),
  });
}

async function initializeTelemetry(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    const coreExtension = await getCoreExtension();
    const { name } = context.extension.packageJSON as { name: string };
    const svc =
      coreExtension.exports.services.TelemetryService.getInstance(name);
    await svc.initializeService(context);
    setTelemetryService(svc);
  } catch (err) {
    console.error('Failed to initialize telemetry:', (err as Error).message);
  }
}

/** Forward telemetry events from the language server to the telemetry service. */
function registerTelemetryForwarding(lspClient: LanguageClient): void {
  lspClient.onTelemetry((data: TelemetryEvent) => {
    const telemetryService = getTelemetryService();
    if (telemetryService && data.eventName) {
      telemetryService.sendEventData(
        data.eventName,
        data.properties,
        data.measures
      );
    }
  });
}

function createClient(serverModule: string): LanguageClient {
  const dialect = vscode.workspace
    .getConfiguration('agentscript')
    .get<string>('dialect', 'agentforce');

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'agentscript', pattern: '**/*.agent' },
      { scheme: 'untitled', language: 'agentscript' },
    ],
    initializationOptions: {
      dialect,
    },
    outputChannelName: 'Agent Script Language Server',
  };

  return new LanguageClient(
    'Agent Script Language Server',
    'Agent Script Language Server',
    serverOptions,
    clientOptions
  );
}

let client: LanguageClient | undefined;
let restartGeneration = 0;

export function activate(context: vscode.ExtensionContext): void {
  const extensionHRStart = process.hrtime();

  // Register document listeners before auto-detect so the re-open
  // triggered by setTextDocumentLanguage is caught for untitled files.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (isExcludedPath(doc)) {
        if (doc.languageId === 'agentscript') {
          void vscode.languages.setTextDocumentLanguage(doc, 'plaintext');
          vscode.window.showWarningMessage(
            'This file should not be edited. It is a read-only version of the AgentScript used to generate the GenAiPlannerBundle.'
          );
        }
        return;
      }
      autoDetectLanguage(doc);
      trackAgentScriptFile(doc);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      // Re-check when the first line changes (e.g., user types the annotation)
      const firstLineChanged = e.contentChanges.some(
        c => c.range.start.line === 0
      );
      if (firstLineChanged) {
        autoDetectLanguage(e.document);
      }
    })
  );

  // Auto-detect AgentScript for untitled/new files (runs before telemetry
  // init so language detection isn't blocked by the core extension).
  for (const doc of vscode.workspace.textDocuments) {
    autoDetectLanguage(doc);
  }

  // Fire-and-forget: don't block LSP startup on telemetry/core extension
  void initializeTelemetry(context).then(() => {
    getTelemetryService()?.sendExtensionActivationEvent(extensionHRStart);
    for (const doc of vscode.workspace.textDocuments) {
      trackAgentScriptFile(doc);
    }
  });

  try {
    const serverModule = context.asAbsolutePath(
      path.join('dist', 'server.mjs')
    );

    client = createClient(serverModule);
    registerTelemetryForwarding(client);
    void client.start();

    // Restart server when dialect setting changes
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agentscript.dialect')) {
        const gen = ++restartGeneration;
        const oldClient = client;
        client = undefined;
        void oldClient?.stop().then(() => {
          if (gen !== restartGeneration) return;
          client = createClient(serverModule);
          registerTelemetryForwarding(client);
          void client.start();
        });
      }
    });

    context.subscriptions.push(configWatcher);
    context.subscriptions.push({
      dispose: () => {
        if (client) {
          void client.stop();
        }
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    getTelemetryService()?.sendException(
      'agentScriptActivation_failed',
      message
    );
    throw err;
  }
}

export function deactivate(): Thenable<void> | undefined {
  getTelemetryService()?.sendExtensionDeactivationEvent();
  reportedFiles.clear();

  if (!client) {
    return undefined;
  }
  return client.stop();
}
