/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  attachDiagnostic,
  getKeyText,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
} from '@agentscript/language';

import type { AstNodeLike, Range } from '@agentscript/language';
import { DiagnosticSeverity, toRange } from '@agentscript/types';

function fallbackRange(node: AstNodeLike): Range {
  return (
    node.__cst?.range ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    }
  );
}

function authoredFieldRange(
  workflow: AstNodeLike,
  fieldName: string
): Range | undefined {
  const bodyNode = workflow.__cst?.node;
  if (!bodyNode) return undefined;

  for (const child of bodyNode.namedChildren) {
    if (child.type !== 'mapping_element') continue;
    const keyNode = child.childForFieldName('key');
    if (!keyNode) continue;
    const keyParts = keyNode.namedChildren
      .filter(part => part.type === 'id' || part.type === 'string')
      .map(getKeyText);
    if (keyParts[0] === fieldName) return toRange(child);
  }

  return undefined;
}

function attachError(
  target: AstNodeLike,
  range: Range,
  message: string,
  code: string
): void {
  attachDiagnostic(
    target,
    lintDiagnostic(range, message, DiagnosticSeverity.Error, code)
  );
}

/** Validate the mutually exclusive flow shapes of a workflow. */
export function validateStepsWorkflow(workflow: AstNodeLike): void {
  const unnamed = workflow.steps;
  const named = workflow.step;
  const unnamedRange = authoredFieldRange(workflow, 'steps');
  const namedRange = authoredFieldRange(workflow, 'step');

  // Consult CST presence as well as the AST so a bare `steps:` field is
  // recognized as an authored-but-empty flow instead of a missing flow.
  const hasUnnamed = unnamed !== undefined || unnamedRange !== undefined;
  const hasNamed =
    (isNamedMap(named) && named.size > 0) || namedRange !== undefined;

  if (!hasUnnamed && !hasNamed) {
    attachError(
      workflow,
      fallbackRange(workflow),
      "A workflow must define either 'steps:' or one or more named 'step <name>:' blocks.",
      'workflow-step-form-required'
    );
    return;
  }

  if (hasUnnamed && hasNamed) {
    attachError(
      workflow,
      namedRange ?? unnamedRange ?? fallbackRange(workflow),
      "A workflow cannot mix 'steps:' with named 'step <name>:' blocks.",
      'workflow-step-form-conflict'
    );
  }

  if (hasUnnamed) {
    const statements =
      isAstNodeLike(unnamed) && Array.isArray(unnamed.statements)
        ? unnamed.statements
        : [];
    if (statements.length === 0) {
      attachError(
        isAstNodeLike(unnamed) ? unnamed : workflow,
        unnamedRange ?? fallbackRange(workflow),
        "The 'steps:' workflow flow must contain at least one directive.",
        'workflow-empty-steps'
      );
    }
  }

  if (!isNamedMap(named)) return;

  for (const [name, rawStep] of named) {
    if (!isAstNodeLike(rawStep)) continue;
    const statements = Array.isArray(rawStep.statements)
      ? rawStep.statements
      : [];
    if (statements.length > 0) continue;

    attachError(
      rawStep,
      fallbackRange(rawStep),
      `Workflow step '${name}' must contain at least one directive.`,
      'workflow-empty-step'
    );
  }
}
