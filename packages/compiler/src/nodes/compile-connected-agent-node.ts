/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { NamedMap, ParameterDeclarationNode } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { RelatedAgentNode } from '../types.js';
import type { ParsedConnectedAgent } from '../parsed-types.js';
import type { Sourceable } from '../sourced.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedDescription,
  iterateNamedMap,
} from '../ast-helpers.js';
import { normalizeDeveloperName, parseUri } from '../utils.js';
import { compileExpression } from '../expressions/compile-expression.js';

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

  const boundInputs = compileBoundInputs(block.inputs, ctx);

  // Parse target URI (e.g. "agentforce://Sales_Agent") to derive invocation type/name
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
  if (boundInputs !== undefined) {
    node.bound_inputs = boundInputs;
  }

  ctx.setScriptPath(node, name);

  return node as RelatedAgentNode;
}

function compileBoundInputs(
  inputs: NamedMap<ParameterDeclarationNode> | undefined,
  ctx: CompilerContext
): Record<string, string> | undefined {
  if (!inputs || inputs.size === 0) return undefined;

  const result: Record<string, string> = {};

  for (const [name, decl] of iterateNamedMap(inputs)) {
    if (decl.defaultValue) {
      result[name] = compileExpression(decl.defaultValue, ctx);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
