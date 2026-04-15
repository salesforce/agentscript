/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  Block,
  NamedBlock,
  CollectionBlock,
  NamedCollectionBlock,
  SymbolKind,
  StringValue,
  BooleanValue,
  ExpressionValue,
  ProcedureValue,
  createSchemaContext,
  VariablesBlock,
  ActionsBlock,
  ReasoningActionBlock,
  InputsBlock,
} from '@agentscript/language';

import type {
  FieldType,
  SchemaInfo,
  SchemaContext,
} from '@agentscript/language';

export {
  VariablePropertiesBlock,
  InputPropertiesBlock,
  OutputPropertiesBlock,
  VariablesBlock,
  InputsBlock,
  OutputsBlock,
  ActionBlock,
  ActionsBlock,
  ReasoningActionBlock,
  ReasoningActionsBlock,
  VARIABLE_MODIFIERS,
  AGENTSCRIPT_PRIMITIVE_TYPES,
} from '@agentscript/language';

export type {
  VariableModifier,
  AgentScriptPrimitiveType,
} from '@agentscript/language';

export const MessagesBlock = Block('MessagesBlock', {
  welcome: StringValue.describe('Welcome message shown to the user.'),
  error: StringValue.describe('Error message shown on failure.').required(),
})
  .describe('Pre-defined message templates.')
  .example(
    `messages:
    welcome: "Hello! How can I help you today?"
    error: "Sorry, something went wrong. Please try again."`
  );

export const SystemBlock = Block(
  'SystemBlock',
  {
    instructions: StringValue.describe(
      'System-level instructions for the agent. Supports {!<expression>} interpolation with context variables.'
    ),
    messages: MessagesBlock.describe(
      'Default messages for certain situations (e.g., welcome, error).'
    ),
  },
  { symbol: { kind: SymbolKind.Namespace } }
)
  .describe(
    'System-level instructions and messages that interact with the user.'
  )
  .example(
    `system:
    instructions: |
        You are a helpful, professional assistant for customer support.
        Always be polite, concise, and reassuring.
    messages:
        welcome: "Hello! How can I help you today?"
        error: "Sorry, something went wrong. Please try again."`
  );

export const ConfigBlock = Block('ConfigBlock', {
  description: StringValue.describe('Agent description. Defaults to label.'),
})
  .describe('High-level agent configuration.')
  .example(
    `config:
    agent_name: "My_Agent"
    description: "An AI assistant for customer support"`
  );

export const LanguageBlock = Block('LanguageBlock', {
  default_locale: StringValue.describe(
    'The primary locale for the agent (e.g., "en_US", "de", "fr").'
  ),
  additional_locales: StringValue.describe(
    'Comma-separated list of additional supported locales.'
  ),
  all_additional_locales: BooleanValue.describe(
    'Whether to support all available locales.'
  ),
})
  .describe('Locale and language configuration.')
  .example(
    `language:
    default_locale: "en_US"
    additional_locales: "fr, de"
    all_additional_locales: True`
  );

const DialectReasoningActionBlock = ReasoningActionBlock.extend(
  {},
  { colinear: ExpressionValue.resolvedType('invocationTarget') }
);
const DialectReasoningActionsBlock = CollectionBlock(
  DialectReasoningActionBlock
).describe('Collection of reasoning action bindings.');

export const ReasoningBlock = Block(
  'ReasoningBlock',
  {
    instructions: ProcedureValue.describe(
      'Procedural instructions for the reasoning loop. Supports templating and directives.'
    ),
    actions: DialectReasoningActionsBlock.describe(
      'Actions available to the agent during the reasoning loop.'
    ),
  },
  { symbol: { kind: SymbolKind.Namespace } }
)
  .describe("Instructions and actions for the agent's reasoning loop.")
  .example(
    `    reasoning:
        instructions: ->
            # Conditional logic can be embedded in instructions
            if @variables.checked_loyalty_tier == False:
                run @actions.Get_Loyalty_Tier
                    with member_email = @variables.member_email
                    set @variables.loyalty_tier = @outputs.loyalty_tier
                set @variables.checked_loyalty_tier = True
            if @variables.loyalty_tier != "Premium":
                | Basic members are not eligible for returns. Apologize and
                  explain alternatives like exchanges or store credit.
            else:
                | If the user wants a return, confirm which order and process
                  with {!@actions.create_return}.

            # Main instructions use {!@variables.x} and {!@actions.Name} for interpolation
            | Analyze the user's request. Use {!@actions.lookup_order} to retrieve
              order details. Current status: {! @variables.request_status }
        actions:
            # Bind an action — LLM can invoke during reasoning
            lookup_order: @actions.Lookup_Order
                with order_number=@variables.order_number
                set @variables.status = @outputs.status
                set @variables.order_id = @outputs.order_id

            # LLM slot-filled input (... = LLM provides the value from conversation)
            search: @actions.Search_Products
                with query=...
                set @variables.results = @outputs.products

            # Conditional availability guard
            create_return: @actions.Create_Return
                available when @variables.return_eligible == True
                with order_id = @variables.order_id
                set @variables.rma_number = @outputs.rma_number

            # Chained run — execute a follow-up action after the first completes
            lookup_by_email: @actions.Lookup_Order_By_Email
                with email=@variables.member_email
                set @variables.order_number = @outputs.order_number
                run @actions.Lookup_Order
                    with order_number=@variables.order_number
                    set @variables.status = @outputs.status

            # Transition to another subagent
            go_to_returns: @utils.transition to @subagent.Return_Management
                description: "Route to returns when user wants to return items"
                available when @variables.verified is True

            # Set variables from conversation (LLM fills values)
            capture_info: @utils.setVariables
                description: "Capture customer information from conversation"
                with member_email=...
                with member_number=...

            # Escalate to a human agent
            escalate: @utils.escalate
                description: "Hand off to a live human agent"`
  );

export const baseSubagentFields = {
  label: StringValue.describe('Display label shown in the UI.').accepts([
    'StringLiteral',
  ]),
  description: StringValue.describe(
    'Block description. Influences transitions to this block.'
  ).required(),
  system: SystemBlock.pick(['instructions']),
  actions: ActionsBlock.describe('Action definitions available to this block.'),
  schema: StringValue.describe(
    'URI identifying the subagent schema variant (e.g., "node://CustomSubagent"). When specified, enables custom field validation.'
  )
    .pattern(/^node:\/\/\S+$/)
    .accepts(['StringLiteral']),
};

/**
 * Default subagent fields including reasoning capabilities.
 * Used by SubagentBlock and StartAgentBlock for standard agent behavior.
 */
export const defaultSubagentFields = {
  ...baseSubagentFields,
  before_reasoning: ProcedureValue.describe(
    'Procedures that run before the reasoning loop starts, once per turn.'
  )
    .omitArrow()
    .disallowTemplates(
      'Templates are for LLM instructions and should only be used in reasoning.instructions.'
    ),
  after_reasoning: ProcedureValue.describe(
    'Procedures that run after the reasoning loop completes, once per turn.'
  )
    .omitArrow()
    .disallowTemplates(
      'Templates are for LLM instructions and should only be used in reasoning.instructions.'
    ),
  reasoning: ReasoningBlock.describe(
    'Reasoning block containing instructions and actions for the agent reasoning loop.'
  ),
};

/**
 * Custom subagent fields for schema variants.
 * Includes parameters block for custom configuration.
 * Used when registering custom schema variants with .variant().
 */
export const customSubagentFields = {
  ...baseSubagentFields,
  parameters: Block('ParametersBlock', {}).describe(
    'Custom parameters for schema variants. Structure is defined by the schema variant.'
  ),
  on_init: ProcedureValue.describe(
    'Procedures that run when the subagent is initialized.'
  )
    .omitArrow()
    .disallowTemplates(
      'Templates are for LLM instructions and should only be used in reasoning.instructions.'
    ),
  on_exit: ProcedureValue.describe(
    'Procedures that run when the subagent is exited from.'
  )
    .omitArrow()
    .disallowTemplates(
      'Templates are for LLM instructions and should only be used in reasoning.instructions.'
    ),
};

const baseAgentOpts = {
  allowAnonymous: true,
  capabilities: ['invocationTarget', 'transitionTarget'] as const,
};

export const SubagentBlock = NamedBlock(
  'SubagentBlock',
  { ...defaultSubagentFields },
  {
    scopeAlias: 'subagent',
    ...baseAgentOpts,
  }
).describe('A subagent defining agent logic with actions and reasoning.');

export const StartAgentBlock = NamedBlock(
  'StartAgentBlock',
  { ...defaultSubagentFields },
  {
    scopeAlias: 'subagent',
    ...baseAgentOpts,
  }
).describe('The entry-point agent block.');

export const ConnectedSubagentBlock = NamedBlock(
  'ConnectedSubagentBlock',
  {
    target: StringValue.accepts(['StringLiteral'])
      .describe(
        'URI identifying the connected agent (e.g., "agentforce://Agent_Name").'
      )
      .required()
      .pattern(/^[a-zA-Z][a-zA-Z0-9_]*:\/\/\S+$/),
    label: StringValue.describe(
      'Human-readable label for the connected agent.'
    ),
    description: StringValue.describe(
      "Description of the connected agent's capabilities or when it should be called."
    ),
    loading_text: StringValue.describe(
      'Message to display while the connected agent is executing.'
    ),
    inputs: InputsBlock,
  },
  { capabilities: ['invocationTarget', 'transitionTarget'] }
);

export const AgentScriptSchema = {
  system: SystemBlock,
  config: ConfigBlock,
  variables: VariablesBlock,
  language: LanguageBlock,
  connected_subagent: NamedCollectionBlock(ConnectedSubagentBlock),
  start_agent: NamedCollectionBlock(
    StartAgentBlock.clone().example(
      `# Exactly one start_agent is required as the entry point
start_agent topic_selector:
    label: "Topic Selector"
    description: "Welcome user and route to the right subagent"

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
  subagent: NamedCollectionBlock(
    SubagentBlock.clone().example(
      `# Additional subagents handle specific conversation areas
subagent Order_Management:
    description: "Handles order lookups, updates, and summaries"

    # Optional subagent-level system instruction override
    system:
        instructions: "Focus on helping the user with their order. Never expose internal record IDs."

    # before_reasoning runs BEFORE the LLM reasoning loop on every turn
    before_reasoning:
        if @variables.verified is not True:
            transition to @subagent.Identity
        # Run an action and store results in variables
        run @actions.Check_Business_Hours
            set @variables.is_business_hours = @outputs.is_business_hours

    # Action definitions — external actions the agent can call
    actions:
        Lookup_Order:
            description: "Retrieve order details"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
                    is_user_input: True
            outputs:
                status: string
                    description: "Order status"
                items: string
                order_id: string
            target: "flow://Lookup_Order"

        Check_Business_Hours:
            description: "Check if it is currently business hours"
            inputs:
                query: string
            outputs:
                is_business_hours: boolean
                next_open_time: string
            target: "flow://Check_Business_Hours"

    reasoning:
        instructions: ->
            | Ask for the Order Number and call {!@actions.lookup_order}.
              Summarize: status, items, delivery info.
              Never show the Record ID: {!@variables.order_id}
        actions:
            lookup_order: @actions.Lookup_Order
                with order_number=...
                set @variables.status = @outputs.status
                set @variables.order_id = @outputs.order_id

            go_to_return: @utils.transition to @subagent.Return_Management
                description: "If user wants to return items"

    # after_reasoning runs AFTER the LLM reasoning loop on every turn
    after_reasoning:
        if @variables.severe_weather_alert:
            transition to @subagent.severe_weather_alerts
        set @variables.request_count = @variables.request_count + 1`
    )
  ),
} satisfies Record<string, FieldType>;

export type AgentScriptSchema = typeof AgentScriptSchema;

export const AgentScriptSchemaAliases: Record<string, string> = {
  start_agent: 'subagent',
};

export const AgentScriptSchemaInfo: SchemaInfo = {
  schema: AgentScriptSchema as Record<string, FieldType>,
  aliases: AgentScriptSchemaAliases,
  // TODO: globalScopes are just bags of member names with no type information.
  // Each member is an invokable with its own signature — e.g. transition takes a
  // transitionTarget argument, setVariables takes variable bindings, escalate takes
  // no arguments. These need to be promoted to typed declarations so they participate
  // in resolvedType validation instead of being silently skipped.
  globalScopes: {
    utils: new Set(['transition', 'setVariables', 'escalate']),
    system_variables: new Set(['user_input']),
  },
};

export const agentScriptSchemaContext: SchemaContext = createSchemaContext(
  AgentScriptSchemaInfo
);
