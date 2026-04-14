import {
  Block,
  NamedBlock,
  CollectionBlock,
  NamedCollectionBlock,
  SymbolKind,
  StringValue,
  NumberValue,
  BooleanValue,
  ReferenceValue,
  Sequence,
  ExpressionSequence,
  createSchemaContext,
  ExpressionValue,
  ProcedureValue,
  buildKindToSchemaKey,
} from '@agentscript/language';

import type {
  FieldType,
  SchemaInfo,
  SchemaContext,
  Parsed,
  InferFields,
  AstRoot,
} from '@agentscript/language';

import {
  ActionBlock,
  ReasoningBlock,
  VariablesBlock,
  InputsBlock,
  OutputsBlock,
  ConfigBlock,
  ConnectedSubagentBlock,
  StartAgentBlock,
  AgentScriptSchema,
  AgentScriptSchemaAliases,
  AgentScriptSchemaInfo,
  defaultSubagentFields,
} from '@agentscript/agentscript-dialect';

const AFVariablesBlock = VariablesBlock.extendProperties({
  source: ReferenceValue.describe(
    'Where the variable gets its value. Required for linked variables, not allowed for mutable variables (e.g., @MessagingSession.Id).'
  ).allowedNamespaces(['MessagingSession', 'MessagingEndUser']),
  visibility: StringValue.describe('Visibility level for the variable.').enum([
    'Internal',
    'External',
    'internal',
    'external',
  ]),
  is_displayable: BooleanValue.describe(
    'Whether this variable is visible in the UI.'
  ),
  is_used_by_planner: BooleanValue.describe(
    'Whether the planner can read this variable.'
  ),
}).withKeyPattern('^(?!.*__)[a-zA-Z][a-zA-Z0-9_]*$');

const AFInputsBlock = InputsBlock.extendProperties({
  complex_data_type_name: StringValue.describe(
    'Complex data type name (e.g., "@apexClassType/c__RequestMetadata"). For object type, defaults to "lightning__objectType".'
  ),
  schema: StringValue.describe(
    'Schema URI for input validation (e.g., "schema://city_schema").'
  ),
  is_user_input: BooleanValue.describe(
    'Whether this input comes from the user.'
  ),
  filter_from_agent: BooleanValue.describe(
    'Whether to filter this input from the agent context.'
  ),
  is_displayable: BooleanValue.describe(
    'Whether this input can be shown to users.'
  ),
  is_used_by_planner: BooleanValue.describe(
    'Whether the planner can use this input.'
  ),
});

const AFOutputsBlock = OutputsBlock.extendProperties({
  developer_name: StringValue.describe(
    'Developer name identifier for the output field.'
  ),
  is_displayable: BooleanValue.describe(
    'Whether this output can be shown to users.'
  ),
  is_used_by_planner: BooleanValue.describe(
    'Whether the planner can read this output.'
  ),
  complex_data_type_name: StringValue.describe(
    'Complex data type name. For object type, defaults to "lightning__objectType".'
  ),
  filter_from_agent: BooleanValue.describe(
    'Whether to filter this output from the agent context.'
  ),
});

const ModelConfigParamsBlock = Block('ModelConfigParamsBlock', {}).describe(
  'Model parameters as key-value pairs. Accepts arbitrary parameters that vary by model (e.g., temperature, max_tokens, top_p). Values can be strings, numbers, booleans, or arrays. Parameters are dynamically extracted at compile time.'
);

const ModelConfigBlock = Block('ModelConfigBlock', {
  model: StringValue.describe('Model identifier URI (e.g., "model://...")'),
  params: ModelConfigParamsBlock.describe(
    'Additional model parameters (e.g., temperature: 0.7, max_tokens: 2000)'
  ),
}).describe('Model selection and parameter configuration.');

const ContextMemoryBlock = Block('ContextMemoryBlock', {
  enabled: BooleanValue.describe('Whether memory is enabled for the agent.'),
}).describe('Memory configuration for the agent.');

export const ContextBlock = Block('ContextBlock', {
  memory: ContextMemoryBlock.describe('Memory configuration.'),
}).describe('Context configuration for the agent.');

const AFConfigBlock = ConfigBlock.extend(
  {
    developer_name: StringValue.describe(
      'Agent identifier. Must follow standard name field requirements. Set this or agent_name (not both).'
    ),
    agent_label: StringValue.describe(
      'Display label for the agent. Defaults to normalized developer_name.'
    ).accepts(['StringLiteral']),
    agent_description: StringValue.describe(
      'Agent description used in prompts and routing. Distinct from description (internal documentation).'
    ),
    agent_type: StringValue.describe(
      'Agent type (e.g., "AgentforceServiceAgent", "AgentforceEmployeeAgent", "SalesEinsteinCoach").'
    ).enum([
      'AgentforceServiceAgent',
      'AgentforceEmployeeAgent',
      'SalesEinsteinCoach',
    ]),
    agent_id: StringValue.describe('Unique identifier for the agent.'),
    agent_name: StringValue.describe('Internal name for the agent.'),
    default_agent_user: StringValue.describe(
      'Default user identity. Required for AgentforceServiceAgent type.'
    ),
    agent_version: StringValue.describe(
      'Version identifier for the agent (e.g., "v1").'
    ),
    enable_enhanced_event_logs: BooleanValue.describe(
      'Whether to record enhanced event logs for debugging and analytics.'
    ),
    company: StringValue.describe(
      'Company information. Can be embedded in subagent prompts for context.'
    ),
    role: StringValue.describe('Job description or role for the agent.'),
    planner_type: StringValue.describe(
      'Planner type (e.g., "AiCopilot__ReAct", "Atlas__ConcurrentMultiAgentOrchestration").'
    ),
    additional_parameter__reset_to_initial_node: BooleanValue.describe(
      'Whether to reset to the initial node between turns.'
    ).hidden(),
    additional_parameter__DISABLE_GROUNDEDNESS: BooleanValue.describe(
      'Whether to disable groundedness checking.'
    ).hidden(),
    debug: BooleanValue.describe('Whether to enable debug mode.'),
    max_tokens: NumberValue.describe('Maximum number of tokens for responses.'),
    temperature: NumberValue.describe(
      'Sampling temperature for model responses.'
    ),
    agent_template: StringValue.describe(
      'Template name identifier for the agent.'
    ),
    outbound_flow: StringValue.describe(
      'API name of the default outbound flow for escalation routing.'
    ),
    user_locale: StringValue.describe(
      'User locale override (e.g., "en_US").'
    ).deprecated('Use the language block instead.'),
  },
  {
    wildcardPrefixes: [
      { prefix: 'additional_parameter__', fieldType: ExpressionValue },
    ],
  }
).example(
  `config:
    developer_name: "customer_support_agent"
    agent_label: "Customer Support Agent"
    description: "Assists customers with orders, returns, and account management"
    default_agent_user: "support@example.com"
    agent_type: "AgentforceServiceAgent"
    enable_enhanced_event_logs: True
    additional_parameter__reset_to_initial_node: True`
);

const AFActionBlock = ActionBlock.extend({
  source: StringValue.describe(
    'Source URI for the action (e.g., "custom://weather_api").'
  ),
  require_user_confirmation: BooleanValue.describe(
    'Whether to require user confirmation before executing.'
  ),
  include_in_progress_indicator: BooleanValue.describe(
    'Whether to show a progress indicator during execution.'
  ),
  progress_indicator_message: StringValue.describe(
    'Message shown during execution. Only used if include_in_progress_indicator is True.'
  ),
  inputs: AFInputsBlock,
  outputs: AFOutputsBlock,
}).example(
  `    actions:
        Lookup_Order:
            description: "Retrieve order details by order number"
            label: "Lookup Order"
            require_user_confirmation: False
            include_in_progress_indicator: True
            progress_indicator_message: "Looking up your order..."
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
                    is_user_input: True
                email: string
                    description: "Customer email for verification"
                    is_required: False
                    is_user_input: False
            outputs:
                status: string
                    description: "Order status"
                    is_displayable: True
                order_id: string
                    description: "Internal order record ID"
                    is_displayable: False
                    filter_from_agent: True
                items: list[object]
                    description: "Items in the order"
                    is_displayable: True
            target: "flow://Lookup_Order_By_Number"

        # Target URI formats:
        #   flow://Flow_API_Name                        — Salesforce Flow
        #   apex://Apex_Class_Name                      — Apex invocable action
        #   externalService://endpoint_name             — External service
        #   standardInvocableAction://Action_Name       — Standard Salesforce invocable action`
);

export const AFActionsBlock = CollectionBlock(AFActionBlock);

export const SecurityBlock = Block('SecurityBlock', {
  sharing_policy: Block('SharingPolicyBlock', {
    use_default_sharing_entities: BooleanValue.describe(
      'Sharing policy for the agent.'
    ),
    custom_sharing_entities: ExpressionSequence().describe(
      'Custom sharing entities for the agent.'
    ),
  }).describe('Sharing policy for the agent.'),
  verified_customer_record_access: Block('VerifiedCustomerRecordAccessBlock', {
    use_default_objects: BooleanValue.describe(
      'Whether to use default objects for record access filtering.'
    ),
    additional_objects: ExpressionSequence().describe(
      'Additional objects for record access filtering.'
    ),
  }).describe('Verified customer record access configuration.'),
}).describe('Agent security configuration');

// ---------------------------------------------------------------------------
// Shared fields between Topic, Subagent, and StartAgent blocks
// Extends base agentscript fields with Agentforce-specific fields
// ---------------------------------------------------------------------------

const sharedBlockFields = {
  ...defaultSubagentFields,
  // Agentforce-specific fields
  model_config: ModelConfigBlock.describe(
    'Model configuration for this block.'
  ),
  security: SecurityBlock,
};

const sharedBlockOpts = {
  allowAnonymous: true,
  capabilities: ['invocationTarget', 'transitionTarget'] as const,
};

// ---------------------------------------------------------------------------
// Topic block — uses 'actions' and 'reasoning.actions'
// ---------------------------------------------------------------------------

/** Topic block — distinct __kind 'TopicBlock', uses actions + reasoning.actions. */
export const AFTopicBlock = NamedBlock(
  'TopicBlock',
  {
    ...sharedBlockFields,
    actions: AFActionsBlock,
  },
  { scopeAlias: 'topic', ...sharedBlockOpts }
)
  .describe('A topic defining agent logic with actions and reasoning.')
  .discriminant('schema');

// ---------------------------------------------------------------------------
// Subagent block — uses 'actions' and 'reasoning.actions' (same as topic)
// ---------------------------------------------------------------------------

/** Subagent block — distinct __kind 'SubagentBlock', uses actions + reasoning.actions. */
export const AFSubagentBlock = NamedBlock(
  'SubagentBlock',
  {
    ...sharedBlockFields,
    actions: AFActionsBlock,
  },
  { scopeAlias: 'subagent', ...sharedBlockOpts }
)
  .describe('A subagent defining agent logic with actions and reasoning.')
  .discriminant('schema');

// ---------------------------------------------------------------------------
// StartAgent block
// ---------------------------------------------------------------------------

/** StartAgent block — uses actions + reasoning.actions. */
export const AFStartAgentBlock = StartAgentBlock.extend(
  {
    actions: AFActionsBlock,
    reasoning: ReasoningBlock,
    model_config: ModelConfigBlock.describe(
      'Configuration for the model used by this block.'
    ),
    security: SecurityBlock,
  },
  { scopeAlias: 'topic' }
).discriminant('schema');

export const KnowledgeBlock = Block('KnowledgeBlock', {
  citations_url: StringValue.describe('URL prefix for citation links.'),
  rag_feature_config_id: StringValue.describe(
    'RAG feature configuration identifier. Typically a UUID-based identifier.'
  ),
  citations_enabled: BooleanValue.describe(
    'Whether to include citations in responses.'
  ),
})
  .describe(
    'Knowledge and citation configuration for RAG-based question answering.'
  )
  .example(
    `knowledge:
    citations_url: "https://help.example.com"
    rag_feature_config_id: "my_knowledge_base"
    citations_enabled: True`
  );

const ResponseActionsEntryBlock = NamedBlock(
  'ResponseActionsBlock',
  {
    description: StringValue.describe(
      'Description of the tool provided to the LLM. Overrides the action description.'
    ),
    label: StringValue.describe(
      'Human-readable label for the tool. Not provided to the LLM.'
    ),
  },
  {
    colinear: ExpressionValue,
    body: ProcedureValue,
    symbol: { kind: SymbolKind.Method },
    scopeAlias: 'action',
  }
).describe('Reasoning loop for connections.');

export const ConnectionBlock = NamedBlock(
  'ConnectionBlock',
  {
    adaptive_response_allowed: BooleanValue.describe(
      'Whether adaptive responses are allowed for this connection.'
    ),
    escalation_message: StringValue.describe('Message to show for Escalation.'),
    instructions: StringValue.describe('Instructions for the connection.'),
    outbound_route_type: StringValue.describe(
      'Type of outbound route. Currently gets defaulted to OmniChannelFlow'
    ),
    outbound_route_name: StringValue.describe(
      'Name of outbound route. Example: "flow://Route_to_ELL_Agent"'
    ),
    response_actions: CollectionBlock(ResponseActionsEntryBlock),
  },
  { symbol: { kind: SymbolKind.Interface } }
)
  .describe('External connection configuration.')
  .example(
    `connection messaging:
    adaptive_response_allowed: True`
  );

export const ConnectionsBlock = NamedCollectionBlock(ConnectionBlock);

export const PronunciationDictEntryBlock = Block(
  'PronunciationDictEntryBlock',
  {
    grapheme: StringValue.required(),
    phoneme: StringValue.required(),
    type: StringValue.enum(['IPA', 'CMU']),
  }
);

export const InboundKeywordsBlock = Block('InboundKeywordsBlock', {
  keywords: ExpressionSequence().describe(
    'List of keywords for inbound speech detection.'
  ),
}).describe('Keyword detection configuration for inbound speech.');

export const SpeakUpConfigBlock = Block('SpeakUpConfigBlock', {
  speak_up_first_wait_time_ms: NumberValue.describe(
    'Time in milliseconds before first speak-up prompt.'
  )
    .min(10000)
    .max(300000),
  speak_up_follow_up_wait_time_ms: NumberValue.describe(
    'Time in milliseconds before follow-up speak-up prompts.'
  )
    .min(10000)
    .max(300000),
  speak_up_message: StringValue.describe(
    'Message to speak when prompting the user to speak up.'
  ),
}).describe('Configuration for speak-up behavior.');

export const EndpointingConfigBlock = Block('EndpointingConfigBlock', {
  max_wait_time_ms: NumberValue.describe(
    'Maximum wait time in milliseconds for endpointing detection.'
  )
    .min(500)
    .max(60000),
}).describe('Configuration for endpointing detection.');

export const BeepBoopConfigBlock = Block('BeepBoopConfigBlock', {
  max_wait_time_ms: NumberValue.describe(
    'Maximum wait time in milliseconds for beep-boop detection.'
  )
    .min(500)
    .max(60000),
}).describe('Configuration for beep-boop detection.');

export const AdditionalConfigsBlock = Block('AdditionalConfigsBlock', {
  speak_up_config: SpeakUpConfigBlock.describe(
    'Configuration for speak-up prompts.'
  ),
  endpointing_config: EndpointingConfigBlock.describe(
    'Configuration for endpointing detection.'
  ),
  beepboop_config: BeepBoopConfigBlock.describe(
    'Configuration for beep-boop detection.'
  ),
}).describe('Additional voice-related configurations.');

export const FillerSentenceBlock = Block('FillerSentenceBlock', {
  waiting: ExpressionSequence().describe(
    'List of waiting messages for this filler sentence entry.'
  ),
}).describe('A filler sentence configuration entry.');

export const VoiceModalitySchema = {
  inbound_filler_words_detection: BooleanValue.describe(
    'Whether to enable detection of filler words in inbound speech.'
  ),
  inbound_keywords: InboundKeywordsBlock.describe(
    'Keyword detection configuration for inbound speech with boost values.'
  ),
  voice_id: StringValue.describe(
    'Unique identifier for the voice (e.g., "EQx6HGDYjkDpcli6vorJ").'
  ),
  outbound_speed: NumberValue.describe(
    'Speech speed for outbound voice (e.g., 1.0 for normal speed).'
  )
    .min(0.5)
    .max(2),
  outbound_style_exaggeration: NumberValue.describe(
    'Style exaggeration level for outbound voice (0.0 to 1.0).'
  )
    .min(0)
    .max(1),
  outbound_stability: NumberValue.describe(
    'Voice stability for outbound speech.'
  ),
  outbound_similarity: NumberValue.describe(
    'Voice similarity level for outbound speech.'
  ),
  pronunciation_dict: Sequence(PronunciationDictEntryBlock).describe(
    'List of pronunciation dictionary entries for custom word pronunciations.'
  ),
  outbound_filler_sentences: Sequence(FillerSentenceBlock).describe(
    'List of filler sentence entries to use during outbound speech pauses.'
  ),
  additional_configs: AdditionalConfigsBlock.describe(
    'Additional voice-related configurations.'
  ),
} as const;

export const ModalityBlock = NamedBlock('ModalityBlock').variant(
  'voice',
  VoiceModalitySchema
);

const ModalitiesBlock = NamedCollectionBlock(ModalityBlock);

export const AgentforceSchema = {
  ...AgentScriptSchema,
  config: AFConfigBlock,
  variables: AFVariablesBlock,
  model_config: ModelConfigBlock.describe(
    'Default model configuration for the agent. Can be overridden at topic level.'
  ).example(
    `model_config:
    model: "model://sfdc_ai__DefaultGPT4"
    params:
        temperature: 0.7
        max_tokens: 2000`
  ),
  knowledge: KnowledgeBlock,
  connection: ConnectionsBlock,
  connected_subagent: NamedCollectionBlock(ConnectedSubagentBlock),
  modality: ModalitiesBlock,
  security: SecurityBlock,
  context: ContextBlock,
  subagent: NamedCollectionBlock(
    AFSubagentBlock.clone().example(
      `subagent Order_Management:
    description: "Handles order lookups, updates, and summaries"

    system:
        instructions: "Focus on helping the user with their order. Never expose internal record IDs."

    before_reasoning:
        if @variables.verified is not True:
            transition to @subagent.Identity

    actions:
        Lookup_Order:
            description: "Retrieve order details"
            require_user_confirmation: False
            include_in_progress_indicator: True
            progress_indicator_message: "Looking up your order..."
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
                    is_user_input: True
            outputs:
                status: string
                    description: "Order status"
                    is_displayable: True
                order_id: string
                    description: "Internal order record ID"
                    is_displayable: False
                    filter_from_agent: True
            target: "flow://Lookup_Order"

    reasoning:
        instructions: ->
            | Ask for the Order Number and call {!@actions.lookup_order}.
              Summarize: status, items, delivery info.
        actions:
            lookup_order: @actions.Lookup_Order
                with order_number=...
                set @variables.status = @outputs.status
                set @variables.order_id = @outputs.order_id

            go_to_return: @utils.transition to @subagent.Return_Management
                description: "If user wants to return items"

    after_reasoning:
        set @variables.request_count = @variables.request_count + 1`
    )
  ),
  start_agent: NamedCollectionBlock(
    AFStartAgentBlock.clone().example(
      `start_agent topic_selector:
    label: "Topic Selector"
    description: "Welcome user and route to the right topic"
    reasoning:
        instructions: ->
            | Welcome the user. Analyze their request and route accordingly:
              {!@actions.go_to_orders}: For order lookups and updates
              {!@actions.go_to_returns}: For return requests
              {!@actions.go_to_escalation}: When user is upset or asks for a person
        actions:
            go_to_orders: @utils.transition to @subagent.Order_Management
                description: "Handle order inquiries"
                available when @variables.verified == True
            go_to_returns: @utils.transition to @subagent.Return_Management
                description: "Handle return requests"
                available when @variables.verified == True
            go_to_escalation: @utils.transition to @subagent.escalation
                description: "Escalate to human agent"`
    )
  ).singular(),
  topic: NamedCollectionBlock(
    AFTopicBlock.clone().example(
      `topic Order_Management:
    description: "Handles order lookups, updates, and summaries"

    actions:
        Lookup_Order:
            description: "Retrieve order details"
            target: "flow://Lookup_Order"

    reasoning:
        instructions: ->
            | Help the user with their order.
        actions:
            lookup_order: @actions.Lookup_Order
                with order_number=...`
    )
  ),
  // TODO: restore deprecated() call once migration is complete
  // .deprecated(
  //   'Replace topic with subagent, actions with tool_definitions and reasoning.actions with reasoning.tools.',
  //   { replacement: 'subagent' }
  // ),
} satisfies Record<string, FieldType>;

export type AgentforceSchema = typeof AgentforceSchema;

/** Fully-parsed AgentForce document with CST metadata. */
export type ParsedAgentforce = Parsed<InferFields<typeof AgentforceSchema>> &
  AstRoot;

/** Pre-built reverse lookup: block `__kind` → schema key. */
export const AgentforceKindToSchemaKey = buildKindToSchemaKey(
  AgentforceSchema as Record<string, FieldType>
);

export const AgentforceSchemaAliases: Record<string, string> = {
  ...AgentScriptSchemaAliases,
};

export const AgentforceSchemaInfo: SchemaInfo = {
  schema: AgentforceSchema as Record<string, FieldType>,
  aliases: AgentforceSchemaAliases,
  globalScopes: {
    ...AgentScriptSchemaInfo.globalScopes,
    MessagingSession: new Set(['MessagingEndUserId', 'Id', 'EndUserLanguage']),
    MessagingEndUser: new Set(['ContactId']),
  },
  // start_agent blocks are reachable via both @topic.X and @subagent.X
  extraNamespaceKeys: {
    topic: ['start_agent'],
  },
};

export const agentforceSchemaContext: SchemaContext =
  createSchemaContext(AgentforceSchemaInfo);
