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
  IfStatement,
  attachDiagnostic,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

export const systemInstructionsKey = storeKey<void>('system-instructions');

const UNSUPPORTED_STATEMENT_MESSAGE =
  'System instructions only support instruction text and if/else conditionals. ' +
  'Move actions, assignments, transitions, collection, and escalation logic to reasoning instructions.';

function validateStatements(statements: readonly Statement[]): void {
  for (const statement of statements) {
    if (statement.__kind === 'Template') continue;

    if (statement instanceof IfStatement) {
      validateStatements(statement.body);
      validateStatements(statement.orelse);
      continue;
    }

    const range = statement.__cst?.range;
    if (!range || !isAstNodeLike(statement)) continue;
    attachDiagnostic(
      statement,
      lintDiagnostic(
        range,
        UNSUPPORTED_STATEMENT_MESSAGE,
        DiagnosticSeverity.Error,
        'unsupported-system-instruction-statement'
      )
    );
  }
}

function walkSystemBlocks(value: unknown, visited: WeakSet<object>): void {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);

  const node = value as AstNodeLike;
  if (node.__kind === 'SystemBlock') {
    const instructions = node.instructions;
    if (
      isAstNodeLike(instructions) &&
      instructions.__kind === 'ProcedureValue' &&
      Array.isArray(instructions.statements)
    ) {
      validateStatements(instructions.statements as Statement[]);
    }
  }

  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('__') || !child || typeof child !== 'object') continue;
    if (Array.isArray(child)) {
      for (const item of child) walkSystemBlocks(item, visited);
    } else if (child instanceof Map || isNamedMap(child)) {
      for (const [, item] of child.entries()) {
        walkSystemBlocks(item, visited);
      }
    } else {
      walkSystemBlocks(child, visited);
    }
  }
}

class SystemInstructionsPass implements LintPass {
  readonly id = systemInstructionsKey;
  readonly description =
    'Restricts system instruction procedures to instruction text and conditionals.';

  run(_store: PassStore, root: AstNodeLike): void {
    walkSystemBlocks(root, new WeakSet<object>());
  }
}

export function systemInstructionsPass(): LintPass {
  return new SystemInstructionsPass();
}
