import {
  Block,
  NamedBlock,
  NamedCollectionBlock,
  CollectionBlock,
  SymbolKind,
  StringValue,
  NumberValue,
  ExpressionValue,
  ProcedureValue,
  Sequence,
  ReferenceValue,
  createSchemaContext,
  VariablesBlock,
} from '@agentscript/language';

import type {
  FieldType,
  Schema,
  SchemaInfo,
  SchemaContext,
} from '@agentscript/language';

import {
  SystemBlock,
  ActionBlock as AgentScriptActionBlock,
  ReasoningBlock as AgentScriptReasoningBlock,
  SubagentBlock as AgentScriptSubagentBlock,
  ReasoningActionBlock,
  AgentScriptSchemaAliases,
} from '@agentscript/agentscript-dialect';

export { SystemBlock, VariablesBlock } from '@agentscript/agentscript-dialect';

// ── Config ──────────────────────────────────────────────────────────

export const AFConfigBlock = Block('AFConfigBlock', {
  agent_name: StringValue.describe('Unique agent identifier.').required(),
  label: StringValue.describe('Human-readable display name for the agent.'),
  description: StringValue.describe('Description of the agent.'),
  default_llm: ReferenceValue.describe(
    'Default LLM (@llm.<name>) used at compile time for orchestration, reasoning, and generate nodes that omit an explicit llm field. The linter reports an error if this is omitted while any such node also omits llm.'
  ).allowedNamespaces(['llm']),
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
    .pattern(/^llm:\/\/([a-zA-Z0-9\-._]+)$/)
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
  ).enum(['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
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

// Intentionally empty marker block: loose bindable parameter keys (typed InputsBlock deferred).
export const ActionDefInputBlock = NamedBlock(
  'ActionDefInputBlock',
  {}
).describe('Action definition input parameter.');

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
        .pattern(/^(?:a2a|mcp):\/\/([a-zA-Z0-9\-._]+)$/)
        .example('a2a://connection_name')
        .required(),
      kind: StringValue.describe(
        'Action type discriminator: "a2a:send_message" or "mcp:tool".'
      ).required(),
      http_headers: ExpressionValue.describe(
        'Optional per-action HTTP headers map applied to outgoing action calls.'
      ),
      inputs: CollectionBlock(ActionDefInputBlock).describe(
        'Bindable input arguments for the action.'
      ),
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
    .pattern(/^brokers?:\/\/(?:[a-zA-Z0-9\-._]+)\/(?:[a-zA-Z0-9\-._]+)$/)
    .example('brokers://broker_name/interface')
    .required(),
  on_message: ProcedureValue.describe(
    'Procedure executed when a message is received. Must contain a transition to the initial node.'
  ).required(),
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
    ).required(),
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

export const OutputPropertyBlock = NamedBlock('OutputPropertyBlock', {
  ...createOutputJsonSchemaFields({ includeRequired: true }),
  items: Block('OutputArrayItemsBlock', {
    ...createOutputJsonSchemaFields({
      typeDescription:
        'Data type for array items: string, number, integer, boolean, array, object.',
      descriptionDescription: 'Description of this item schema.',
      includeRequired: true,
    }),
    properties: CollectionBlock(
      NamedBlock(
        'OutputNestedPropertyBlock',
        createOutputJsonSchemaFields({ includeDefault: true })
      )
    ).describe('Nested object properties map.'),
    default: ExpressionValue.describe('Default value.'),
  }).describe('Schema for each array item.'),
  properties: CollectionBlock(
    NamedBlock(
      'OutputObjectPropertyBlock',
      createOutputJsonSchemaFields({ includeDefault: true })
    )
  ).describe('Nested object properties map.'),
  default: ExpressionValue.describe('Default value.'),
}).describe('Output structure property definition.');

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
    outputs: OutputStructureBlock.describe('Schema for structured output.'),
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
      ).allowedNamespaces(['llm']),
      reasoning: NodeReasoningSectionBlock.describe(
        'Node-level reasoning configuration.'
      ).required(),
      on_exit: ProcedureValue.describe(
        'Procedure executed when node completes. Must contain a transition to statement.'
      ).required(),
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
    label: StringValue.describe('Human-readable display name.'),
    llm: ReferenceValue.describe(
      'Override the default LLM setting.'
    ).allowedNamespaces(['llm']),
    system: NodeSystemSectionBlock.describe(
      'Optional node-level system.instructions override for this generator call.'
    ),
    prompt: ProcedureValue.describe(
      'Required session-specific prompt/instructions for this generator node.'
    ).required(),
    outputs: OutputStructureBlock.describe(
      'Optional structured output schema for generator results.'
    ),
    on_exit: ProcedureValue.describe(
      'Procedure executed when node completes. Must contain a transition to statement.'
    ).required(),
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
    label: StringValue.describe('Human-readable display name.'),
    do: ProcedureValue.describe(
      'Deterministic steps: `set @variables.<name> = <expr>` and/or `run @actions.<action_name>` with `with` inputs and optional `set` lines that read `@outputs.<field>` from the action result. For prior graph node results use `@<node_type>.<node_name>.output` (for example `@generate.summary.output`). Use @request.* for trigger payload and @variables.* for declared variables.'
    ).required(),
    on_exit: ProcedureValue.describe(
      'Procedure executed when node completes. Optional for terminal execute nodes; when present, should contain a transition to statement.'
    ),
  },
  {
    capabilities: ['transitionTarget'],
    symbol: { kind: SymbolKind.Namespace },
  }
).describe(
  'Executor node for deterministic tool invocations and variable setting.'
);

// ── Switch ──────────────────────────────────────────────────────────

const ROUTER_TARGET_NAMESPACES = [
  'orchestrator',
  'subagent',
  'generator',
  'executor',
  'router',
  'echo',
];

export const RouterRouteBlock = Block('RouterRouteBlock', {
  target: ReferenceValue.describe(
    'Transition target reference, e.g. @orchestrator.someNode.'
  )
    .allowedNamespaces(ROUTER_TARGET_NAMESPACES)
    .required(),
  when: ExpressionValue.describe(
    'Condition expression that enables this route.'
  ).required(),
  label: StringValue.describe('Optional UI label for this route.'),
});

export const RouterOtherwiseBlock = Block('RouterOtherwiseBlock', {
  target: ReferenceValue.describe(
    'Default transition target when no route condition matches.'
  )
    .allowedNamespaces(ROUTER_TARGET_NAMESPACES)
    .required(),
});

export const RouterBlock = NamedBlock(
  'RouterBlock',
  {
    description: StringValue.describe('Description of what this node does.'),
    label: StringValue.describe('Human-readable display name.'),
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

export const EchoBlock = NamedBlock(
  'EchoBlock',
  {
    description: StringValue.describe('Description of what this node does.'),
    label: StringValue.describe('Human-readable display name.'),
    kind: StringValue.describe(
      'Response type discriminator. Currently only "a2a:response".'
    ).required(),
    message: ExpressionValue.describe('Message expression for the response.'),
    task: ExpressionValue.describe(
      'Task expression for the A2A response (alternative to message).'
    ),
    artifacts: ExpressionValue.describe(
      'Artifacts expression for the response.'
    ),
    metadata: ExpressionValue.describe('Metadata expression for the response.'),
    on_exit: ProcedureValue.describe('Procedure executed when node completes.'),
  },
  {
    capabilities: ['transitionTarget'],
    symbol: { kind: SymbolKind.Namespace },
  }
)
  .discriminant('kind')
  .variant('a2a:response', {})
  .describe('Echo node that sends a response back to the client.');

// ── Schema ──────────────────────────────────────────────────────────

export const AgentFabricSchema = {
  system: SystemBlock,
  config: AFConfigBlock,
  variables: VariablesBlock,
  llm: LLMBlock,
  actions: ActionsBlock,
  trigger: NamedCollectionBlock(TriggerBlock),
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
  globalScopes: {
    request: new Set(['payload', 'interface', 'headers']),
  },
  namespacedFunctions: {
    a2a: new Set([
      'task',
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
