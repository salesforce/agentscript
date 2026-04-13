/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstRoot } from '../core/types.js';
import {
  storeKey,
  type LintPass,
  type PassStore,
  getDocumentSymbols,
  type DocumentSymbol,
} from '../core/analysis/index.js';

export const symbolTableKey = storeKey<DocumentSymbol[]>('symbol-table');

class SymbolTablePass implements LintPass {
  readonly id = symbolTableKey;
  readonly description = 'Extracts LSP DocumentSymbol tree from the parsed AST';

  finalize(store: PassStore, root: AstRoot): void {
    store.set(symbolTableKey, getDocumentSymbols(root));
  }
}

export function symbolTableAnalyzer(): LintPass {
  return new SymbolTablePass();
}
