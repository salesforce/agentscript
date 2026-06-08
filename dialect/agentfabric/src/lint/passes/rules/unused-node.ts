import {
  DiagnosticSeverity,
  DiagnosticTag,
  attachDiagnostic,
  decomposeAtMemberExpression,
  isAstNodeLike,
  isNamedMap,
  storeKey,
} from '@agentscript/language';
import type { AstRoot, LintPass, PassStore } from '@agentscript/language';
import { AGENTFABRIC_LINT_SOURCE } from './shared.js';

const NODE_NAMESPACES = new Set([
  'orchestrator',
  'subagent',
  'generator',
  'executor',
  'router',
  'echo',
  'actions',
  'llm',
]);

class UnusedNodePass implements LintPass {
  readonly id = storeKey('unused-node');
  readonly description =
    'Flags graph nodes that are declared but never referenced';

  private usedSymbols = new Set<string>();

  init(): void {
    this.usedSymbols = new Set();
  }

  enterNode(_key: string, value: unknown, _parent: unknown): void {
    const ref = decomposeAtMemberExpression(value);
    if (!ref) return;
    if (!NODE_NAMESPACES.has(ref.namespace)) return;
    this.usedSymbols.add(`${ref.namespace}:${ref.property}`);
  }

  run(_store: PassStore, root: AstRoot): void {
    const groups: Array<{ namespace: string; label: string; group: unknown }> =
      [
        {
          namespace: 'orchestrator',
          label: 'Orchestrator',
          group: root.orchestrator,
        },
        { namespace: 'subagent', label: 'Subagent', group: root.subagent },
        { namespace: 'generator', label: 'Generator', group: root.generator },
        { namespace: 'executor', label: 'Executor', group: root.executor },
        { namespace: 'router', label: 'Router', group: root.router },
        { namespace: 'echo', label: 'Echo', group: root.echo },
        { namespace: 'actions', label: 'Actions', group: root.actions },
        { namespace: 'llm', label: 'LLM', group: root.llm },
      ];

    for (const { namespace, label, group } of groups) {
      if (!isNamedMap(group)) continue;

      for (const [name, decl] of group) {
        if (this.usedSymbols.has(`${namespace}:${name}`)) continue;

        const node = isAstNodeLike(decl) ? decl : null;
        if (!node?.__cst) continue;

        const range = node.__cst.range;

        attachDiagnostic(node, {
          range,
          message: `${label} '${name}' is declared but never referenced`,
          severity: DiagnosticSeverity.Information,
          code: 'unused-node',
          source: AGENTFABRIC_LINT_SOURCE,
          tags: [DiagnosticTag.Unnecessary],
          data: { removalRange: range },
        });
      }
    }
  }
}

export function unusedNodePass(): LintPass {
  return new UnusedNodePass();
}
