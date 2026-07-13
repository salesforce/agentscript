/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

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
import { Namespace, TRANSITION_TARGET_NAMESPACES } from '../../../constants.js';

const NODE_NAMESPACES = new Set<string>([
  ...TRANSITION_TARGET_NAMESPACES,
  Namespace.Actions,
  Namespace.LLM,
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
          namespace: Namespace.Orchestrator,
          label: 'Orchestrator',
          group: root.orchestrator,
        },
        {
          namespace: Namespace.Subagent,
          label: 'Subagent',
          group: root.subagent,
        },
        {
          namespace: Namespace.Generator,
          label: 'Generator',
          group: root.generator,
        },
        {
          namespace: Namespace.Executor,
          label: 'Executor',
          group: root.executor,
        },
        { namespace: Namespace.Router, label: 'Router', group: root.router },
        { namespace: Namespace.Echo, label: 'Echo', group: root.echo },
        {
          namespace: Namespace.Actions,
          label: 'Actions',
          group: root.actions,
        },
        { namespace: Namespace.LLM, label: 'LLM', group: root.llm },
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
