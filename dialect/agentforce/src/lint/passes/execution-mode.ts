/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  AtIdentifier,
  IfStatement,
  RenderStatement,
  RunStatement,
  SetClause,
  WhenStatement,
  WithClause,
  attachDiagnostic,
  decomposeAtMemberExpression,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
  resolveNamespaceKeys,
  schemaContextKey,
  storeKey,
} from '@agentscript/language';
import type {
  AstRoot,
  Expression,
  LintPass,
  PassStore,
  Statement,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { extractStringValue, getBlockRange } from '../utils.js';

function referencesOutputs(value: unknown, seen = new Set<object>()): boolean {
  if (value instanceof AtIdentifier) return value.name === 'outputs';
  if (typeof value !== 'object' || value === null || seen.has(value))
    return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, child]) => !key.startsWith('__') && referencesOutputs(child, seen)
  );
}

function validateOutputs(statements: Statement[]): void {
  const report = (value: Expression): void => {
    if (!isAstNodeLike(value) || !referencesOutputs(value)) return;
    attachDiagnostic(
      value,
      lintDiagnostic(
        getBlockRange(value),
        'Fire-and-forget tools cannot use @outputs from the tool call; only dispatch success is available.',
        DiagnosticSeverity.Error,
        'non-blocking-output-unavailable'
      )
    );
  };
  for (const stmt of statements) {
    if (stmt instanceof SetClause) {
      report(stmt.value);
    } else if (stmt instanceof RunStatement) {
      // Bindings use the tool result; nested state updates use the follow-up action's result.
      for (const child of stmt.body)
        if (child instanceof WithClause) report(child.value);
    } else if (stmt instanceof IfStatement) {
      report(stmt.condition);
      validateOutputs(stmt.body);
      validateOutputs(stmt.orelse);
    } else if (stmt instanceof WhenStatement) {
      for (const child of stmt.body) {
        if (!(child instanceof RenderStatement) || !isAstNodeLike(child))
          continue;
        attachDiagnostic(
          child,
          lintDiagnostic(
            getBlockRange(child),
            'Fire-and-forget tools cannot render the tool result; only dispatch success is available.',
            DiagnosticSeverity.Error,
            'non-blocking-output-unavailable'
          )
        );
      }
    }
  }
}

class ExecutionModePass implements LintPass {
  readonly id = storeKey('execution-mode');
  readonly description =
    'Validates non-blocking tool execution and output availability';
  readonly requires = [schemaContextKey];

  run(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;
    const keys = new Set([
      ...resolveNamespaceKeys('topic', ctx),
      ...resolveNamespaceKeys('subagent', ctx),
      ...resolveNamespaceKeys('orchestrator', ctx),
    ]);
    for (const key of keys) {
      const nodes = root[key];
      if (!isNamedMap(nodes)) continue;
      for (const [, block] of nodes) {
        if (!isAstNodeLike(block) || !isAstNodeLike(block.reasoning)) continue;
        const actions = block.reasoning.actions;
        if (!isNamedMap(actions)) continue;
        const modelConfig = block.model_config;
        const router =
          block.__kind !== 'OrchestratorBlock' &&
          !extractStringValue(block.schema) &&
          isAstNodeLike(modelConfig) &&
          extractStringValue(modelConfig.model)?.includes(
            'sfdc_ai__DefaultEinsteinHyperClassifier'
          );
        for (const [name, action] of actions) {
          if (
            !isAstNodeLike(action) ||
            extractStringValue(action.execution_mode) !== 'fire_and_forget'
          )
            continue;
          const ref = decomposeAtMemberExpression(action.value);
          const supervision =
            ref &&
            ['topic', 'subagent', 'connected_subagent'].includes(ref.namespace);
          const utility =
            !supervision &&
            ((ref?.namespace === 'utils' &&
              [
                'transition',
                'setVariables',
                'escalate',
                'end_session',
              ].includes(ref.property)) ||
              ['transition', 'setVariables', 'escalate'].some(
                utility =>
                  name === utility || name.startsWith(`@utils.${utility}`)
              ));
          if (router || utility) {
            const value = isAstNodeLike(action.execution_mode)
              ? action.execution_mode
              : action;
            attachDiagnostic(
              value,
              lintDiagnostic(
                getBlockRange(value),
                `Reasoning action '${name}' does not support non-blocking execution.`,
                DiagnosticSeverity.Error,
                'execution-mode-unsupported'
              )
            );
          }
          if (Array.isArray(action.statements))
            validateOutputs(action.statements as Statement[]);
        }
      }
    }
  }
}

export function executionModeRule(): LintPass {
  return new ExecutionModePass();
}
