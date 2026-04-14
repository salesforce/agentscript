import type { AstRoot, AstNodeLike } from '../core/types.js';
import { isNamedMap, isAstNodeLike } from '../core/types.js';
import type { ScopeContext } from '../core/analysis/scope.js';
import type { LintPass, PassStore } from '../core/analysis/lint.js';
import { walkDefinitionKeys } from '../core/analysis/references.js';
import { recurseAstChildren } from '../core/analysis/ast-walkers.js';
import {
  positionIndexKey,
  type ExpressionEntry,
  type DefinitionEntry,
  type ScopeEntry,
} from '../core/analysis/position-index.js';

class PositionIndexPass implements LintPass {
  readonly id = positionIndexKey;
  readonly description = 'Builds a position index for fast cursor lookups';

  private expressions: ExpressionEntry[] = [];

  init(): void {
    this.expressions = [];
  }

  visitExpression(expr: AstNodeLike, scope: ScopeContext): void {
    const cst = expr.__cst;
    if (!cst) return;
    this.expressions.push({ expr, range: cst.range, scope });
  }

  finalize(store: PassStore, root: AstRoot): void {
    const definitions: DefinitionEntry[] = [];
    walkDefinitionKeys(root, (namespace, name, keyRange, fullRange, scope) => {
      definitions.push({ namespace, name, keyRange, fullRange, scope });
    });

    const scopes: ScopeEntry[] = [];
    walkScopeEntries(root, {}, new Set(), scopes);

    store.set(positionIndexKey, {
      expressions: this.expressions,
      definitions,
      scopes,
    });
  }
}

/**
 * Collect all scope entries (blocks that introduce scope context).
 * Simpler than per-cursor walkScopeBlocks -- collects ALL scope blocks
 * rather than only those containing a specific position.
 */
function walkScopeEntries(
  value: unknown,
  parentScope: ScopeContext,
  visited: Set<unknown>,
  out: ScopeEntry[]
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (isNamedMap(value)) {
    for (const [name, entry] of value) {
      if (!isAstNodeLike(entry)) continue;
      const cst = entry.__cst;
      if (!cst) continue;

      const blockScope = entry.__scope;
      let scope = parentScope;
      if (blockScope && typeof entry.__name === 'string') {
        scope = { ...parentScope, [blockScope]: name };
        out.push({ range: cst.range, scope });
      }

      recurseAstChildren(entry, (_k, child) => {
        walkScopeEntries(child, scope, visited, out);
      });
    }
    return;
  }

  recurseAstChildren(value, (_k, child) => {
    walkScopeEntries(child, parentScope, visited, out);
  });
}

export function positionIndexPass(): LintPass {
  return new PositionIndexPass();
}
