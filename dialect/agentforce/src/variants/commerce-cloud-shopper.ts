import { Block, InputsBlock } from '@agentscript/language';
import { customSubagentFields } from '@agentscript/agentscript-dialect';

/**
 * Schema discriminant value for the Commerce Cloud Shopper subagent variant.
 */
export const COMMERCE_SHOPPER_SCHEMA = 'node://commerce/shopper_agent/v1';

const CommerceShopperParametersBlock = Block('ParametersBlock', {
  template: InputsBlock.describe(
    'Variable bindings: each key maps to a @variables.X expression, e.g., authToken: @variables.authToken.'
  ),
}).describe(
  'Variable binding configuration. Use parameters.template to pre-populate node inputs from agent-level variables.'
);

/**
 * Variant fields for the Commerce Cloud Shopper subagent.
 *
 * Uses `customSubagentFields` as the base (label, description, system, actions,
 * schema, parameters, on_init, on_exit).
 *
 * NOTE: AFActionsBlock, ModelConfigBlock, and SecurityBlock are injected by
 * schema.ts when assembling the full variant to avoid circular imports.
 */
export const commerceShopperVariantFields = {
  ...customSubagentFields,
  parameters: CommerceShopperParametersBlock,
};
