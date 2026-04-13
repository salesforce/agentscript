/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstRoot, AstNodeLike, Range } from '../core/types.js';
import { isAstNodeLike, hasCstRange } from '../core/types.js';
import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint.js';
import { FieldChild } from '../core/children.js';
import { lintDiagnostic } from './lint-utils.js';

/** Extract the source range for a FieldChild's key for diagnostic positioning. */
function getKeyRange(child: FieldChild): Range | undefined {
  if (child.__keyRange) return child.__keyRange;
  // Fallback: use the value's __cst range
  const val = child.value;
  if (hasCstRange(val)) {
    return val.__cst.range;
  }
  return undefined;
}

class DuplicateKeyPass implements LintPass {
  readonly id = storeKey('duplicate-key');
  readonly description = 'Detects duplicate keys within block fields';

  private nodes: AstNodeLike[] = [];

  init(): void {
    this.nodes = [];
  }

  enterNode(_key: string, value: unknown, _parent: unknown): void {
    // Skip NamedMaps — collections detect duplicates during parsing
    // (CollectionBlockNode.parse). Only collect block-like nodes with
    // __children for AST-based duplicate detection.
    if (isAstNodeLike(value) && value.__children) {
      this.nodes.push(value);
    }
  }

  finalize(_store: PassStore, _root: AstRoot): void {
    for (const node of this.nodes) {
      this.checkForDuplicates(node);
    }
  }

  /**
   * Detect duplicates by walking __children (AST), not the CST.
   *
   * __children already reflects orphan adoption and ERROR recovery:
   * - Adopted elements are skipped during parsing (never pushed to children)
   * - ERROR-recovered elements have their inner __children merged
   * - Real duplicates (same field written twice) are both pushed unconditionally
   */
  private checkForDuplicates(node: AstNodeLike): void {
    if (!node.__children) return;

    const seenKeys = new Map<string, FieldChild>();
    for (const child of node.__children) {
      if (!(child instanceof FieldChild)) continue;

      // For named entries (e.g., "topic main:"), the duplicate key
      // includes both the type and entry name.
      const dupKey = child.entryName
        ? `${child.key} ${child.entryName}`
        : child.key;

      if (seenKeys.has(dupKey)) {
        const keyRange = getKeyRange(child);
        if (keyRange) {
          attachDiagnostic(
            node,
            lintDiagnostic(
              keyRange,
              `Duplicate key '${dupKey}'`,
              DiagnosticSeverity.Warning,
              'duplicate-key'
            )
          );
        }
      } else {
        seenKeys.set(dupKey, child);
      }
    }
  }
}

export function duplicateKeyPass(): LintPass {
  return new DuplicateKeyPass();
}
