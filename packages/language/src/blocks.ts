/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Block, NamedBlock, TypedMap, CollectionBlock } from './core/block.js';
import { SymbolKind } from './core/types.js';
import {
  StringValue,
  BooleanValue,
  ExpressionValue,
  ProcedureValue,
} from './core/primitives.js';
import {
  AGENTSCRIPT_PRIMITIVE_TYPES,
  VARIABLE_MODIFIERS,
} from './core/primitives-constants.js';

export {
  AGENTSCRIPT_PRIMITIVE_TYPES,
  VARIABLE_MODIFIERS,
} from './core/primitives-constants.js';
export type {
  AgentScriptPrimitiveType,
  VariableModifier,
} from './core/primitives-constants.js';

export const VariablePropertiesBlock = Block(
  'VariablePropertiesBlock',
  {
    description: StringValue.describe('Human-readable description.'),
    label: StringValue.describe('Display label shown in the UI.'),
    is_required: BooleanValue.describe('Whether this variable is required.'),
  },
  { symbol: { kind: SymbolKind.Object, noRecurse: true } }
).describe('Properties for a variable declaration.');

export const InputPropertiesBlock = Block(
  'InputPropertiesBlock',
  {
    label: StringValue.describe('Display label shown in the UI.'),
    description: StringValue.describe('Human-readable description.'),
    is_required: BooleanValue.describe('Whether this input is required.'),
  },
  { symbol: { kind: SymbolKind.Object, noRecurse: true } }
).describe('Properties for an action input parameter.');

export const OutputPropertiesBlock = Block(
  'OutputPropertiesBlock',
  {
    label: StringValue.describe('Display label shown in the UI.'),
    description: StringValue.describe('Human-readable description.'),
  },
  { symbol: { kind: SymbolKind.Object, noRecurse: true } }
).describe('Properties for an action output parameter.');

export const VariablesBlock = TypedMap(
  'VariablesBlock',
  VariablePropertiesBlock,
  {
    modifiers: VARIABLE_MODIFIERS,
    primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES,
  }
)
  .describe('Global variable declarations with modifiers, types, and defaults.')
  .example(
    `variables:
    # Mutable types with defaults
    user_name: mutable string = ""
        description: "The customer's name"
    request_count: mutable number = 0
        description: "Number of requests in this session"
    verified: mutable boolean = False
        description: "Whether identity has been verified"
    user_data: mutable object = {}
        description: "Arbitrary user profile data"
    order_items: mutable list[object] = []
        description: "List of items in the current order"
    join_date: mutable date
        description: "When the customer joined"

    # Mutable without default value
    order_id: mutable string
        description: "Current order ID"

    # Variable with display label
    loyalty_tier: mutable string = "basic"
        label: "Loyalty Tier"
        description: "The customer's loyalty program tier"

    # Linked variables (sourced from external context, read-only)
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId
        description: "The messaging end user ID"
    ContactId: linked string
        source: @MessagingEndUser.ContactId
        description: "The contact ID from messaging"`
  );

export const InputsBlock = TypedMap('InputsBlock', InputPropertiesBlock, {
  modifiers: VARIABLE_MODIFIERS,
  primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES,
}).describe('Action input parameter declarations.');

export const OutputsBlock = TypedMap('OutputsBlock', OutputPropertiesBlock, {
  modifiers: VARIABLE_MODIFIERS,
  primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES,
})
  .describe('Action output parameter declarations.')
  .crossBlockReferenceable();

export const ActionBlock = NamedBlock(
  'ActionBlock',
  {
    description: StringValue.describe('Description of what the action does.'),
    label: StringValue.describe('Display label shown in the UI.'),
    inputs: InputsBlock,
    outputs: OutputsBlock,
    target: StringValue.describe(
      'External implementation target URI (e.g., "flow://Action_Name").'
    ),
    source: StringValue.describe(
      'Global namespace function name or legacy action identifier.'
    ),
  },
  {
    symbol: { kind: SymbolKind.Method },
    scopeAlias: 'action',
    capabilities: ['invocationTarget'],
  }
)
  .describe('Action definition representing an external tool or flow.')
  .example(
    `    actions:
        Lookup_Order:
            description: "Retrieve order details by order number"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
            outputs:
                status: string
                    description: "Order status"
            target: "flow://Lookup_Order"`
  );

export const ActionsBlock = CollectionBlock(ActionBlock).describe(
  'Collection of action definitions.'
);

export const ReasoningActionBlock = NamedBlock(
  'ReasoningActionBlock',
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
)
  .describe('Action made available to the agent to choose during reasoning.')
  .example(
    `        actions:
            lookup: @actions.Lookup_Order
                with order_number=@variables.order_number
                set @variables.status = @outputs.status`
  );

export const ReasoningActionsBlock = CollectionBlock(
  ReasoningActionBlock
).describe('Collection of reasoning action bindings.');
