/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { SyntaxNode, Range } from './types.js';
import { toRange } from './types.js';
import type { Diagnostic } from './diagnostics.js';
import { createParserDiagnostic } from './diagnostics.js';

/**
 * Compute a diagnostic range for a MISSING CST node.
 *
 * MISSING nodes are zero-width and sit where the parser gave up, which is
 * often the start of the *next* line (after consuming the newline). Anchor
 * the range to the previous sibling's end so the squiggly appears on the
 * line where the token was actually expected.
 */
export function missingNodeRange(node: SyntaxNode): Range {
  const range = toRange(node);
  const prev = node.previousSibling;
  if (
    prev &&
    range.start.line === range.end.line &&
    range.start.character === range.end.character &&
    prev.endPosition.row < node.startPosition.row
  ) {
    const end = prev.endPosition;
    return {
      start: { line: end.row, character: end.column },
      end: { line: end.row, character: end.column },
    };
  }
  return range;
}

/**
 * Collect diagnostics for ERROR and MISSING direct children of a CST node.
 *
 * Called at each AST parse boundary (mapping elements, expressions,
 * statements, root) so that diagnostics are attached to the AST node
 * that owns that CST region — consistent with how all other diagnostics
 * flow through `__diagnostics` → `collectDiagnostics()`.
 *
 * Checks ALL children (named + anonymous) since MISSING nodes for
 * punctuation tokens (`:`, `=`, quotes) are anonymous.
 */
export function collectAllCstDiagnostics(root: SyntaxNode): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  collectCstDiagnosticsInner(root, diagnostics);
  return diagnostics;
}

function collectCstDiagnosticsInner(
  node: SyntaxNode,
  diagnostics: Diagnostic[]
): void {
  for (const child of node.children) {
    if (child.isMissing) {
      diagnostics.push(
        createParserDiagnostic(
          missingNodeRange(child),
          `Missing ${child.type}`,
          'missing-token'
        )
      );
    } else if (child.isError) {
      // Skip ERROR nodes inside run_statement — RunStatement.parse
      // produces a more specific diagnostic for `with ...` errors.
      if (node.type !== 'run_statement') {
        const text = child.text?.trim();
        diagnostics.push(
          createParserDiagnostic(
            child,
            text
              ? `Syntax error: unexpected \`${text.length > 40 ? text.slice(0, 40) + '…' : text}\``
              : 'Syntax error',
            'syntax-error'
          )
        );
      }
      // Recurse into ERROR children to catch nested MISSING/ERROR nodes
      collectCstDiagnosticsInner(child, diagnostics);
    } else {
      collectCstDiagnosticsInner(child, diagnostics);
    }
  }
}
