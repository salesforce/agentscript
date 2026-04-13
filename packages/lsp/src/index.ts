/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * @agentscript/lsp - Language Server Protocol implementation for AgentScript
 *
 * Dialect-agnostic core library. Accepts dialects, parser, and optional compile
 * hook via LspConfig (Volar pattern — pure DI).
 *
 * @packageDocumentation
 */

// Core exports
export { setupServer } from './server-core.js';

// Config types
export type {
  LspConfig,
  LspParser,
  CompileHook,
  QueryExecutor,
  QueryCapture,
} from './lsp-config.js';

// Document store
export { DocumentStore } from './document-store.js';
export type { DocumentState } from './document-store.js';

// Pipeline
export { processDocument } from './pipeline.js';

// Dialect resolution (canonical home: @agentscript/language)
export {
  parseDialectAnnotation,
  resolveDialect,
  type DialectAnnotation,
  type DialectResolutionConfig,
  type VersionDiagnostic,
  type ResolvedDialect,
} from '@agentscript/language';

// Dialect registry
export { defaultDialects } from './dialect-registry.js';

// Type adapters
export { toLspRange, toLspDiagnostic } from './adapters/types.js';

// Providers
export { provideHover } from './providers/hover.js';
export { provideCompletion } from './providers/completion.js';
export { provideDefinition } from './providers/definition.js';
export { provideReferences } from './providers/references.js';
export { provideCodeActions } from './providers/code-actions.js';
export {
  provideDocumentSymbols,
  provideWorkspaceSymbols,
} from './providers/symbols.js';
export { provideRename } from './providers/rename.js';
export {
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  mapCaptureToToken,
  generateSemanticTokens,
} from './providers/semantic-tokens.js';
export type { SemanticToken } from './providers/semantic-tokens.js';
