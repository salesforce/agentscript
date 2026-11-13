/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  AstNodeLike,
  LintPass,
  PassStore,
  Statement,
} from '@agentscript/language';
import {
  EndSessionStatement,
  EscalateStatement,
  IfStatement,
  TransitionStatement,
  attachDiagnostic,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

export const onExitHandoffsKey = storeKey<void>('on-exit-handoffs');

/**
 * Statement keyword for each statement kind that hands off control. These
 * compile to handoffs, which a custom subagent's `on_exit` cannot hold: it
 * runs as the subagent is exited, so it only accepts actions.
 */
function handoffKeyword(statement: Statement): string | undefined {
  if (statement instanceof TransitionStatement) return 'transition';
  if (statement instanceof EscalateStatement) return 'escalate';
  if (statement instanceof EndSessionStatement) return 'end_session';
  return undefined;
}

function validateStatements(statements: readonly Statement[]): void {
  for (const statement of statements) {
    if (statement instanceof IfStatement) {
      validateStatements(statement.body);
      validateStatements(statement.orelse);
      continue;
    }

    const keyword = handoffKeyword(statement);
    const range = statement.__cst?.range;
    if (!keyword || !range || !isAstNodeLike(statement)) continue;
    attachDiagnostic(
      statement,
      lintDiagnostic(
        range,
        `\`${keyword}\` is not allowed in on_exit of a custom subagent: on_exit only runs actions.`,
        DiagnosticSeverity.Error,
        'handoff-in-on-exit'
      )
    );
  }
}

function walkBlocks(value: unknown, visited: WeakSet<object>): void {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);

  const node = value as AstNodeLike;
  // `on_exit` only exists on custom subagent variants (customSubagentFields).
  const onExit = node.on_exit;
  if (
    isAstNodeLike(onExit) &&
    onExit.__kind === 'ProcedureValue' &&
    Array.isArray(onExit.statements)
  ) {
    validateStatements(onExit.statements as Statement[]);
  }

  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('__') || !child || typeof child !== 'object') continue;
    if (Array.isArray(child)) {
      for (const item of child) walkBlocks(item, visited);
    } else if (child instanceof Map || isNamedMap(child)) {
      for (const [, item] of child.entries()) {
        walkBlocks(item, visited);
      }
    } else {
      walkBlocks(child, visited);
    }
  }
}

class OnExitHandoffsPass implements LintPass {
  readonly id = onExitHandoffsKey;
  readonly description =
    'Rejects transition, escalate, and end_session in custom subagent on_exit procedures.';

  run(_store: PassStore, root: AstNodeLike): void {
    walkBlocks(root, new WeakSet<object>());
  }
}

export function onExitHandoffsPass(): LintPass {
  return new OnExitHandoffsPass();
}
