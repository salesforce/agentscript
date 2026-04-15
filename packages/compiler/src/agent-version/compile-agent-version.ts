import type { CompilerContext } from '../compiler-context.js';
import type { Sourceable } from '../sourced.js';
import type {
  AgentVersion,
  AgentNode,
  ContextVariable,
  AdditionalParameters,
} from '../types.js';
import type {
  ParsedAgentforce,
  ParsedTopicLike,
  ParsedConnectedAgent,
} from '../parsed-types.js';
import { DEFAULT_PLANNER_TYPE } from '../constants.js';
import { ParameterDeclarationNode } from '@agentscript/language';
import {
  extractStringValue,
  extractDescriptionValue,
  iterateNamedMap,
} from '../ast-helpers.js';
import { compileStateVariables } from '../variables/state-variables.js';
import {
  compileSystemMessages,
  serializeSystemMessagesForAdditionalParams,
} from '../system-messages/compile-system-messages.js';
import { compileModalityParameters } from '../modality/compile-modality.js';
import { compileNode } from '../nodes/compile-node.js';
import { compileConnectedAgentNode } from '../nodes/compile-connected-agent-node.js';
import {
  compileCustomSubagentNode,
  COMMERCE_SHOPPER_BYO_CLIENT,
} from '../nodes/compile-custom-subagent-node.js';
import { COMMERCE_SHOPPER_SCHEMA } from '@agentscript/agentforce-dialect';
import { compileSurfaces } from '../surfaces/compile-surfaces.js';
import { extractCompanyAndRole } from '../config/agent-configuration.js';
import { extractGlobalModelConfiguration } from '../config/model-config.js';

/**
 * Compile the agent version from the parsed AST.
 */
export function compileAgentVersion(
  parsed: ParsedAgentforce,
  contextVariables: ContextVariable[],
  additionalParameters: AdditionalParameters | undefined,
  ctx: CompilerContext
): AgentVersion {
  // Collect all topic/start_agent blocks
  const blocks = collectTopicBlocks(parsed);

  // Compile state variables
  const stateVariables = compileStateVariables(
    parsed.variables,
    contextVariables,
    blocks.map(b => b.block),
    ctx
  );
  ctx.stateVariables = stateVariables;

  // Compile system messages
  const systemMessages = compileSystemMessages(parsed.system, ctx);

  // Compile modality parameters
  const modalityParameters = compileModalityParameters(
    parsed.language,
    parsed.modality,
    ctx
  );

  // Get initial node (from start_agent block)
  const initialNode = getInitialNodeName(parsed, ctx);

  // Build topic descriptions for transition inheritance
  const topicDescriptions = createTopicDescriptions(blocks);

  // Extract global model_config (agent-wide defaults)
  const globalModelConfig = extractGlobalModelConfiguration(parsed, ctx);

  // Populate connected agent input signatures BEFORE compiling topics,
  // so that tool invocation validation in compile-tool.ts can check
  // unknown/missing inputs on @connected_subagent.X references.
  if (parsed.connected_subagent) {
    for (const [name, block] of iterateNamedMap(parsed.connected_subagent)) {
      populateConnectedAgentInputSignature(
        name,
        block as ParsedConnectedAgent,
        ctx
      );
    }
  }

  // Compile all nodes
  const nodes: AgentNode[] = [];
  for (const { name, block } of blocks) {
    const schemaValue = extractStringValue(block.schema);
    if (schemaValue === COMMERCE_SHOPPER_SCHEMA) {
      nodes.push(
        compileCustomSubagentNode(name, block, COMMERCE_SHOPPER_BYO_CLIENT, ctx)
      );
    } else {
      const node = compileNode(
        name,
        block,
        parsed.system,
        topicDescriptions,
        globalModelConfig,
        ctx
      );
      nodes.push(node);
    }
  }

  // Compile connected agent nodes
  if (parsed.connected_subagent) {
    for (const [name, block] of iterateNamedMap(parsed.connected_subagent)) {
      const node = compileConnectedAgentNode(
        name,
        block as ParsedConnectedAgent,
        ctx
      );
      nodes.push(node);
    }
  }

  // Compile surfaces
  const agentType = extractStringValue(parsed.config?.agent_type);
  const surfaces = compileSurfaces(
    parsed.connection,
    agentType ?? undefined,
    ctx
  );

  // Company and role
  const { company, role } = extractCompanyAndRole(parsed.config);

  // Merge system messages into additional_parameters
  const mergedAdditionalParams = mergeSystemMessagesIntoAdditionalParams(
    additionalParameters,
    systemMessages
  );

  // Determine if modality_parameters should be included
  // Include if either language OR voice is present
  const hasModalityParameters =
    modalityParameters.language !== null ||
    modalityParameters.voice !== undefined;

  const version: Sourceable<AgentVersion> = {
    planner_type: DEFAULT_PLANNER_TYPE,
    system_messages: systemMessages,
    state_variables: stateVariables,
    initial_node: initialNode,
    nodes: nodes as AgentVersion['nodes'],
    surfaces: surfaces as AgentVersion['surfaces'],
    // Include modality_parameters if either language or voice is present
    modality_parameters: hasModalityParameters ? modalityParameters : {},
  };

  if (mergedAdditionalParams) {
    version.additional_parameters =
      mergedAdditionalParams as AgentVersion['additional_parameters'];
  }

  if (company !== null || role !== null) {
    version.company = company;
    version.role = role;
  }

  return version as AgentVersion;
}

// ---------------------------------------------------------------------------
// Block Collection
// ---------------------------------------------------------------------------

interface TopicEntry {
  name: string;
  block: ParsedTopicLike;
  isStartAgent: boolean;
}

function collectTopicBlocks(parsed: ParsedAgentforce): TopicEntry[] {
  const blocks: TopicEntry[] = [];

  // Collect start_agent blocks
  if (parsed.start_agent) {
    for (const [name, block] of iterateNamedMap(parsed.start_agent)) {
      blocks.push({
        name,
        block: block as ParsedTopicLike,
        isStartAgent: true,
      });
    }
  }

  // Collect topic blocks
  if (parsed.topic) {
    for (const [name, block] of iterateNamedMap(parsed.topic)) {
      blocks.push({
        name,
        block: block as ParsedTopicLike,
        isStartAgent: false,
      });
    }
  }

  // Collect subagent blocks
  if (parsed.subagent) {
    for (const [name, block] of iterateNamedMap(parsed.subagent)) {
      blocks.push({
        name,
        block: block as ParsedTopicLike,
        isStartAgent: false,
      });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Initial Node
// ---------------------------------------------------------------------------

function getInitialNodeName(
  parsed: ParsedAgentforce,
  ctx: CompilerContext
): string {
  if (!parsed.start_agent || parsed.start_agent.size === 0) {
    ctx.error('No start_agent block found');
    return 'start_agent';
  }

  if (parsed.start_agent.size > 1) {
    ctx.error('Multiple start_agent blocks found; only one is allowed');
  }

  const [firstName] = parsed.start_agent.keys();
  return firstName;
}

// ---------------------------------------------------------------------------
// Topic Descriptions
// ---------------------------------------------------------------------------

function createTopicDescriptions(blocks: TopicEntry[]): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const { name, block } of blocks) {
    const desc = extractDescriptionValue(block.description);
    if (desc) {
      descriptions[name] = desc;
    }
  }
  return descriptions;
}

// ---------------------------------------------------------------------------
// Additional Parameters Merge
// ---------------------------------------------------------------------------

function populateConnectedAgentInputSignature(
  name: string,
  block: ParsedConnectedAgent,
  ctx: CompilerContext
): void {
  const allInputs = new Set<string>();
  const inputsWithDefaults = new Set<string>();

  if (block.inputs) {
    for (const [inputName, paramDef] of iterateNamedMap(block.inputs)) {
      allInputs.add(inputName);
      const decl = paramDef as ParameterDeclarationNode;
      if (decl.defaultValue) {
        inputsWithDefaults.add(inputName);
      }
    }
  }

  ctx.connectedAgentInputs.set(name, { allInputs, inputsWithDefaults });
}

function mergeSystemMessagesIntoAdditionalParams(
  additionalParameters: AdditionalParameters | undefined,
  systemMessages: import('../types.js').SystemMessage[]
): AdditionalParameters | undefined {
  const serialized = serializeSystemMessagesForAdditionalParams(systemMessages);

  // Default reset_to_initial_node to true, but allow explicit false from config
  const result: AdditionalParameters = {
    reset_to_initial_node: true,
    ...additionalParameters,
  };

  if (serialized) {
    result.system_messages = serialized;
  }

  return result;
}
