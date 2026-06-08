import { storeKey, recurseAstChildren } from '@agentscript/language';
import type { LintPass } from '@agentscript/language';

function shouldSuppressDiagnostic(diag: unknown): boolean {
  if (!diag || typeof diag !== 'object') return false;
  const record = diag as Record<string, unknown>;
  const code = record.code;
  const message = record.message;
  if (typeof message !== 'string') return false;
  if (code === 'undefined-reference') {
    // AgentFabric intentionally allows @actions references in additional
    // contexts (e.g. executor run targets and reasoning action bindings).
    if (message.includes("'@actions' cannot be used as a reference")) {
      return true;
    }
    if (message.includes('is not defined in actions')) {
      return true;
    }
  }
  if (code === 'constraint-resolved-type') {
    if (message.includes("Cannot invoke '@actions.")) {
      return true;
    }
  }
  return false;
}

/**
 * Walk AST nodes filtering diagnostics. Uses recurseAstChildren to avoid
 * traversing into __cst tree-sitter nodes (whose native bindings create
 * fresh wrapper objects per access, defeating WeakSet cycle detection and
 * causing OOM).
 */
function traverseAndFilter(node: unknown, seen: WeakSet<object>): void {
  if (node == null || typeof node !== 'object') return;
  if (seen.has(node as object)) return;
  seen.add(node as object);

  const obj = node as Record<string, unknown>;
  const diagnostics = obj.__diagnostics;
  if (Array.isArray(diagnostics)) {
    obj.__diagnostics = diagnostics.filter(d => !shouldSuppressDiagnostic(d));
  }

  recurseAstChildren(node, (_key, child) => {
    traverseAndFilter(child, seen);
  });
}

class SuppressActionsNamespaceUndefinedReferencePass implements LintPass {
  readonly id = storeKey('agentfabric-suppress-actions-undefined-reference');
  readonly description =
    'Suppress undefined-reference diagnostics for @actions namespace in AgentFabric';

  run(_store: never, root: Record<string, unknown>): void {
    traverseAndFilter(root, new WeakSet<object>());
  }
}

export function suppressActionsNamespaceUndefinedReferencePass(): LintPass {
  return new SuppressActionsNamespaceUndefinedReferencePass();
}
