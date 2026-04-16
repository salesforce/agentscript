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
} from '../core/analysis/lint.js';
import type { ScopeContext } from '../core/analysis/scope.js';
import { extractVariableRef, LINT_SOURCE } from './lint-utils.js';

class UnusedVariablePass implements LintPass {
  readonly id = storeKey('unused-variable');
  readonly description =
    'Flags variables that are declared but never referenced';

  private usedVariables = new Set<string>();

  init(): void {
    this.usedVariables = new Set();
  }

  visitExpression(expr: AstNodeLike, _ctx: ScopeContext): void {
    const name = extractVariableRef(expr);
    if (name) {
      this.usedVariables.add(name);
    }
  }

  run(_store: PassStore, root: AstRoot): void {
    const variables = root.variables;
    if (!isNamedMap(variables)) return;

    for (const [name, decl] of variables) {
      if (this.usedVariables.has(name)) continue;

      const node = isAstNodeLike(decl) ? decl : null;
      if (!node?.__cst) continue;

      const fullRange = node.__cst.range;

      attachDiagnostic(node, {
        range: fullRange,
        message: `Variable '${name}' is declared but never used`,
        severity: DiagnosticSeverity.Information,
        code: 'unused-variable',
        source: LINT_SOURCE,
        tags: [DiagnosticTag.Unnecessary],
        data: { removalRange: fullRange },
      });
    }
  }
}

export function unusedVariablePass(): LintPass {
  return new UnusedVariablePass();
}
