/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Semantic Tokens Provider for LSP.
 *
 * Thin wrapper around @agentscript/language's generateSemanticTokens.
 * Executes the highlights query via the injected QueryExecutor,
 * then delegates token generation to the shared implementation.
 */

import type { SemanticTokensBuilder } from 'vscode-languageserver';
import type { QueryExecutor } from '../lsp-config.js';
import {
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  mapCaptureToToken,
  generateSemanticTokens,
} from '@agentscript/language';
import type { SemanticToken } from '@agentscript/language';

export {
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  mapCaptureToToken,
  generateSemanticTokens,
};
export type { SemanticToken };

// ── Semantic tokens config (passed to provideSemanticTokens) ────────

export interface SemanticTokensConfig {
  /** Query executor for semantic token highlights. */
  queryExecutor: QueryExecutor;
}

/**
 * Generate semantic tokens for a document and push to builder.
 */
export function provideSemanticTokens(
  source: string,
  builder: SemanticTokensBuilder,
  tokenConfig: SemanticTokensConfig | undefined
): void {
  if (!tokenConfig) return;

  try {
    const captures = tokenConfig.queryExecutor.executeQuery(source);

    const tokens = generateSemanticTokens(source, captures);

    for (const token of tokens) {
      builder.push(
        token.line,
        token.startChar,
        token.length,
        token.tokenType,
        token.tokenModifiers
      );
    }
  } catch (error) {
    console.error('[SemanticTokens] Error generating tokens:', error);
  }
}
