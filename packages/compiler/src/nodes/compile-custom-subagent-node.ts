/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  NamedMap,
  ParameterDeclarationNode,
  MemberExpression,
  decomposeAtMemberExpression,
} from '@agentscript/language';
import type { ProcedureValue } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { BYONNode, BYOClientConfig, Tool } from '../types.js';
import type { ParsedTopicLike } from '../parsed-types.js';
import { extractStringValue, iterateNamedMap } from '../ast-helpers.js';
import { normalizeDeveloperName } from '../utils.js';
import { compileActionDefinitions } from './compile-actions.js';
import { compileDeterministicDirectives } from './compile-directives.js';
import { compileReasoningActions } from './compile-reasoning-actions.js';
import { extractStatements } from './compile-subagent-node.js';
import { compileExpression } from '../expressions/compile-expression.js';

/**
 * If `decl.type` is a `@variables.X` member expression, compile it to its
 * runtime reference (`state.X` or `variables.X`). Returns undefined for any
 * other parameter shape (regular type identifiers like `string`, etc.).
 */
function extractVariableRef(
  decl: ParameterDeclarationNode,
  ctx: CompilerContext
): string | undefined {
  if (!(decl.type instanceof MemberExpression)) return undefined;
  const decomposed = decomposeAtMemberExpression(decl.type);
  if (decomposed?.namespace !== 'variables') return undefined;
  return compileExpression(decl.type, ctx);
}

/**
 * Hardcoded byo_client configuration for the Commerce Cloud Shopper variant.
 * Users don't write byo_client in .agent files — it's derived from the schema URI.
 */
export const COMMERCE_SHOPPER_BYO_CLIENT: BYOClientConfig = {
  client_ref: 'icr-default',
  configuration: {
    node_type_id: 'commerce_shopper_agent',
    node_namespace: 'commerceshopperagent',
  },
};

/**
 * Hardcoded byo_client configuration for the Tableau Analyze Data variant.
 * Users don't write byo_client in .agent files — it's derived from the schema URI.
 */
export const TABLEAU_ANALYZE_DATA_BYO_CLIENT: BYOClientConfig = {
  client_ref: 'icr-default',
  configuration: {
    node_type_id: 'waii_analytics_agent',
    node_namespace: 'waiianalyticsagent',
  },
};

const NODE_URI_SCHEME = 'node://';
const BYON_PATH_PREFIX = 'byon/';

/**
 * Derive a BYOClientConfig from a generic BYON schema URI of the shape
 * `node://byon/<namespace>/<type>/<version>`. Returns undefined if the URI
 * doesn't match that exact 3-segment shape under `node://byon/`.
 *
 * The version segment is required (so it can be wired into byo_client.configuration
 * later without a breaking change) but is currently discarded.
 */
export function deriveByonClient(
  schemaUri: string
): BYOClientConfig | undefined {
  if (!schemaUri.startsWith(NODE_URI_SCHEME)) return undefined;
  const path = schemaUri.slice(NODE_URI_SCHEME.length);
  if (!path.startsWith(BYON_PATH_PREFIX)) return undefined;
  const segments = path.slice(BYON_PATH_PREFIX.length).split('/');
  if (segments.length !== 3) return undefined;
  const [namespace, typeId] = segments;
  if (!namespace || !typeId || !segments[2]) return undefined;
  return {
    client_ref: 'icr-default',
    configuration: {
      node_type_id: typeId,
      node_namespace: namespace,
    },
  };
}

/**
 * Compile a custom subagent block into a BYONNode.
 *
 * The byo_client configuration is determined by the schema discriminant value
 * via `resolveByoClient` in compile-agent-version.ts. Named variants (exact URI
 * match) take precedence over the generic node://byon/* derivation:
 *   - node://commerce/shopper_agent/v1 → COMMERCE_SHOPPER_BYO_CLIENT
 *   - node://tableau/analyze_data/v1   → TABLEAU_ANALYZE_DATA_BYO_CLIENT
 *   - node://byon/<namespace>/<type>/<version> → derived via deriveByonClient()
 */
export function compileCustomSubagentNode(
  name: string,
  block: ParsedTopicLike,
  byoClient: BYOClientConfig,
  topicDescriptions: Record<string, string>,
  ctx: CompilerContext
): BYONNode {
  const description = extractStringValue(block.description) ?? '';
  const label = extractStringValue(block.label) ?? normalizeDeveloperName(name);

  // Compile input_parameters from parameters.template
  const inputParameters = compileInputParameters(
    block.parameters as Record<string, unknown> | undefined,
    ctx
  );

  const actionsBlock = block.actions as
    | NamedMap<Record<string, unknown>>
    | undefined;

  // Compile action definitions (catalog)
  const actionDefinitions = compileActionDefinitions(actionsBlock, ctx);

  // Derive tools from action inputs with @variables.X bindings
  const boundInputTools = compileTools(actionsBlock, ctx);

  // Compile reasoning.actions into tools
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- compiler handles both topic and subagent reasoning shapes generically
  const reasoning = block.reasoning as Record<string, any> | undefined;
  const reasoningResult = compileReasoningActions(
    reasoning,
    {
      nodeType: 'subagent',
      topicName: name,
      topicDescriptions,
    },
    ctx
  );

  // Merge bound-input tools with reasoning action tools
  const allTools: BYONNode['tools'] = [
    ...boundInputTools,
    ...(reasoningResult.tools as Tool[]),
  ];

  // Compile on_init / on_exit lifecycle hooks (same as before_reasoning/after_reasoning)
  const onInitStmts = extractStatements(
    block.on_init as ProcedureValue | undefined
  );
  const onInit = onInitStmts?.length
    ? compileDeterministicDirectives(onInitStmts, ctx, {
        addNextTopicResetAction: false,
        gateOnNextTopicEmpty: false,
      })
    : null;

  const onExitStmts = extractStatements(
    block.on_exit as ProcedureValue | undefined
  );
  const onExit = onExitStmts?.length
    ? compileDeterministicDirectives(onExitStmts, ctx, {
        addNextTopicResetAction: false,
        gateOnNextTopicEmpty: false,
      })
    : null;

  const node: BYONNode = {
    type: 'byon',
    developer_name: name,
    description,
    label,
    byo_client: byoClient,
  };

  if (inputParameters && Object.keys(inputParameters).length > 0) {
    node.input_parameters = inputParameters;
  }

  if (actionDefinitions.length > 0) {
    node.action_definitions = actionDefinitions;
  }

  if (allTools.length > 0) {
    node.tools = allTools;
  }

  if (onInit && onInit.length > 0) {
    node.on_init = onInit;
  }

  if (onExit && onExit.length > 0) {
    node.on_exit = onExit as BYONNode['on_exit'];
  }

  ctx.setScriptPath(node, name);

  return node;
}

// ---------------------------------------------------------------------------
// parameters.template → input_parameters
// ---------------------------------------------------------------------------

function compileInputParameters(
  parametersBlock: Record<string, unknown> | undefined,
  ctx: CompilerContext
): Record<string, unknown> | undefined {
  if (!parametersBlock) return undefined;

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(parametersBlock)) {
    if (key.startsWith('__')) continue;
    const group = parametersBlock[key];
    if (!(group instanceof NamedMap)) continue;
    for (const [paramKey, rawDecl] of iterateNamedMap(
      group as NamedMap<ParameterDeclarationNode>
    )) {
      const ref = extractVariableRef(rawDecl as ParameterDeclarationNode, ctx);
      if (ref) result[paramKey] = ref;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// action @variables.X inputs → tools[].bound_inputs
// ---------------------------------------------------------------------------

function compileTools(
  actions: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): Array<{
  type: 'action';
  target: string;
  name: string;
  bound_inputs: Record<string, unknown>;
}> {
  if (!actions) return [];

  const tools: Array<{
    type: 'action';
    target: string;
    name: string;
    bound_inputs: Record<string, unknown>;
  }> = [];

  for (const [actionName, def] of iterateNamedMap(actions)) {
    const inputs = def['inputs'] as
      | NamedMap<ParameterDeclarationNode>
      | undefined;
    if (!inputs) continue;

    const boundInputs: Record<string, unknown> = {};

    for (const [inputName, rawDecl] of iterateNamedMap(inputs)) {
      const ref = extractVariableRef(rawDecl as ParameterDeclarationNode, ctx);
      if (ref) boundInputs[inputName] = ref;
    }

    if (Object.keys(boundInputs).length > 0) {
      tools.push({
        type: 'action',
        target: actionName,
        name: actionName,
        bound_inputs: boundInputs,
      });
    }
  }

  return tools;
}
