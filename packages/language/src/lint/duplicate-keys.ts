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
import { FieldChild, StatementChild } from '../core/children.js';
import { isSetClause, isWithClause } from '../core/guards.js';
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

/**
 * Build a dedup key for a procedure-body clause statement.
 *
 * - `WithClause`: dedup by parameter name (`with <param>`). Two `with`
 *   clauses targeting the same param name silently overwrite at runtime;
 *   flagging them is almost always what the author wants.
 * - `SetClause`: dedup by the CST text of the target expression
 *   (`set <targetText>`). CST text is fine here — two source writes that
 *   differ only in whitespace still parse to the same target AST, and
 *   case differences (`@variables.x` vs `@variables.X`) are intentionally
 *   distinct (same rule as `WithClause.param`).
 *
 * Returns `undefined` for any other statement kind, which causes the
 * caller to skip it entirely — `to`/`available when`/`run`/`if` have no
 * meaningful duplicate-key semantics in a procedure body.
 */
function clauseDedupKey(stmt: AstNodeLike): string | undefined {
  if (isWithClause(stmt)) {
    if (!stmt.param) return undefined;
    return `with ${stmt.param}`;
  }
  if (isSetClause(stmt)) {
    const targetText = stmt.target?.__cst?.node?.text?.trim();
    if (!targetText) return undefined;
    return `set ${targetText}`;
  }
  return undefined;
}

class DuplicateKeyPass implements LintPass {
  readonly id = storeKey('duplicate-key');
  readonly description =
    'Detects duplicate keys within block fields and duplicate `with`/`set` clauses within procedure bodies';

  private nodes: AstNodeLike[] = [];
  private runStatements: AstNodeLike[] = [];

  init(): void {
    this.nodes = [];
    this.runStatements = [];
  }

  enterNode(_key: string, value: unknown, _parent: unknown): void {
    if (!isAstNodeLike(value)) return;

    // Block-like nodes: checked for FieldChild duplicates AND
    // StatementChild duplicates (ReasoningActionBlock stores `with`/`set`
    // clauses as StatementChild entries inside __children).
    if (value.__children) {
      this.nodes.push(value);
    }

    // RunStatement: body is a plain `Statement[]`, not __children. Must
    // be checked separately since it doesn't go through the normal
    // FieldChild/StatementChild iteration. Matching on `__kind` rather
    // than `instanceof RunStatement` avoids a cyclic import into
    // core/statements.
    if (value.__kind === 'RunStatement') {
      this.runStatements.push(value);
    }
  }

  finalize(_store: PassStore, _root: AstRoot): void {
    for (const node of this.nodes) {
      this.checkBlockChildren(node);
    }
    for (const run of this.runStatements) {
      this.checkRunBody(run);
    }
  }

  /**
   * Detect duplicate FieldChild keys AND duplicate clause-statement keys
   * inside a single block's __children array.
   *
   * Both checks share the same walk to avoid iterating twice, but use
   * separate seen-maps because their key namespaces never collide
   * ("description" vs "with description" vs "set description").
   */
  private checkBlockChildren(node: AstNodeLike): void {
    if (!node.__children) return;

    const seenFields = new Map<string, FieldChild>();
    const seenClauses = new Map<string, AstNodeLike>();

    for (const child of node.__children) {
      if (child instanceof FieldChild) {
        // For named entries (e.g., "topic main:"), the duplicate key
        // includes both the type and entry name.
        const dupKey = child.entryName
          ? `${child.key} ${child.entryName}`
          : child.key;

        if (seenFields.has(dupKey)) {
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
          seenFields.set(dupKey, child);
        }
        continue;
      }

      if (child instanceof StatementChild) {
        this.checkClauseDuplicate(child.value, seenClauses);
      }
    }
  }

  /** Walk a RunStatement's body for duplicate `with`/`set` clauses. */
  private checkRunBody(run: AstNodeLike): void {
    const body = (run as { body?: unknown }).body;
    if (!Array.isArray(body)) return;

    const seenClauses = new Map<string, AstNodeLike>();
    for (const stmt of body) {
      if (!isAstNodeLike(stmt)) continue;
      this.checkClauseDuplicate(stmt, seenClauses);
    }
  }

  /**
   * Attach a `duplicate-clause` diagnostic to `stmt` if its dedup key is
   * already in `seen`. The diagnostic is attached to the statement node
   * itself (not the container) so the range lands on the duplicate line,
   * mirroring what `duplicate-key` does for FieldChild.
   */
  private checkClauseDuplicate(
    stmt: unknown,
    seen: Map<string, AstNodeLike>
  ): void {
    if (!isAstNodeLike(stmt)) return;
    const dedup = clauseDedupKey(stmt);
    if (!dedup) return;

    if (seen.has(dedup)) {
      const range = stmt.__cst?.range;
      if (range) {
        attachDiagnostic(
          stmt,
          lintDiagnostic(
            range,
            `Duplicate ${dedup}`,
            DiagnosticSeverity.Warning,
            'duplicate-clause'
          )
        );
      }
    } else {
      seen.set(dedup, stmt);
    }
  }
}

export function duplicateKeyPass(): LintPass {
  return new DuplicateKeyPass();
}
