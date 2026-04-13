/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Template reference validation for reasoning.instructions.
 *
 * Enforces that template interpolations inside instructions text can ONLY
 * reference connected subagents via @actions.X, NOT @connected_subagent.X.
 *
 * Valid:   {!@actions.My_Agent}
 * Invalid: {!@connected_subagent.My_Agent}
 *
 * Note: In reasoning.actions (action definitions), @connected_subagent.X is allowed.
 * This validation only applies to template interpolations in instructions text.
 *
 * Diagnostic: invalid-connected-subagent-reference
 */

import type {
  LintPass,
  PassStore,
  AstNodeLike,
  NamedMap,
} from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  decomposeAtMemberExpression,
  isNamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { CstMeta } from '@agentscript/types';

export const templateReferenceValidationKey = storeKey<void>(
  'template-reference-validation'
);

class TemplateReferenceValidationPass implements LintPass {
  readonly id = templateReferenceValidationKey;
  readonly description =
    'Validates that template interpolations in instructions use @actions.X for connected subagents';
  readonly requires = [];

  run(_store: PassStore, root: AstNodeLike): void {
    const visited = new WeakSet<object>();
    this.walkNode(root, null, visited);
  }

  private walkNode(
    node: unknown,
    parentTopic: AstNodeLike | null,
    visited: WeakSet<object>
  ): void {
    if (!node || typeof node !== 'object') return;

    const astNode = node as AstNodeLike;

    if (visited.has(astNode)) return;
    visited.add(astNode);

    let currentTopic = parentTopic;
    if (
      astNode.__kind === 'SubagentBlock' ||
      astNode.__kind === 'StartAgentBlock'
    ) {
      currentTopic = astNode;
    }

    if (astNode.__kind === 'TemplateInterpolation') {
      this.validateTemplateInterpolation(astNode, currentTopic);
    }

    if ('__children' in astNode && Array.isArray(astNode.__children)) {
      for (const child of astNode.__children) {
        this.walkNode(child, currentTopic, visited);
      }
    }

    for (const key in astNode) {
      if (!Object.hasOwn(astNode, key)) continue;
      if (key.startsWith('__')) continue;
      const value = (astNode as Record<string, unknown>)[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            this.walkNode(item, currentTopic, visited);
          }
        } else {
          this.walkNode(value, currentTopic, visited);
        }
      }
    }
  }

  private validateTemplateInterpolation(
    node: AstNodeLike,
    parentTopic: AstNodeLike | null
  ): void {
    // Get the expression inside the interpolation
    const expression = (node as { expression?: unknown }).expression;
    if (!expression || typeof expression !== 'object') return;

    const expr = expression as Record<string, unknown>;

    // Check if it's a @connected_subagent.X reference
    const decomposed = decomposeAtMemberExpression(expr);
    if (decomposed && decomposed.namespace === 'connected_subagent') {
      const connectedSubagentName = decomposed.property;

      // Find the action alias that references this connected subagent
      const actionAlias = this.findActionAlias(
        parentTopic,
        connectedSubagentName
      );

      // Get the CST range for precise diagnostic location
      const cst = expr.__cst as CstMeta | undefined;
      const range = cst?.range ?? {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      };

      const suggestion = actionAlias
        ? `{!@actions.${actionAlias}}`
        : `{!@actions.<action_alias>}`;

      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Connected subagent '${connectedSubagentName}' cannot be referenced as {!@connected_subagent.${connectedSubagentName}} in template instructions. Use ${suggestion} instead.`,
          DiagnosticSeverity.Error,
          'invalid-connected-subagent-reference'
        )
      );
    }
  }

  private findActionAlias(
    parentTopic: AstNodeLike | null,
    connectedSubagentName: string
  ): string | null {
    if (!parentTopic) return null;

    const reasoning = (parentTopic as Record<string, unknown>).reasoning;
    if (!reasoning || typeof reasoning !== 'object') return null;

    const reasoningObj = reasoning as Record<string, unknown>;
    const actions = reasoningObj.actions;
    if (!actions || !isNamedMap(actions)) return null;

    for (const [alias, actionBlock] of actions as NamedMap<unknown>) {
      if (!actionBlock || typeof actionBlock !== 'object') continue;
      const block = actionBlock as Record<string, unknown>;

      if (block.__kind !== 'ReasoningActionBlock') continue;

      const decomposed = decomposeAtMemberExpression(block.value);
      if (
        decomposed &&
        decomposed.namespace === 'connected_subagent' &&
        decomposed.property === connectedSubagentName
      ) {
        return alias;
      }
    }

    return null;
  }
}

export function templateReferenceValidationPass(): LintPass {
  return new TemplateReferenceValidationPass();
}
