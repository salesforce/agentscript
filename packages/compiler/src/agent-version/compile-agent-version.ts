/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { Sourceable } from '../sourced.js';
import type {
  AgentVersion,
  AgentNode,
  ContextVariable,
  AdditionalParameters,
  RuntimeConfiguration,
} from '../types.js';
import type {
  ParsedAgentforce,
  ParsedTopicLike,
  ParsedConnectedAgent,
  ParsedWorkflowProcedure,
} from '../parsed-types.js';
import {
  DEFAULT_PLANNER_TYPE,
  chainConditionStateVariable,
  SYSTEM_INSTRUCTION_STATE_VARIABLE,
} from '../constants.js';
import { ParameterDeclarationNode } from '@agentscript/language';
import { workflowNameCollisions } from '@agentscript/agentscript-dialect';
import {
  extractStringValue,
  extractDescriptionValue,
  iterateNamedMap,
} from '../ast-helpers.js';
import { compileRecommendedPrompts } from '../recommendations/compile-recommendations.js';
import { compileStateVariables } from '../variables/state-variables.js';
import {
  compileSystemMessages,
  serializeSystemMessagesForAdditionalParams,
} from '../system-messages/compile-system-messages.js';
import { compileModalityParameters } from '../modality/compile-modality.js';
import { compileNode } from '../nodes/compile-node.js';
import { compileConnectedAgentNode } from '../nodes/compile-connected-agent-node.js';
import {
  compileTopLevelActions,
  mergeTopLevelActionsIntoSubagent,
} from '../nodes/compile-top-level-actions.js';
import { compileOrchestratorNode } from '../nodes/compile-orchestrator-node.js';
import { compileWorkflowNode } from '../nodes/compile-workflow-node.js';
import { compileBundles } from './compile-bundles.js';
import { compileSkillDefinitions } from './compile-skill-definitions.js';
import { compileWorkflows } from './compile-workflows.js';
import { compileTriggers } from './compile-triggers.js';
import {
  compileCustomSubagentNode,
  COMMERCE_SHOPPER_BYO_CLIENT,
  TABLEAU_ANALYZE_DATA_BYO_CLIENT,
  deriveByonClient,
} from '../nodes/compile-custom-subagent-node.js';
import type { BYOClientConfig } from '../types.js';
import {
  COMMERCE_SHOPPER_SCHEMA,
  TABLEAU_ANALYZE_DATA_SCHEMA,
  BYON_SCHEMA_PREFIX,
} from '@agentscript/agentforce-dialect';
import { compileSurfaces } from '../surfaces/compile-surfaces.js';
import type { FileUploadConfiguration } from '../config/compile-file-upload.js';
import type { BillingConfiguration } from '../config/compile-billing.js';
import { extractCompanyAndRole } from '../config/agent-configuration.js';
import { extractGlobalModelConfiguration } from '../config/model-config.js';

/**
 * Drain the per-node uploaded_files accumulator onto the node as a
 * `file_references` array and close the capture window (so post-loop surfaces
 * are flagged, not silently dropped).
 *
 * Only router/subagent nodes carry `file_references` (the agent-dsl
 * `SubAgentRouterMixin`, which the reasoner reads only for subagent nodes) —
 * related-agent/BYON nodes have no such field, so a capture there would be
 * dead data the runtime never consumes. We narrow to those two node types
 * before attaching. `enabled` is dropped when absent (never emitted as
 * `enabled: undefined`).
 */
function attachFileReferences(node: AgentNode, ctx: CompilerContext): void {
  // Close the node capture window and take what was captured. Draining always
  // clears node scope, so post-loop surfaces are flagged rather than silently
  // attached.
  const fileReferences = ctx.fileCapture.drainNode();

  // Narrow on `type` — `'file_references' in node` would not work here: the key
  // isn't present on a freshly-built node, so the check would always be false.
  if (
    fileReferences.length > 0 &&
    (node.type === 'router' || node.type === 'subagent')
  ) {
    node.file_references = fileReferences.map(entry => {
      if (entry.enabled) return entry;
      // Drop the enabled key entirely when absent.
      const { enabled: _enabled, ...rest } = entry;
      return rest;
    });
  }
}

/**
 * Compile the agent version from the parsed AST.
 */
export function compileAgentVersion(
  parsed: ParsedAgentforce,
  contextVariables: ContextVariable[],
  additionalParameters: AdditionalParameters | undefined,
  runtime: RuntimeConfiguration | undefined,
  fileUpload: FileUploadConfiguration | undefined,
  billing: BillingConfiguration | undefined,
  ctx: CompilerContext
): AgentVersion {
  // Decide whether uploaded_files references are captured for this agent. Only
  // `file_upload.mode: managed` consumes per-node `file_references`: the reasoner
  // reads them solely in its managed branch (`_apply_managed_mode`) to filter the
  // LLM request's attachments. Every other mode — `auto`/`error`/`disabled` and
  // an absent block (which defaults to `auto`) — never reads them, so emitting
  // there is dead data. Capture only under managed. Set before the node loop
  // opens any capture window.
  ctx.fileCapture.enabled = fileUpload?.mode === 'managed';

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
  // Expose the initial node to downstream node compilation (collect lowering
  // targets the completion handoff at the graph router / initial node).
  ctx.initialNode = initialNode;

  // Build topic descriptions for transition inheritance
  const topicDescriptions = createTopicDescriptions(
    blocks,
    parsed.connected_subagent,
    parsed.workflow
  );

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

  // Compile top-level actions (GBA). These are inherited by every subagent:
  // their action definitions and synthesized tool references are prepended to
  // each subagent node below. Compiled ONCE before the node loop — the
  // synthesized tools carry no input-signature dependency, and each node's own
  // `compileActionDefinitions` re-clears and repopulates `actionInputSignatures`
  // for its local actions (see Risk R5).
  const topLevelActions = compileTopLevelActions(parsed.actions, ctx);

  // Compile all nodes
  const nodes: AgentNode[] = [];
  // Tracks whether the agent contains a Tableau Analyze Data node, which
  // requires an agent-wide additional parameter (see merge step below).
  let hasTableauAnalyzeDataNode = false;
  for (const { name, block, isStartAgent } of blocks) {
    // Open a fresh file-reference capture window for this node.
    ctx.fileCapture.enterNode();
    ctx.nodeConditionSlotBase = 0;

    const schemaValue = extractStringValue(block.schema);
    if (schemaValue === TABLEAU_ANALYZE_DATA_SCHEMA) {
      hasTableauAnalyzeDataNode = true;
    }
    const byoClient = resolveByoClient(schemaValue, name, ctx);
    let node: AgentNode;
    if (byoClient) {
      node = compileCustomSubagentNode(
        name,
        block,
        byoClient,
        topicDescriptions,
        ctx
      );
    } else {
      node = compileNode(
        name,
        block,
        parsed.system,
        topicDescriptions,
        globalModelConfig,
        ctx
      );
    }
    // Inherit top-level actions into every regular subagent node, EXCEPT the
    // node designated as start_agent — the entry/router node routes to other
    // subagents and does not receive the global actions (see mapping doc).
    // BYON custom subagents also compile to `subagent` nodes and do inherit.
    if (node.type === 'subagent' && !isStartAgent) {
      mergeTopLevelActionsIntoSubagent(node, topLevelActions);
    }

    attachFileReferences(node, ctx);
    nodes.push(node);
  }

  // Compile orchestrator nodes (GBA entry point)
  const parsedWithOrchestrator = parsed as ParsedAgentforce & {
    orchestrator?: Map<string, unknown>;
  };
  if (parsedWithOrchestrator.orchestrator) {
    if (parsedWithOrchestrator.orchestrator.size > 1) {
      ctx.error(
        'A GoalBasedAgent script may only contain one orchestrator block.'
      );
    }
    let orchestratorCount = 0;
    for (const [name, block] of iterateNamedMap(
      parsedWithOrchestrator.orchestrator
    )) {
      if (orchestratorCount++ > 0) break;
      const node = compileOrchestratorNode(
        name,
        block as Record<string, unknown>,
        globalModelConfig,
        ctx
      );
      nodes.push(node as unknown as AgentNode);
    }
  }

  // Compile workflow nodes (`workflow <name>:` blocks). A workflow named like
  // another node would emit a second node with the same `developer_name`.
  const nameCollisions = new Map(
    workflowNameCollisions(parsed).map(c => [c.name, c])
  );
  for (const [name, block] of iterateNamedMap(parsed.workflow)) {
    const collision = nameCollisions.get(name);
    if (collision) {
      ctx.error(
        collision.message,
        collision.workflow.__cst?.range,
        'workflow-duplicate-node-name'
      );
      continue;
    }
    // Workflow nodes cannot represent file_references. Keep capture closed and
    // diagnose prompt references rather than silently discarding attachments.
    const node = ctx.fileCapture.withUnsupportedNode('workflow', () =>
      compileWorkflowNode(
        name,
        block as ParsedWorkflowProcedure,
        globalModelConfig,
        ctx
      )
    );
    nodes.push(node as unknown as AgentNode);
  }

  // Compile connected agent nodes
  if (parsed.connected_subagent) {
    for (const [name, block] of iterateNamedMap(parsed.connected_subagent)) {
      // Open a fresh file-reference capture window for this node.
      ctx.fileCapture.enterNode();
      ctx.nodeConditionSlotBase = 0;

      const node = compileConnectedAgentNode(
        name,
        block as ParsedConnectedAgent,
        ctx
      );

      attachFileReferences(node, ctx);
      nodes.push(node);
    }
  }

  // Append per-chain-link condition slot variables. Node compilation tracks
  // the maximum chain depth observed across the agent in
  // `ctx.maxChainConditionSlot`; we declare slots 1..N here, after nodes have
  // been compiled. Sharing the counter across all nodes means a node with a
  // shallower chain doesn't allocate fresh indices.
  for (let i = 1; i <= ctx.maxChainConditionSlot; i++) {
    stateVariables.push(chainConditionStateVariable(i));
  }

  if (ctx.usesDynamicSystemInstructions) {
    const collisionIndex = stateVariables.findIndex(
      variable =>
        variable.developer_name ===
        SYSTEM_INSTRUCTION_STATE_VARIABLE.developer_name
    );
    if (collisionIndex >= 0) {
      const declaration = parsed.variables?.get(
        SYSTEM_INSTRUCTION_STATE_VARIABLE.developer_name
      );
      ctx.error(
        `Variable '${SYSTEM_INSTRUCTION_STATE_VARIABLE.developer_name}' is reserved when conditional system instructions are used. Rename the user-defined variable.`,
        declaration?.__cst?.range,
        'dynamic-system-instructions-variable-conflict'
      );
      stateVariables.splice(collisionIndex, 1, {
        ...SYSTEM_INSTRUCTION_STATE_VARIABLE,
      });
    } else {
      stateVariables.push({ ...SYSTEM_INSTRUCTION_STATE_VARIABLE });
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
    systemMessages,
    hasTableauAnalyzeDataNode
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

  if (runtime) {
    version.runtime = runtime;
  }

  if (company !== null || role !== null) {
    version.company = company;
    version.role = role;
  }

  // Compile recommended prompts from system > recommended_prompts
  const systemBlock = parsed.system as
    | { recommended_prompts?: Record<string, unknown> }
    | null
    | undefined;
  const recommendedPrompts = compileRecommendedPrompts(
    systemBlock?.recommended_prompts as
      | Record<string, unknown>
      | null
      | undefined,
    ctx
  );
  if (recommendedPrompts) {
    // Value validation (welcome_screen gating, min-3 / max-20 entries,
    // per-string length) runs at lint time in the dialect pass
    // `recommended-prompts-validation.ts`, so authors see live diagnostics.
    // The compiler only extracts and serializes the block here.
    (version as Record<string, unknown>).recommended_prompts =
      recommendedPrompts;
  }

  // Attach runtime configuration (rc110: moved from global_configuration to agent_version).
  if (runtime) {
    version.runtime = runtime;
  }

  // Attach file_upload configuration. Upload handling is version-specific
  // behavior, so it lives on agent_version alongside runtime rather than on
  // global_configuration.
  if (fileUpload) {
    version.file_upload = fileUpload;
  }

  // Attach billing configuration. Billing mode is version-specific (the DSL
  // places `billing` on agent_version, not global_configuration).
  if (billing) {
    version.billing = billing;
  }

  // Attach GBA version-level arrays (bundles / workflows / triggers), only when
  // non-empty — mirroring the conditional-attach pattern used above.
  const bundles = compileBundles(parsed.bundles, ctx);
  if (bundles.length > 0) {
    version.bundles = bundles;
  }
  // Top-level skill definitions, referenced by local handle from subagent
  // `reasoning.skills` (each node ref compiles to a { name, target }
  // NodeSkillReference).
  const skillDefinitions = compileSkillDefinitions(
    (
      parsed as {
        skill_definitions?: Parameters<typeof compileSkillDefinitions>[0];
      }
    ).skill_definitions
  );
  if (skillDefinitions.length > 0) {
    version.skill_definitions = skillDefinitions;
  }
  const workflows = compileWorkflows(parsed.workflows, ctx);
  if (workflows.length > 0) {
    version.workflows = workflows;
  }
  const triggers = compileTriggers(parsed.trigger, ctx);
  if (triggers.length > 0) {
    version.triggers = triggers;
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
  // GBA: entry point is the orchestrator block
  const parsedWithOrchestrator = parsed as ParsedAgentforce & {
    orchestrator?: Map<string, unknown>;
  };
  if (
    parsedWithOrchestrator.orchestrator &&
    parsedWithOrchestrator.orchestrator.size > 0
  ) {
    const [firstName] = parsedWithOrchestrator.orchestrator.keys();
    return firstName;
  }

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

function createTopicDescriptions(
  blocks: TopicEntry[],
  connectedAgents?: Map<string, ParsedConnectedAgent>,
  workflows?: Map<string, ParsedWorkflowProcedure>
): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const { name, block } of blocks) {
    const desc = extractDescriptionValue(block.description);
    if (desc) {
      descriptions[name] = desc;
    }
  }
  // Connected subagents compile through a separate node path and are not in
  // `blocks`, so their authored description is gathered here as well. A
  // `@utils.transition to @connected_subagent.X` inherits its tool description
  // from this map (see compile-transition.ts).
  for (const [name, block] of iterateNamedMap(connectedAgents)) {
    if (descriptions[name]) continue;
    const desc = extractDescriptionValue(block.description);
    if (desc) {
      descriptions[name] = desc;
    }
  }
  // Workflows are likewise compiled outside `blocks`; a
  // `@utils.transition to @workflow.X` inherits the workflow's description.
  for (const [name, block] of iterateNamedMap(workflows)) {
    if (descriptions[name]) continue;
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

function resolveByoClient(
  schemaValue: string | null | undefined,
  subagentName: string,
  ctx: CompilerContext
): BYOClientConfig | undefined {
  if (!schemaValue) return undefined;
  if (schemaValue === COMMERCE_SHOPPER_SCHEMA)
    return COMMERCE_SHOPPER_BYO_CLIENT;
  if (schemaValue === TABLEAU_ANALYZE_DATA_SCHEMA)
    return TABLEAU_ANALYZE_DATA_BYO_CLIENT;
  if (!schemaValue.startsWith(BYON_SCHEMA_PREFIX)) return undefined;
  const client = deriveByonClient(schemaValue);
  if (!client) {
    ctx.error(
      `Subagent '${subagentName}' has a malformed BYON schema URI '${schemaValue}'. Expected node://byon/<namespace>/<type>/<version>.`
    );
  }
  return client;
}

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

  ctx.connectedAgentInputs.set(name, {
    allInputs,
    inputsWithDefaults,
    description: extractDescriptionValue(block.description),
  });
}

function mergeSystemMessagesIntoAdditionalParams(
  additionalParameters: AdditionalParameters | undefined,
  systemMessages: import('../types.js').SystemMessage[],
  hasTableauAnalyzeDataNode: boolean
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

  // TEMPORARY: The Tableau Analyze Data node routes through ICR and needs the
  // internal org JWT propagated to it. This flag is a stopgap until ICR JWT
  // propagation is handled by default; remove it once that lands.
  if (hasTableauAnalyzeDataNode) {
    result.enable_propagate_internal_org_jwt_to_icr = true;
  }

  return result;
}
