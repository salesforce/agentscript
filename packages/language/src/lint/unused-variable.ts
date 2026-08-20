/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstNodeLike, AstRoot } from '../core/types.js';
import { isNamedMap, isAstNodeLike } from '../core/types.js';
import {
  DiagnosticSeverity,
  DiagnosticTag,
  attachDiagnostic,
} from '../core/diagnostics.js';
import {
  storeKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint-engine.js';
import type { ScopeContext } from '../core/analysis/scope.js';
import { extractVariableRef, LINT_SOURCE } from './lint-utils.js';

/**
 * Options for the unused-variable pass.
 *
 * `overrideMessageForVariable` lets dialects customize the diagnostic message
 * per variable — e.g. agentforce uses this to relabel required platform
 * variables that are read by the runtime even when the script never references
 * them. Receives the declaration node so callers can inspect properties like
 * `source` to disambiguate beyond the variable name.
 */
export interface UnusedVariablePassOptions {
  overrideMessageForVariable?: (
    name: string,
    decl: AstNodeLike
  ) => string | undefined;

  /**
   * Collect variable names that should be treated as used but that the
   * expression walk cannot observe as `@variables.X` references. Dialects use
   * this for constructs that target a variable by bare name — e.g. the
   * `with param=...` clauses of `@utils.setVariables`, where `param` is the
   * write-target variable and no member expression is ever emitted. Reads run
   * after finalize, so dialect analyzers (e.g. reasoning-action resolution)
   * have already populated the store.
   */
  collectExternallyUsedVariables?: (
    store: PassStore,
    root: AstRoot
  ) => Iterable<string>;
}

class UnusedVariablePass implements LintPass {
  readonly id = storeKey('unused-variable');
  readonly description =
    'Flags variables that are declared but never referenced';

  private usedVariables = new Set<string>();

  constructor(private readonly options: UnusedVariablePassOptions = {}) {}

  init(): void {
    this.usedVariables = new Set();
  }

  visitExpression(expr: AstNodeLike, _ctx: ScopeContext): void {
    const name = extractVariableRef(expr);
    if (name) {
      this.usedVariables.add(name);
    }
  }

  run(store: PassStore, root: AstRoot): void {
    const variables = root.variables;
    if (!isNamedMap(variables)) return;

    const externallyUsed = this.options.collectExternallyUsedVariables?.(
      store,
      root
    );
    if (externallyUsed) {
      for (const name of externallyUsed) this.usedVariables.add(name);
    }

    for (const [name, decl] of variables) {
      if (this.usedVariables.has(name)) continue;

      const node = isAstNodeLike(decl) ? decl : null;
      if (!node?.__cst) continue;

      const fullRange = node.__cst.range;
      const customMessage = this.options.overrideMessageForVariable?.(
        name,
        node
      );

      attachDiagnostic(node, {
        range: fullRange,
        message:
          customMessage ?? `Variable '${name}' is declared but never used`,
        severity: DiagnosticSeverity.Information,
        code: 'unused-variable',
        source: LINT_SOURCE,
        tags: [DiagnosticTag.Unnecessary],
        data: { removalRange: fullRange },
      });
    }
  }
}

export function unusedVariablePass(
  options?: UnusedVariablePassOptions
): LintPass {
  return new UnusedVariablePass(options);
}
