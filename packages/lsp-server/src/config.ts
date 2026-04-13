/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * LSP Server configuration assembly.
 *
 * Extracted from index.ts so it can be tested independently
 * without triggering LSP connection side effects.
 */

import { parse, parseAndHighlight } from '@agentscript/parser';
import { defaultDialects } from '@agentscript/lsp';
import type { LspConfig } from '@agentscript/lsp';

/** Assemble the full LspConfig for the Node.js server. */
export function createServerConfig(): LspConfig {
  return {
    dialects: defaultDialects,
    parser: { parse },
    queryExecutor: {
      executeQuery(source: string) {
        return parseAndHighlight(source);
      },
    },
    enableCompletionProvider: true,
    enableSemanticTokens: true,
  };
}
