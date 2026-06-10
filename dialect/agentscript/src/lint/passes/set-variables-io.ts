/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * setVariables I/O validation — validates that `with` clause parameters in
 * @utils.setVariables reasoning actions reference defined variables.
 *
 * When a `with param=value` or `with param=...` clause uses a param name
 * that does not correspond to a declared variable, this produces an error.
 *
 * Diagnostic: set-variables-unknown-variable
 */

import type {
  AstNodeLike,
  AstRoot,
  LintPass,
  NamedMap,
} from '@agentscript/language';
import {
  storeKey,
  schemaContextKey,
  resolveNamespaceKeys,
  decomposeAtMemberExpression,
  isNamedMap,
  attachDiagnostic,
  findSuggestion,
  lintDiagnostic,
} from '@agentscript/language';
import type { PassStore } from '@agentscript/language';
import type { CstMeta, SyntaxNode } from '@agentscript/types';
import { toRange, DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from './type-map.js';

/** Check if a reasoning action value is @utils.setVariables */
function isSetVariablesAction(value: unknown): boolean {
  if (!value) return false;
  const decomposed = decomposeAtMemberExpression(value);
  return (
    decomposed?.namespace === 'utils' && decomposed?.property === 'setVariables'
  );
}

class SetVariablesIoValidator implements LintPass {
  readonly id = storeKey('set-variables-io');
  readonly description =
    'Validates with clause params in @utils.setVariables reference defined variables';
  readonly requires = [typeMapKey] as const;

  run(store: PassStore, root: AstRoot): void {
    const typeMap = store.get(typeMapKey);
    if (!typeMap) return;

    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    const rootObj = root as AstNodeLike;
    const variableNames = [...typeMap.variables.keys()];

    // Walk all subagent/topic blocks to find @utils.setVariables reasoning actions
    const subagentKeys = new Set([
      ...resolveNamespaceKeys('subagent', ctx),
      ...resolveNamespaceKeys('topic', ctx),
    ]);

    for (const topicKey of subagentKeys) {
      const topicMap = rootObj[topicKey];
      if (!topicMap || !isNamedMap(topicMap)) continue;

      for (const [, block] of topicMap as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;
        const topic = block as AstNodeLike;

        const reasoning = topic.reasoning;
        if (!reasoning || typeof reasoning !== 'object') continue;

        const reasoningObj = reasoning as Record<string, unknown>;
        const raActions = reasoningObj.actions;
        if (!raActions || !isNamedMap(raActions)) continue;

        for (const [, raBlock] of raActions as NamedMap<unknown>) {
          if (!raBlock || typeof raBlock !== 'object') continue;
          const ra = raBlock as Record<string, unknown>;
          if (ra.__kind !== 'ReasoningActionBlock') continue;

          // Check if this is a @utils.setVariables action
          if (!isSetVariablesAction(ra.value)) continue;

          // Validate with clauses
          const statements = ra.statements as
            | Array<Record<string, unknown>>
            | undefined;
          if (!statements) continue;

          for (const stmt of statements) {
            if (stmt.__kind !== 'WithClause') continue;
            const param = stmt.param as string;
            if (!param) continue;

            if (!typeMap.variables.has(param)) {
              const cst = stmt.__cst as CstMeta | undefined;
              if (cst) {
                const paramCstNode = (stmt as { __paramCstNode?: SyntaxNode })
                  .__paramCstNode;
                const range = paramCstNode ? toRange(paramCstNode) : cst.range;

                const suggestion = findSuggestion(param, variableNames);
                const msg = `'${param}' is not a defined variable. @utils.setVariables can only assign to declared variables.`;
                attachDiagnostic(
                  stmt,
                  lintDiagnostic(
                    range,
                    msg,
                    DiagnosticSeverity.Error,
                    'set-variables-unknown-variable',
                    { suggestion }
                  )
                );
              }
            }
          }
        }
      }
    }
  }
}

export function setVariablesIoRule(): LintPass {
  return new SetVariablesIoValidator();
}
