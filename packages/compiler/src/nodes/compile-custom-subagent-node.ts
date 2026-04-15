import {
  NamedMap,
  ParameterDeclarationNode,
  MemberExpression,
  decomposeAtMemberExpression,
} from '@agentscript/language';
import type { ProcedureValue } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { BYONNode, BYOClientConfig } from '../types.js';
import type { ParsedTopicLike } from '../parsed-types.js';
import { extractStringValue, iterateNamedMap } from '../ast-helpers.js';
import { normalizeDeveloperName } from '../utils.js';
import { compileActionDefinitions } from './compile-actions.js';
import { compileDeterministicDirectives } from './compile-directives.js';
import { extractStatements } from './compile-subagent-node.js';

/**
 * If `decl.type` is a `@variables.X` member expression, returns `"variables.X"`.
 * Otherwise returns undefined.
 */
function extractVariableRef(
  decl: ParameterDeclarationNode
): string | undefined {
  if (!(decl.type instanceof MemberExpression)) return undefined;
  const decomposed = decomposeAtMemberExpression(decl.type);
  if (decomposed?.namespace !== 'variables') return undefined;
  return `variables.${decomposed.property}`;
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
 * Compile a custom subagent block into a BYONNode.
 *
 * The byo_client configuration is determined by the schema discriminant value.
 * Currently supports:
 *   - node://commerce/cloud_shopper/v1 → icr-commerce-shopper / commerce_cloud_shopper
 */
export function compileCustomSubagentNode(
  name: string,
  block: ParsedTopicLike,
  byoClient: BYOClientConfig,
  ctx: CompilerContext
): BYONNode {
  const description = extractStringValue(block.description) ?? '';
  const label = extractStringValue(block.label) ?? normalizeDeveloperName(name);

  // Compile input_parameters from parameters.template
  const inputParameters = compileInputParameters(
    block.parameters as Record<string, unknown> | undefined
  );

  const actionsBlock = block.actions as
    | NamedMap<Record<string, unknown>>
    | undefined;

  // Compile action definitions (catalog)
  const actionDefinitions = compileActionDefinitions(actionsBlock, ctx);

  // Derive tools from action inputs with @variables.X bindings
  const tools = compileTools(actionsBlock);

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

  if (tools.length > 0) {
    node.tools = tools as BYONNode['tools'];
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
  parametersBlock: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!parametersBlock) return undefined;

  const template = parametersBlock['template'] as
    | NamedMap<ParameterDeclarationNode>
    | undefined;
  if (!template || template.size === 0) return undefined;

  const result: Record<string, unknown> = {};

  for (const [key, rawDecl] of iterateNamedMap(template)) {
    const ref = extractVariableRef(rawDecl as ParameterDeclarationNode);
    if (ref) result[key] = ref;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// action @variables.X inputs → tools[].bound_inputs
// ---------------------------------------------------------------------------

function compileTools(
  actions: NamedMap<Record<string, unknown>> | undefined
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
      const ref = extractVariableRef(rawDecl as ParameterDeclarationNode);
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
