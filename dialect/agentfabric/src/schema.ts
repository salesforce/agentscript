/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  Block,
  NamedBlock,
  NamedCollectionBlock,
  CollectionBlock,
  TypedMap,
  SymbolKind,
  StringValue,
  NumberValue,
  BooleanValue,
  ExpressionValue,
  ProcedureValue,
  Sequence,
  ReferenceValue,
  createSchemaContext,
  VariablesBlock,
  InputPropertiesBlock,
  AGENTSCRIPT_PRIMITIVE_TYPES,
} from '@agentscript/language';

import type {
  FieldType,
  Schema,
  SchemaInfo,
  SchemaContext,
  NamedBlockFactory,
  CollectionBlockFactory,
  BlockFactory,
} from '@agentscript/language';

import {
  AGENTFABRIC_IDENTIFIER_PATTERN,
  ConnectionKind,
  Namespace,
  OUTPUT_JSON_SCHEMA_TYPES,
  TRANSITION_TARGET_NAMESPACES,
} from './constants.js';

/**
 * Lazy field type wrapper that defers resolution of a factory reference until
 * first access. Used to declare self-referential block schemas without hitting
 * the language factories' eager freeze + validate pass.
 */
function lazyField<F extends object>(resolve: () => F): F {
  let cache: F | undefined;
  const get = (): F => (cache ??= resolve());
  return new Proxy({} as F, {
    get(_target, prop) {
      return (get() as Record<string | symbol, unknown>)[
        prop as string | symbol
      ];
    },
    has(_target, prop) {
      return prop in (get() as object);
    },
  });
}

import {
  SystemBlock,
  ActionBlock as AgentScriptActionBlock,
  ReasoningBlock as AgentScriptReasoningBlock,
  SubagentBlock as AgentScriptSubagentBlock,
  ReasoningActionBlock,
  AgentScriptSchemaAliases,
  NodeMemberAccess,
} from '@agentscript/agentscript-dialect';

export { SystemBlock, VariablesBlock } from '@agentscript/agentscript-dialect';

// ── Config ──────────────────────────────────────────────────────────

export const AFConfigBlock = Block('AFConfigBlock', {
  agent_name: StringValue.describe('Unique agent identifier.').required(),
  label: StringValue.describe(
    'Human-readable display name for the agent.'
  ).displayLabelField(),
  description: StringValue.describe('Description of the agent.'),
  default_llm: ReferenceValue.describe(
    'Default LLM (@llm.<name>) used at compile time for orchestration, reasoning, and generate nodes that omit an explicit llm field. The linter reports an error if this is omitted while any such node also omits llm.'
  ).allowedNamespaces([Namespace.LLM]),
})
  .describe('Agent-level configuration.')
  .example(
    `config:
  agent_name: "employee-onboarding"
  label: "Employee Onboarding Agent"
  description: "An Agent that performs employee onboarding"
  default_llm: @llm.open-api-llm`
  );

// ── LLM ─────────────────────────────────────────────────────────────

const OPENAI_KIND = 'OpenAI';
const GEMINI_KIND = 'Gemini';

const llmBaseFields: Schema = {
  target: StringValue.describe(
    'Connection URI (llm://connection_name) referencing an LLM connection.'
  )
    .pattern(new RegExp(`^llm://(${AGENTFABRIC_IDENTIFIER_PATTERN})$`))
    .connectionRef([ConnectionKind.LLM])
    .example('llm://connection_name')
    .required(),
  kind: StringValue.describe('LLM provider discriminator.')
    .required()
    .enum([OPENAI_KIND, GEMINI_KIND]),
  model: StringValue.describe('The model name to use.').required(),
  temperature: NumberValue.describe('Controls randomness in output.')
    .min(0)
    .max(2),
  top_p: NumberValue.describe('Nucleus sampling parameter.').min(0).max(1),
  max_output_tokens: NumberValue.describe(
    'Maximum number of tokens to generate.'
  ),
  headers: ExpressionValue.describe(
    'Optional headers map for this LLM provider.'
  ),
  timeout: NumberValue.describe(
    'Optional timeout in seconds for requests to this LLM provider.'
  ),
  api_key: StringValue.describe('Optional API key for this LLM provider.'),
};

const openaiLlmVariantFields: Schema = {
  reasoning_effort: StringValue.describe(
    'Constrains effort on reasoning for OpenAI reasoning models.'
  ).enum(['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH']),
  top_logprobs: NumberValue.describe(
    'Number of most likely tokens to return at each position (OpenAI).'
  ),
};

const geminiLlmVariantFields: Schema = {
  thinking_level: StringValue.describe(
    'Level of thinking tokens for Gemini models.'
  ).enum(['LOW', 'HIGH']),
  thinking_budget: NumberValue.describe(
    'Thinking budget in tokens for Gemini models.'
  ),
  response_logprobs: StringValue.describe(
    'Whether to return log probabilities for Gemini.'
  ),
};

const LLMEntryBlockFactory = NamedBlock('LLMEntryBlock', llmBaseFields)
  .discriminant('kind')
  .variant(OPENAI_KIND, openaiLlmVariantFields)
  .variant(GEMINI_KIND, geminiLlmVariantFields);

export const LLMEntryBlock = LLMEntryBlockFactory.describe(
  'LLM configuration entry.'
);

export const LLMBlock = CollectionBlock(LLMEntryBlock).describe(
  'Named LLM configurations referenced by agentic nodes.'
);

// ── Actions ─────────────────────────────────────────────────────────

// Typed map of bindable input arguments: each entry is `param_name: <type>`
// where `<type>` is a primitive type. Mirrors the agentforce
// `ResponseFormatInputsBlock` precedent (a TypedMap of primitiveTypes only) so
// value-completion offers the primitive type keywords at the type position.
// Unlike the language `InputsBlock`, no variable modifiers (mutable/linked) —
// action inputs are plain typed parameters.
export const ActionDefInputsBlock = TypedMap(
  'ActionDefInputsBlock',
  InputPropertiesBlock,
  { primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES }
).describe('Bindable input arguments for the action.');

export const ActionDefBlock = AgentScriptActionBlock.pick([
  'description',
  'label',
  'target',
  'inputs',
])
  .extend(
    {
      target: StringValue.describe(
        'Connection URI using protocol-specific schemes: a2a://connection_name or mcp://connection_name.'
      )
        .pattern(
          new RegExp(`^(?:a2a|mcp)://(${AGENTFABRIC_IDENTIFIER_PATTERN})$`)
        )
        .connectionRef([ConnectionKind.Agent, ConnectionKind.MCP])
        .example('a2a://connection_name')
        .required(),
      kind: StringValue.describe(
        'Action type discriminator: "a2a:send_message" or "mcp:tool".'
      ).required(),
      inputs: ActionDefInputsBlock,
    },
    {
      symbol: { kind: SymbolKind.Method },
      scopeAlias: 'action',
      capabilities: ['invocationTarget'],
    }
  )
  .discriminant('kind')
  .variant('mcp:tool', {
    tool_name: StringValue.describe(
      'The MCP tool name to call. Required for mcp:tool kind.'
    ).required(),
  })
  .variant('a2a:send_message', {})
  .describe('Action definition (A2A or MCP).');

export const ActionsBlock = CollectionBlock(ActionDefBlock).describe(
  'Named action definitions available to nodes.'
);

// ── Trigger ─────────────────────────────────────────────────────────

export const TriggerBlock = NamedBlock('TriggerBlock', {
  kind: StringValue.describe(
    'Trigger protocol discriminator. Currently only "a2a" is supported.'
  )
    .enum(['a2a'])
    .required(),
  target: StringValue.describe(
    'Broker reference URI (brokers://broker_name/interface).'
  )
    .pattern(
      new RegExp(
        `^brokers?://(?:${AGENTFABRIC_IDENTIFIER_PATTERN})/(?:${AGENTFABRIC_IDENTIFIER_PATTERN})$`
      )
    )
    .connectionRef([ConnectionKind.Broker])
    .example('brokers://broker_name/interface')
    .required(),
  on_message: ProcedureValue.describe(
    'Procedure executed when a message is received. Must contain a transition to the initial node.'
  )
    .required()
    .transitionContainer(),
})
  .discriminant('kind')
  .variant('a2a', {})
  .describe('Trigger that initiates graph execution on incoming messages.');

export const TriggersBlock = CollectionBlock(TriggerBlock).describe(
  'Named trigger definitions. At most one trigger per broker interface segment (e.g. only one `a2a` trigger for `brokers://<name>/a2a`).'
);

// ── Output Structure ────────────────────────────────────────────────

function createOutputJsonSchemaFields(options?: {
  typeDescription?: string;
  descriptionDescription?: string;
  includeRequired?: boolean;
  includeDefault?: boolean;
}): Schema {
  const fields: Schema = {
    type: StringValue.describe(
      options?.typeDescription ??
        'Data type: string, number, integer, boolean, array, object.'
    )
      .required()
      .enum([...OUTPUT_JSON_SCHEMA_TYPES]),
    description: StringValue.describe(
      options?.descriptionDescription ?? 'Description of this property.'
    ),
    pattern: StringValue.describe('Regex pattern constraint (string).'),
    minLength: NumberValue.describe('Minimum length (string).'),
    maxLength: NumberValue.describe('Maximum length (string).'),
    minimum: NumberValue.describe('Minimum value (number/integer).'),
    maximum: NumberValue.describe('Maximum value (number/integer).'),
    exclusiveMinimum: NumberValue.describe(
      'Exclusive minimum value (number/integer).'
    ),
    exclusiveMaximum: NumberValue.describe(
      'Exclusive maximum value (number/integer).'
    ),
    minItems: NumberValue.describe('Minimum number of array items.'),
    maxItems: NumberValue.describe('Maximum number of array items.'),
    enum: ExpressionValue.describe('Allowed value list.'),
  };

  if (options?.includeRequired) {
    fields.required = ExpressionValue.describe(
      'Required property names when type is object.'
    );
  }
  if (options?.includeDefault) {
    fields.default = ExpressionValue.describe('Default value.');
  }

  return fields;
}

// Self-referential schema: a property's `items` (array) and `properties`
// entries (object) recursively accept the same shape. Forward declarations
// + lazy proxies break the cycle without depending on factory `extend`,
// which returns a new factory rather than mutating in place.
const lazyOutputProperty: NamedBlockFactory<Schema> = lazyField(
  () => OutputPropertyBlock as NamedBlockFactory<Schema>
);
const lazyOutputArrayItems: BlockFactory<Schema> = lazyField(
  () => OutputArrayItemsBlock as BlockFactory<Schema>
);
const lazyOutputPropertyCollection: CollectionBlockFactory<Schema> = lazyField(
  () => OutputPropertyCollection as CollectionBlockFactory<Schema>
);

export const OutputPropertyBlock: NamedBlockFactory<Schema> = NamedBlock(
  'OutputPropertyBlock',
  {
    ...createOutputJsonSchemaFields({
      includeRequired: true,
      includeDefault: true,
    }),
    items: lazyOutputArrayItems,
    properties: lazyOutputPropertyCollection,
  }
).describe('Output structure property definition.');

const OutputArrayItemsBlock: BlockFactory<Schema> = Block(
  'OutputArrayItemsBlock',
  {
    ...createOutputJsonSchemaFields({
      typeDescription:
        'Data type for array items: string, number, integer, boolean, array, object.',
      descriptionDescription: 'Description of this item schema.',
      includeRequired: true,
      includeDefault: true,
    }),
    items: lazyOutputArrayItems,
    properties: lazyOutputPropertyCollection,
  }
).describe('Schema for each array item.');

const OutputPropertyCollection: CollectionBlockFactory<Schema> =
  CollectionBlock(lazyOutputProperty).describe('Nested object properties map.');

export const OutputStructureBlock = Block('OutputStructureBlock', {
  properties: CollectionBlock(OutputPropertyBlock).describe(
    'Map of property names to their schema definitions.'
  ),
}).describe('Schema defining the expected structure of agent output.');

// ── Agent Node Actions ──────────────────────────────────────────────

const DialectReasoningActionBlock = ReasoningActionBlock.extend(
  {},
  { colinear: ExpressionValue.resolvedType('invocationTarget') }
).describe('Action reference within a node, referencing an action definition.');

export const NodeActionsBlock = CollectionBlock(
  DialectReasoningActionBlock
).describe('Named action bindings within a node.');

export const NodeSystemSectionBlock = SystemBlock.pick([
  'instructions',
]).describe('Node system section.');

export const NodeReasoningSectionBlock = AgentScriptReasoningBlock.pick([
  'instructions',
])
  .extend({
    actions: NodeActionsBlock.describe('Available actions for this node.'),
    outputs: OutputStructureBlock.describe(
      'Schema for structured output.'
    ).structuredOutputField(),
    max_number_of_loops: NumberValue.describe(
      'Maximum reasoning loop iterations.'
    ).min(1),
    max_consecutive_errors: NumberValue.describe(
      'Maximum consecutive errors before stopping.'
    ).min(1),
    task_timeout_secs: NumberValue.describe(
      'Timeout in seconds for total node execution.'
    ),
  })
  .describe('Node reasoning section.');

// ── Subagent / Orchestrator ─────────────────────────────────────────

export const SubagentBlock = AgentScriptSubagentBlock.omit(
  'actions',
  'before_reasoning',
  'after_reasoning'
)
  .extend(
    {
      llm: ReferenceValue.describe(
        'Override the default LLM setting.'
      ).allowedNamespaces([Namespace.LLM]),
      reasoning: NodeReasoningSectionBlock.describe(
        'Node-level reasoning configuration.'
      ).required(),
      on_exit: ProcedureValue.describe(
        'Procedure executed when node completes. Must contain a transition to statement.'
      )
        .required()
        .transitionContainer(),
    },
    {
      capabilities: ['transitionTarget'],
      symbol: { kind: SymbolKind.Namespace },
    }
  )
  .describe('Subagent node with generic agent loop and tools.');

export const OrchestratorBlock = SubagentBlock.clone().describe(
  'Orchestrator node specializing subagent semantics for multi-agent orchestration.'
);

// ── Generate ────────────────────────────────────────────────────────

export const GeneratorBlock = NamedBlock(
  'GeneratorBlock',
  {
    description: StringValue.describe('Description of what this node does.'),
    label: StringValue.describe(
      'Human-readable display name.'
    ).displayLabelField(),
    llm: ReferenceValue.describe(
      'Override the default LLM setting.'
    ).allowedNamespaces([Namespace.LLM]),
    system: NodeSystemSectionBlock.describe(
      'Optional node-level system.instructions override for this generator call.'
    ),
    prompt: ProcedureValue.describe(
      'Required session-specific prompt/instructions for this generator node.'
    ).required(),
    outputs: OutputStructureBlock.describe(
      'Optional structured output schema for generator results.'
    ).structuredOutputField(),
    on_exit: ProcedureValue.describe(
      'Procedure executed when node completes. Must contain a transition to statement.'
    )
      .required()
      .transitionContainer(),
  },
  {
    capabilities: ['transitionTarget'],
    symbol: { kind: SymbolKind.Namespace },
  }
).describe('Generator node for single LLM call with no tools or agent loop.');

// ── Execute ─────────────────────────────────────────────────────────

export const ExecutorBlock = NamedBlock(
  'ExecutorBlock',
  {
    description: StringValue.describe('Description of what this node does.'),
    label: StringValue.describe(
      'Human-readable display name.'
    ).displayLabelField(),
    do: ProcedureValue.describe(
      'Deterministic steps: `set @variables.<name> = <expr>` and/or `run @actions.<action_name>` with `with` inputs and optional `set` lines that read `@outputs.<field>` from the action result. For prior graph node results use `@<node_type>.<node_name>.output` (for example `@generate.summary.output`). Use @request.* for trigger payload and @variables.* for declared variables.'
    ).required(),
    on_exit: ProcedureValue.describe(
      'Procedure executed when node completes. Optional for terminal execute nodes; when present, should contain a transition to statement.'
    ).transitionContainer(),
  },
  {
    capabilities: ['transitionTarget'],
    symbol: { kind: SymbolKind.Namespace },
  }
).describe(
  'Executor node for deterministic tool invocations and variable setting.'
);

// ── Switch ──────────────────────────────────────────────────────────

export const RouterRouteBlock = Block('RouterRouteBlock', {
  target: ReferenceValue.describe(
    'Transition target reference, e.g. @orchestrator.someNode.'
  )
    .allowedNamespaces(TRANSITION_TARGET_NAMESPACES)
    .resolvedType('transitionTarget')
    .required(),
  when: ExpressionValue.describe(
    'Condition expression that enables this route.'
  )
    .required()
    .predicateField(),
  label: StringValue.describe(
    'Optional UI label for this route.'
  ).outputNameField(),
});

export const RouterOtherwiseBlock = Block('RouterOtherwiseBlock', {
  target: ReferenceValue.describe(
    'Default transition target when no route condition matches.'
  )
    .allowedNamespaces(TRANSITION_TARGET_NAMESPACES)
    .resolvedType('transitionTarget')
    .required(),
});

export const RouterBlock = NamedBlock(
  'RouterBlock',
  {
    description: StringValue.describe('Description of what this node does.'),
    label: StringValue.describe(
      'Human-readable display name.'
    ).displayLabelField(),
    routes: Sequence(RouterRouteBlock)
      .describe(
        'Ordered conditional routes. Each route has target + when, and optional label for UI.'
      )
      .minItems(1)
      .required(),
    otherwise: RouterOtherwiseBlock.describe(
      'Required fallback transition when no route condition matches.'
    ),
  },
  {
    capabilities: ['transitionTarget'],
    symbol: { kind: SymbolKind.Namespace },
  }
).describe(
  'Router node for deterministic routing based on conditions. Exits are defined by routes[].target and otherwise.target, not by a block-level on_exit.'
);

// ── Echo ────────────────────────────────────────────────────────────

/**
 * A2A v1 TaskState enum values (SCREAMING_SNAKE_CASE with TASK_STATE_ prefix).
 * Shared across schema, compiler, and linter.
 */
export const A2A_TASK_STATES = [
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_AUTH_REQUIRED',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
] as const;

/** Terminal A2A v1 task states — task lifecycle ends here. */
export const A2A_TERMINAL_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

export const EchoBlock = NamedBlock(
  'EchoBlock',
  {
    description: StringValue.describe('Description of what this node does.'),
    label: StringValue.describe(
      'Human-readable display name.'
    ).displayLabelField(),
    kind: StringValue.describe(
      'Event type discriminator: "a2a:status_update_event" or "a2a:artifact_update_event".'
    ).required(),
    metadata: ExpressionValue.describe(
      'Optional metadata expression for the event.'
    ),
    on_exit: ProcedureValue.describe(
      'Procedure executed when node completes.'
    ).transitionContainer(),
  },
  {
    capabilities: ['transitionTarget'],
    symbol: { kind: SymbolKind.Namespace },
  }
)
  .discriminant('kind')
  .variant('a2a:status_update_event', {
    state: StringValue.describe('A2A v1 task state.')
      .enum([...A2A_TASK_STATES])
      .required(),
    message: ExpressionValue.describe(
      'A2A message expression for the status update.'
    ),
  })
  .variant('a2a:artifact_update_event', {
    // TODO: ExpressionValue has no type constraint mechanism — we cannot
    // enforce that this expression evaluates to an A2A Artifact object.
    // Requires expression-level type inference in the language infrastructure.
    artifact: ExpressionValue.describe(
      'A2A artifact expression via a2a.artifact().'
    ).required(),
    append: BooleanValue.describe(
      'Whether to append to an existing artifact (default: False).'
    ),
    lastChunk: BooleanValue.describe(
      'Whether this is the last chunk (default: False).'
    ),
  })
  .describe('Echo node that emits an A2A event to update the stored task.');

// ── Schema ──────────────────────────────────────────────────────────

export const AgentFabricSchema = {
  system: SystemBlock,
  config: AFConfigBlock,
  variables: VariablesBlock,
  llm: LLMBlock,
  actions: ActionsBlock,
  trigger: NamedCollectionBlock(TriggerBlock).required(),
  orchestrator: NamedCollectionBlock(OrchestratorBlock),
  subagent: NamedCollectionBlock(SubagentBlock),
  generator: NamedCollectionBlock(GeneratorBlock),
  executor: NamedCollectionBlock(ExecutorBlock),
  router: NamedCollectionBlock(RouterBlock),
  echo: NamedCollectionBlock(EchoBlock),
} satisfies Record<string, FieldType>;

export type AgentFabricSchema = typeof AgentFabricSchema;

export const AgentFabricSchemaAliases: Record<string, string> = {
  ...AgentScriptSchemaAliases,
};

export const AgentFabricSchemaInfo: SchemaInfo = {
  schema: AgentFabricSchema as Record<string, FieldType>,
  aliases: AgentFabricSchemaAliases,
  nodeMemberAccess: NodeMemberAccess,
  globalScopes: {
    request: new Set(['payload', 'interface', 'headers']),
  },
  namespacedFunctions: {
    a2a: new Set([
      'message',
      'textPart',
      'parts',
      'dataPart',
      'filePart',
      'artifact',
    ]),
  },
};

export const agentFabricSchemaContext: SchemaContext = createSchemaContext(
  AgentFabricSchemaInfo
);
