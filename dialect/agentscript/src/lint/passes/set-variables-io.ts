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
  isAstNodeLike,
  attachDiagnostic,
  findSuggestion,
  lintDiagnostic,
} from '@agentscript/language';
import type { PassStore } from '@agentscript/language';
import type { SyntaxNode } from '@agentscript/types';
import { toRange, DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from './type-map.js';

// ---------------------------------------------------------------------------
// AST shape interfaces — narrow the loosely-typed AstNodeLike for readability
// ---------------------------------------------------------------------------

interface ReasoningActionBlock extends AstNodeLike {
  __kind: 'ReasoningActionBlock';
  value?: AstNodeLike;
  statements?: WithClauseNode[];
}

interface WithClauseNode extends AstNodeLike {
  __kind: 'WithClause';
  param: string;
  __paramCstNode?: SyntaxNode;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isReasoningActionBlock(
  node: AstNodeLike
): node is ReasoningActionBlock {
  return node.__kind === 'ReasoningActionBlock';
}

function isWithClause(node: AstNodeLike): node is WithClauseNode {
  return node.__kind === 'WithClause';
}

/** Check if a reasoning action value is @utils.setVariables */
function isSetVariablesAction(value: AstNodeLike | undefined): boolean {
  if (!value) return false;
  const decomposed = decomposeAtMemberExpression(value);
  return (
    decomposed?.namespace === 'utils' && decomposed?.property === 'setVariables'
  );
}

// ---------------------------------------------------------------------------
// Lint pass
// ---------------------------------------------------------------------------

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

      for (const [, block] of topicMap as NamedMap<AstNodeLike>) {
        if (!isAstNodeLike(block)) continue;

        const reasoning = block.reasoning;
        if (!isAstNodeLike(reasoning)) continue;

        const raActions = reasoning.actions;
        if (!raActions || !isNamedMap(raActions)) continue;

        for (const [, raBlock] of raActions as NamedMap<AstNodeLike>) {
          if (!isAstNodeLike(raBlock)) continue;
          if (!isReasoningActionBlock(raBlock)) continue;
          if (!isSetVariablesAction(raBlock.value)) continue;

          const statements = raBlock.statements;
          if (!statements) continue;

          for (const stmt of statements) {
            if (!isWithClause(stmt)) continue;
            if (!stmt.param) continue;

            if (!typeMap.variables.has(stmt.param)) {
              const cst = stmt.__cst;
              if (cst) {
                const range = stmt.__paramCstNode
                  ? toRange(stmt.__paramCstNode)
                  : cst.range;

                const suggestion = findSuggestion(stmt.param, variableNames);
                const msg = `'${stmt.param}' is not a defined variable. @utils.setVariables can only assign to declared variables.`;
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
