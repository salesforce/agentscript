/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * LSP Extension factory for Monaco editors using VSCode API compatibility layers.
 *
 * This enables full LSP support (hover, completion, diagnostics, etc.) in browser-based
 * Monaco editors that provide a VSCode-compatible API surface.
 */

export interface VscodeWrapper {
  vscodeApi: {
    VSCodeLanguageClientBrowser: {
      BrowserMessageReader: any;
      BrowserMessageWriter: any;
    };
  };
  vscode?: {
    workspace?: {
      getConfiguration(section: string): any;
    };
  };
}

export interface LspExtensionConfig {
  /** URL to the LSP server worker bundle */
  serverUrl: string;
  /** Language ID (default: 'agentscript') */
  languageId?: string;
  /** Extension version */
  version?: string;
  /** Document glob patterns to match (e.g., ['**\/*.agent']) */
  documentPatterns?: string[];
  /** Function to read dialect configuration */
  dialectConfig?: () => string;
}

export interface ExtensionManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  license: string;
  engines: { vscode: string };
  contributes: {
    languages: any[];
    grammars: any[];
    semanticTokenTypes?: any[];
    semanticTokenModifiers?: any[];
    configuration?: any;
  };
  activationEvents: string[];
}

export function createLspExtension(config: LspExtensionConfig) {
  const manifest: ExtensionManifest = {
    name: 'agentscript-extension',
    displayName: 'Agent Script Language Support',
    description: 'LSP support for Agent Script language',
    version: config.version || '2.2.41',
    publisher: 'salesforce',
    license: 'Apache-2.0',
    engines: { vscode: '*' },
    contributes: {
      languages: [
        {
          id: config.languageId || 'agentscript',
          aliases: ['Agent Scripting'],
          extensions: ['.agent', '.afscript'],
        },
      ],
      grammars: [
        {
          language: config.languageId || 'agentscript',
          scopeName: 'source.agentscript',
        },
      ],
      configuration: {
        type: 'object',
        title: 'AgentScript',
        properties: {
          'agentscript.dialect': {
            type: 'string',
            default: 'agentforce',
            enum: ['agentforce', 'agentscript'],
            description: 'Select the AgentScript dialect',
          },
          'agentscript.trace.server': {
            type: 'string',
            enum: ['off', 'messages', 'verbose'],
            default: 'off',
            description: 'Traces LSP communication',
          },
        },
      },
    },
    activationEvents: [],
  };

  return {
    config: manifest,

    activate: async (vscodeWrapper: VscodeWrapper) => {
      const { BrowserMessageReader, BrowserMessageWriter } =
        vscodeWrapper.vscodeApi.VSCodeLanguageClientBrowser;

      // Create worker from URL (no fetch/blob needed)
      const worker = new Worker(config.serverUrl, {
        type: 'module',
        name: 'Agent Script LS',
      });

      const reader = new BrowserMessageReader(worker);
      const writer = new BrowserMessageWriter(worker);

      // Read dialect configuration if function provided
      const dialect = config.dialectConfig?.() ?? 'agentforce';

      return {
        languageClientConfig: {
          languageId: config.languageId || 'agentscript',
          clientOptions: {
            documentSelector: [
              { scheme: 'file', language: config.languageId || 'agentscript' },
              ...(
                config.documentPatterns || ['**/*.agent', '**/*.afscript']
              ).map(pattern => ({
                scheme: 'file',
                language: config.languageId || 'agentscript',
                pattern,
              })),
            ],
            initializationOptions: {
              dialect,
            },
          },
          connection: {
            options: {
              $type: 'MessageChannel',
              worker,
            },
            messageTransports: { reader, writer },
          },
        },
      };
    },
  };
}
