/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint rules for `executor` blocks.
 *
 * Validates the `do` body of each executor entry, enforcing:
 * - `set` targets must be `@variables.*` or `@outputs.*`.
 * - `run` targets must reference `@actions.*` with a valid action def
 *   whose `kind` is `a2a:send_message` or `mcp:tool`.
 * - `with` parameters on `run` statements must match declared action
 *   inputs (or be implicit parameters like `message`).
 * - Expressions must not use bare `@` identifiers or `@actions.*` as values.
 * - `@outputs.*` references are disallowed outside `run` body `set` clauses.
 */

import {
  AtIdentifier,
  BinaryExpression,
  CallExpression,
  ComparisonExpression,
  DictLiteral,
  isNamedMap,
  ListLiteral,
  MemberExpression,
  RunStatement,
  SetClause,
  SpreadExpression,
  SubscriptExpression,
  TemplateExpression,
  TemplateInterpolation,
  TernaryExpression,
  UnaryExpression,
  WithClause,
  decomposeAtMemberExpression,
} from '@agentscript/language';
import type { Expression, Statement } from '@agentscript/language';
import {
  normalizeId,
  IMPLICIT_WITH_PARAMS,
  listActionDefInputNames,
} from '../../../utils.js';
import {
  attachError,
  asStatements,
  extractStringValue,
  type AstLike,
} from './shared.js';
import { Namespace } from '../../../constants.js';

type ExprMode = 'execute' | 'run-body';

function validateExpression(
  expr: Expression,
  mode: ExprMode,
  node: AstLike
): void {
  if (expr instanceof AtIdentifier) {
    attachError(
      node,
      `Bare @${expr.name} is not allowed; use @variables.*, @request.*, or @<node_type>.<node_name>.output.`,
      'execute-bare-at'
    );
    return;
  }

  if (expr instanceof MemberExpression) {
    const decomposed = decomposeAtMemberExpression(expr);
    if (decomposed) {
      if (decomposed.namespace === 'outputs' && mode !== 'run-body') {
        attachError(
          node,
          '@outputs.<node> is not supported for node outputs. Use @<node_type>.<node_name>.output.',
          'execute-outputs-unsupported'
        );
      }
      if (decomposed.namespace === Namespace.Actions) {
        attachError(
          node,
          '@actions references cannot be used as values. Use `run @actions.<name>` to invoke an action.',
          'execute-actions-ref'
        );
      }
      return;
    }
    if (expr.object && typeof (expr.object as Expression).__kind === 'string') {
      validateExpression(expr.object as Expression, mode, node);
    }
    return;
  }

  if (expr instanceof SubscriptExpression) {
    if (expr.object && typeof (expr.object as Expression).__kind === 'string') {
      validateExpression(expr.object as Expression, mode, node);
    }
    if (expr.index && typeof (expr.index as Expression).__kind === 'string') {
      validateExpression(expr.index as Expression, mode, node);
    }
    return;
  }

  if (
    expr instanceof BinaryExpression ||
    expr instanceof ComparisonExpression
  ) {
    validateExpression(expr.left, mode, node);
    validateExpression(expr.right, mode, node);
    return;
  }

  if (expr instanceof UnaryExpression) {
    validateExpression(expr.operand, mode, node);
    return;
  }

  if (expr instanceof TernaryExpression) {
    validateExpression(expr.condition, mode, node);
    validateExpression(expr.consequence, mode, node);
    validateExpression(expr.alternative, mode, node);
    return;
  }

  if (expr instanceof CallExpression) {
    if (expr.func && typeof (expr.func as Expression).__kind === 'string') {
      validateExpression(expr.func as Expression, mode, node);
    }
    for (const arg of expr.args) {
      validateExpression(arg, mode, node);
    }
    return;
  }

  if (expr instanceof ListLiteral) {
    for (const el of expr.elements) {
      validateExpression(el, mode, node);
    }
    return;
  }

  if (expr instanceof DictLiteral) {
    for (const entry of expr.entries) {
      validateExpression(entry.key, mode, node);
      validateExpression(entry.value, mode, node);
    }
    return;
  }

  if (expr instanceof TemplateExpression) {
    for (const part of expr.parts) {
      if (part instanceof TemplateInterpolation) {
        validateExpression(part.expression, mode, node);
      }
    }
    return;
  }

  if (expr instanceof SpreadExpression) {
    validateExpression(expr.expression, mode, node);
    return;
  }
}

function validateSetTarget(
  target: Expression,
  node: AstLike,
  code: string,
  message: string
): void {
  const decomposed = decomposeAtMemberExpression(target);
  if (
    decomposed &&
    (decomposed.namespace === Namespace.Variables ||
      decomposed.namespace === 'outputs')
  ) {
    return;
  }
  attachError(node, message, code);
}

function validateExecuteDo(
  executorEntry: Record<string, unknown>,
  actionDefs: Map<string, Record<string, unknown>> | undefined
): void {
  const node = executorEntry as AstLike;
  const statements = asStatements(executorEntry.do) as unknown as Statement[];

  for (const stmt of statements) {
    if (stmt instanceof SetClause) {
      validateSetTarget(
        stmt.target,
        node,
        'execute-set-target',
        'execute `set` target must be @variables.<name> or @outputs.<node_id>.'
      );
      validateExpression(stmt.value, 'execute', node);
      continue;
    }

    if (stmt instanceof RunStatement) {
      const targetDecomposed = decomposeAtMemberExpression(stmt.target);
      if (
        !targetDecomposed ||
        targetDecomposed.namespace !== Namespace.Actions
      ) {
        attachError(
          node,
          'execute `run` target must be @actions.<action_def_name>.',
          'execute-run-target'
        );
        continue;
      }

      const actionDefName = normalizeId(targetDecomposed.property);

      if (!actionDefs) {
        attachError(
          node,
          `execute \`run\`: references @actions.${actionDefName} but no actions block is defined.`,
          'execute-action-def'
        );
        continue;
      }

      if (actionDefs) {
        const actionDef = actionDefs.get(actionDefName);
        if (!actionDef) {
          attachError(
            node,
            `execute \`run\`: actions entry '${actionDefName}' must exist with kind a2a:send_message or mcp:tool.`,
            'execute-action-def'
          );
        } else {
          const kind = extractStringValue(actionDef.kind);
          if (kind !== 'a2a:send_message' && kind !== 'mcp:tool') {
            attachError(
              node,
              `execute \`run\`: actions entry '${actionDefName}' must exist with kind a2a:send_message or mcp:tool.`,
              'execute-action-def'
            );
          } else {
            const declaredInputs = new Set(listActionDefInputNames(actionDef));
            for (const child of stmt.body) {
              if (child instanceof WithClause) {
                if (
                  declaredInputs.size > 0 &&
                  !declaredInputs.has(child.param) &&
                  !IMPLICIT_WITH_PARAMS.has(child.param)
                ) {
                  attachError(
                    node,
                    `execute \`run\`: \`with ${child.param}\` is not a declared input on '${actionDefName}'. ` +
                      `Declared inputs: [${[...declaredInputs].join(', ')}]. ` +
                      `Implicit parameters: [${[...IMPLICIT_WITH_PARAMS].join(', ')}].`,
                    'execute-undeclared-input'
                  );
                }
                validateExpression(child.value, 'execute', node);
              } else if (child instanceof SetClause) {
                validateSetTarget(
                  child.target,
                  node,
                  'execute-run-set-target',
                  '`run` body `set` target must be @variables.<name> or @outputs.<field>.'
                );
                validateExpression(child.value, 'run-body', node);
              } else {
                attachError(
                  node,
                  `Unsupported statement in execute \`run\` body: ${(child as Statement).__kind}.`,
                  'execute-run-body-stmt'
                );
              }
            }
          }
        }
      }
      continue;
    }

    attachError(
      node,
      `Unsupported statement in execute.do: ${(stmt as Statement).__kind}. Use \`set\` or \`run @actions.*\`.`,
      'execute-do-stmt'
    );
  }
}

export function checkExecuteRules(root: Record<string, unknown>): void {
  const executors = root.executor;
  if (!isNamedMap(executors)) return;

  const actionDefs = isNamedMap(root.actions)
    ? new Map<string, Record<string, unknown>>(
        [...root.actions].map(([k, v]) => [
          normalizeId(k),
          v as Record<string, unknown>,
        ])
      )
    : undefined;

  for (const [, entry] of executors) {
    if (entry == null || typeof entry !== 'object') continue;
    const executorEntry = entry as Record<string, unknown>;
    if (executorEntry.do == null) continue;
    validateExecuteDo(executorEntry, actionDefs);
  }
}
