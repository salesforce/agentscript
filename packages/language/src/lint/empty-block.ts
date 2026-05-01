/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstNodeLike, AstRoot } from '../core/types.js';
import { isNamedMap } from '../core/types.js';
import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint-engine.js';
import { lintDiagnostic } from './lint-utils.js';

/**
 * Fields whose NamedMap/TypedMap values must not be empty.
 * An empty `inputs:` or `outputs:` block is almost certainly a mistake.
 */
const MUST_NOT_BE_EMPTY = new Set(['inputs', 'outputs']);

class EmptyBlockPass implements LintPass {
  readonly id = storeKey('empty-block');
  readonly description =
    'Flags empty inputs/outputs blocks that should contain at least one entry';

  private hits: {
    key: string;
    node: AstNodeLike | null;
    parent: AstNodeLike;
  }[] = [];

  init(): void {
    this.hits = [];
  }

  enterNode(key: string, value: unknown, parent: unknown): void {
    if (!MUST_NOT_BE_EMPTY.has(key)) return;
    if (!parent || typeof parent !== 'object') return;

    let node: AstNodeLike | null = null;

    if (isNamedMap(value)) {
      if (value.size > 0) return;
      node = value as unknown as AstNodeLike;
    } else if (value == null) {
      // Bare `inputs:` / `outputs:` parse as null-ish values and should still
      // be treated as empty blocks.
      node = null;
    } else {
      return;
    }

    this.hits.push({
      key,
      node,
      parent: parent as AstNodeLike,
    });
  }

  finalize(_store: PassStore, _root: AstRoot): void {
    for (const { key, node, parent } of this.hits) {
      const cst = node?.__cst;

      // Fall back to parent CST for range if the empty block itself has none
      const parentCst = parent.__cst;
      const range = cst?.range ??
        parentCst?.range ?? {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        };

      attachDiagnostic(
        node ?? parent,
        lintDiagnostic(
          range,
          `Empty '${key}' block — must contain at least one entry`,
          DiagnosticSeverity.Error,
          'empty-block'
        )
      );
    }
  }
}

export function emptyBlockPass(): LintPass {
  return new EmptyBlockPass();
}
