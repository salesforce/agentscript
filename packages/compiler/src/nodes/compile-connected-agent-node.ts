/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  NamedMap,
  ParameterDeclarationNode,
  ListLiteral,
  type Expression,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { RelatedAgentNode } from '../types.js';
import type { ParsedConnectedAgent } from '../parsed-types.js';
import type { Sourceable } from '../sourced.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedDescription,
  extractBooleanValue,
  iterateNamedMap,
} from '../ast-helpers.js';
import { normalizeDeveloperName, parseUri } from '../utils.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { extractStatements } from './compile-subagent-node.js';
import { compileDeterministicDirectives } from './compile-directives.js';

/**
 * Compile a connected_subagent block into a RelatedAgentNode.
 */
export function compileConnectedAgentNode(
  name: string,
  block: ParsedConnectedAgent,
  ctx: CompilerContext
): RelatedAgentNode {
  const label =
    extractSourcedString(block.label) ?? normalizeDeveloperName(name);
  const description = extractSourcedDescription(block.description) ?? '';
  const loadingText = extractSourcedString(block.loading_text) ?? undefined;

  const delegateEscalation = extractBooleanValue(block.delegate_escalation);
  const boundInputs = compileBoundInputs(block.inputs, ctx);

  const afterResponseStmts = extractStatements(block.after_response);
  const afterResponse =
    afterResponseStmts && afterResponseStmts.length > 0
      ? compileDeterministicDirectives(afterResponseStmts, ctx, {
          addNextTopicResetAction: true,
          gateOnNextTopicEmpty: true,
        })
      : undefined;

  // Parse target URI (e.g. "agent://Sales_Agent") to derive invocation type/name
  const targetUri = extractStringValue(block.target);
  let invocationTargetType = 'externalService';
  let invocationTargetName = name;

  if (targetUri) {
    const { scheme, path } = parseUri(targetUri);
    if (scheme) invocationTargetType = scheme;
    if (path) invocationTargetName = path;
  }

  const node: Sourceable<RelatedAgentNode> = {
    type: 'related_agent',
    developer_name: name,
    label,
    description,
    invocation_target_type: invocationTargetType,
    invocation_target_name: invocationTargetName,
  };

  if (loadingText !== undefined) {
    node.loading_text = loadingText;
  }
  if (delegateEscalation !== undefined) {
    node.delegate_escalation = delegateEscalation;
  }
  if (boundInputs !== undefined) {
    node.bound_inputs = boundInputs;
  }
  if (afterResponse !== undefined && afterResponse.length > 0) {
    node.after_response = afterResponse;
  }

  ctx.setScriptPath(node, name);

  return node as RelatedAgentNode;
}

/** A bound input value is either a single expression or a list of them. */
type BoundInputValue = string | string[];

function compileBoundInputs(
  inputs: NamedMap<ParameterDeclarationNode> | undefined,
  ctx: CompilerContext
): Record<string, BoundInputValue> | undefined {
  if (!inputs || inputs.size === 0) return undefined;

  const result: Record<string, BoundInputValue> = {};

  for (const [name, decl] of iterateNamedMap(inputs)) {
    if (decl.defaultValue) {
      result[name] = compileBoundInputValue(decl.defaultValue, ctx);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Compile a single bound-input default value.
 *
 * A list literal compiles to an array of compiled element expressions
 * (mirroring the agent-dsl schema where a bound input value may be a
 * scalar/expression or a list of them). A single expression — including a
 * reference to a list-typed variable, e.g. `@variables.account_ids` — compiles
 * to a scalar string as before.
 */
function compileBoundInputValue(
  value: Expression,
  ctx: CompilerContext
): BoundInputValue {
  if (value instanceof ListLiteral) {
    return value.elements.map(element => compileExpression(element, ctx));
  }
  return compileExpression(value, ctx);
}
